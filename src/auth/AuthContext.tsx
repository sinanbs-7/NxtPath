import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  GoogleAuthProvider,
  linkWithPopup,
  onAuthStateChanged,
  signInAnonymously,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  deleteField,
} from 'firebase/firestore';
import {
  auth,
  db,
  handleFirestoreError,
  offlinePersistenceEnabled,
  OperationType,
  testFirestoreConnection,
} from '../firebase/config';
import type { Language, SavedSchool, UserProfile, UserRole } from '../types/firestore';

const PREFS_STORAGE_KEY = 'nxtpath_local_prefs_v1';

interface LocalPrefs {
  language: Language;
  role: UserRole;
  displayName: string;
  onboardingComplete: boolean;
  savedSchool: SavedSchool | null;
}

function readLocalPrefs(): LocalPrefs {
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const autoStart = params?.get('autostart') === '1';

  const defaults: LocalPrefs = {
    language: 'en',
    role: 'student',
    displayName: 'Rider',
    onboardingComplete: autoStart,
    savedSchool: null,
  };

  if (typeof window === 'undefined') return defaults;
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<LocalPrefs>;
    return {
      language: parsed.language === 'kn' || parsed.language === 'hi' ? parsed.language : 'en',
      role:
        parsed.role === 'driver' || parsed.role === 'teacher' ? parsed.role : 'student',
      displayName:
        typeof parsed.displayName === 'string' && parsed.displayName.trim().length > 0
          ? parsed.displayName.trim().slice(0, 80)
          : defaults.displayName,
      onboardingComplete: autoStart ? true : Boolean(parsed.onboardingComplete),
      savedSchool:
        parsed.savedSchool &&
        typeof parsed.savedSchool.name === 'string' &&
        typeof parsed.savedSchool.lat === 'number' &&
        typeof parsed.savedSchool.lng === 'number'
          ? parsed.savedSchool
          : null,
    };
  } catch {
    return defaults;
  }
}

function writeLocalPrefs(prefs: LocalPrefs) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota issues
  }
}

export type AuthErrorCode =
  | 'guest_unavailable'
  | 'popup_closed'
  | 'network_error'
  | 'unknown'
  | null;

interface AuthContextValue {
  firebaseUser: User | null;
  userProfile: UserProfile | null;
  authReady: boolean;
  isOnline: boolean;
  firestoreOffline: boolean;
  retryConnection: () => Promise<void>;
  offlinePersistence: boolean;
  isAdmin: boolean;
  language: Language;
  role: UserRole;
  displayName: string;
  onboardingComplete: boolean;
  savedSchool: SavedSchool | null;
  authBusy: boolean;
  authError: AuthErrorCode;
  clearAuthError: () => void;
  setLanguage: (lang: Language) => Promise<void>;
  setRole: (role: UserRole) => Promise<void>;
  setDisplayName: (name: string) => Promise<void>;
  saveSchool: (school: SavedSchool | null) => Promise<void>;
  completeOnboarding: (method: 'google' | 'guest', selectedRole: UserRole) => Promise<boolean>;
  signInWithGoogle: () => Promise<boolean>;
  signOutUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function sanitizeDisplayName(raw: string | null | undefined, fallback: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, 80);
}

function mapFirebaseAuthError(error: unknown): AuthErrorCode {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
  if (
    code === 'auth/operation-not-allowed' ||
    code === 'auth/admin-restricted-operation'
  ) {
    return 'guest_unavailable';
  }
  if (
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request'
  ) {
    return 'popup_closed';
  }
  if (code === 'auth/network-request-failed') {
    return 'network_error';
  }
  return 'unknown';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [localPrefs, setLocalPrefs] = useState<LocalPrefs>(() => readLocalPrefs());
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<AuthErrorCode>(null);
  const [browserOnline, setBrowserOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [firestoreOffline, setFirestoreOffline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? !navigator.onLine : false,
  );
  const [hasAdminDoc, setHasAdminDoc] = useState(false);

  const retryConnection = useCallback(async () => {
    const res = await testFirestoreConnection();
    setFirestoreOffline(res.offline);
  }, []);

  useEffect(() => {
    void retryConnection();
  }, [retryConnection]);

  useEffect(() => {
    const onOnline = () => {
      setBrowserOnline(true);
      void retryConnection();
    };
    const onOffline = () => {
      setBrowserOnline(false);
      setFirestoreOffline(true);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [retryConnection]);

  useEffect(() => {
    if (!firestoreOffline || !browserOnline) return;
    const id = window.setInterval(() => {
      void retryConnection();
    }, 20_000);
    return () => window.clearInterval(id);
  }, [firestoreOffline, browserOnline, retryConnection]);

  const ensureUserDoc = useCallback(
    async (user: User, prefsOverride?: Partial<LocalPrefs>) => {
      const userPath = `users/${user.uid}`;
      const userRef = doc(db, 'users', user.uid);
      const merged = { ...localPrefs, ...prefsOverride };
      const resolvedName = sanitizeDisplayName(
        user.displayName?.split(' ')[0] || merged.displayName,
        merged.role === 'driver' ? 'Driver' : merged.role === 'teacher' ? 'Teacher' : 'Student',
      );

      try {
        const snap = await getDoc(userRef);
        if (!snap.exists()) {
          const basePayload: Record<string, unknown> = {
            uid: user.uid,
            displayName: resolvedName,
            role: merged.role,
            language: merged.language,
            verifiedDriver: false,
            onboardingComplete: merged.onboardingComplete,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          if (merged.savedSchool) {
            basePayload.savedSchoolName = merged.savedSchool.name.slice(0, 140);
            basePayload.savedSchoolAddress = merged.savedSchool.address.slice(0, 240);
            basePayload.savedSchoolLat = merged.savedSchool.lat;
            basePayload.savedSchoolLng = merged.savedSchool.lng;
          }
          await setDoc(userRef, basePayload);
        }

        if (user.email) {
          const privateRef = doc(db, 'users', user.uid, 'private', 'contact');
          await setDoc(
            privateRef,
            {
              uid: user.uid,
              email: user.email.slice(0, 160),
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          );
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, userPath);
      }
    },
    [localPrefs],
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
      if (!user) {
        setUserProfile(null);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!authReady || !firebaseUser || firebaseUser.isAnonymous || !firebaseUser.emailVerified) {
      setHasAdminDoc(false);
      return;
    }
    if (firebaseUser.email === 'sinanmohd710@gmail.com') {
      setHasAdminDoc(true);
      return;
    }
    let cancelled = false;
    void getDoc(doc(db, 'admins', firebaseUser.uid))
      .then((snap) => {
        if (!cancelled) setHasAdminDoc(snap.exists());
      })
      .catch(() => {
        if (!cancelled) setHasAdminDoc(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authReady, firebaseUser]);

  useEffect(() => {
    if (!authReady || !firebaseUser) return;
    const userPath = `users/${firebaseUser.uid}`;
    const userRef = doc(db, 'users', firebaseUser.uid);

    const unsub = onSnapshot(
      userRef,
      { includeMetadataChanges: true },
      (snap) => {
        if (!snap.metadata.fromCache) {
          setFirestoreOffline(false);
        } else if (typeof navigator !== 'undefined' && !navigator.onLine) {
          setFirestoreOffline(true);
        }

        if (snap.exists()) {
          const data = snap.data() as UserProfile;
          setUserProfile(data);
          const nextSchool: SavedSchool | null =
            data.savedSchoolName &&
            typeof data.savedSchoolLat === 'number' &&
            typeof data.savedSchoolLng === 'number'
              ? {
                  name: data.savedSchoolName,
                  address: data.savedSchoolAddress || data.savedSchoolName,
                  lat: data.savedSchoolLat,
                  lng: data.savedSchoolLng,
                }
              : null;

          setLocalPrefs((prev) => {
            const updated: LocalPrefs = {
              language: data.language ?? prev.language,
              role: data.role ?? prev.role,
              displayName: data.displayName || prev.displayName,
              onboardingComplete: data.onboardingComplete ?? prev.onboardingComplete,
              savedSchool: nextSchool,
            };
            writeLocalPrefs(updated);
            return updated;
          });
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, userPath);
      },
    );

    return unsub;
  }, [authReady, firebaseUser]);

  const updateLocalAndRemote = useCallback(
    async (patch: Partial<LocalPrefs>, firestoreFields: Record<string, unknown>) => {
      setLocalPrefs((prev) => {
        const next = { ...prev, ...patch };
        writeLocalPrefs(next);
        return next;
      });

      if (!firebaseUser) return;
      const userPath = `users/${firebaseUser.uid}`;
      try {
        await updateDoc(doc(db, 'users', firebaseUser.uid), {
          ...firestoreFields,
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, userPath);
      }
    },
    [firebaseUser],
  );

  const setLanguage = useCallback(
    async (language: Language) => {
      await updateLocalAndRemote({ language }, { language });
    },
    [updateLocalAndRemote],
  );

  const setRole = useCallback(
    async (role: UserRole) => {
      await updateLocalAndRemote({ role }, { role });
    },
    [updateLocalAndRemote],
  );

  const setDisplayName = useCallback(
    async (name: string) => {
      const clean = sanitizeDisplayName(name, localPrefs.displayName);
      await updateLocalAndRemote({ displayName: clean }, { displayName: clean });
    },
    [localPrefs.displayName, updateLocalAndRemote],
  );

  const saveSchool = useCallback(
    async (school: SavedSchool | null) => {
      if (school) {
        await updateLocalAndRemote(
          { savedSchool: school },
          {
            savedSchoolName: school.name.slice(0, 140),
            savedSchoolAddress: school.address.slice(0, 240),
            savedSchoolLat: school.lat,
            savedSchoolLng: school.lng,
          },
        );
      } else {
        await updateLocalAndRemote(
          { savedSchool: null },
          {
            savedSchoolName: deleteField(),
            savedSchoolAddress: deleteField(),
            savedSchoolLat: deleteField(),
            savedSchoolLng: deleteField(),
          },
        );
      }
    },
    [updateLocalAndRemote],
  );

  const signInWithGoogle = useCallback(async (): Promise<boolean> => {
    setAuthBusy(true);
    setAuthError(null);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      let user: User;
      if (auth.currentUser?.isAnonymous) {
        try {
          const linked = await linkWithPopup(auth.currentUser, provider);
          user = linked.user;
        } catch {
          const res = await signInWithPopup(auth, provider);
          user = res.user;
        }
      } else {
        const res = await signInWithPopup(auth, provider);
        user = res.user;
      }
      await ensureUserDoc(user, { onboardingComplete: true });
      setLocalPrefs((prev) => {
        const next = {
          ...prev,
          displayName: sanitizeDisplayName(user.displayName?.split(' ')[0], prev.displayName),
          onboardingComplete: true,
        };
        writeLocalPrefs(next);
        return next;
      });
      return true;
    } catch (error) {
      setAuthError(mapFirebaseAuthError(error));
      return false;
    } finally {
      setAuthBusy(false);
    }
  }, [ensureUserDoc]);

  const completeOnboarding = useCallback(
    async (method: 'google' | 'guest', selectedRole: UserRole): Promise<boolean> => {
      setAuthError(null);
      setLocalPrefs((prev) => {
        const next = { ...prev, role: selectedRole };
        writeLocalPrefs(next);
        return next;
      });

      if (method === 'google') {
        setAuthBusy(true);
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        try {
          const res = await signInWithPopup(auth, provider);
          const nextName = sanitizeDisplayName(
            res.user.displayName?.split(' ')[0],
            selectedRole === 'driver' ? 'Driver' : selectedRole === 'teacher' ? 'Teacher' : 'Student',
          );
          await ensureUserDoc(res.user, {
            role: selectedRole,
            displayName: nextName,
            onboardingComplete: true,
          });
          setLocalPrefs((prev) => {
            const next = {
              ...prev,
              role: selectedRole,
              displayName: nextName,
              onboardingComplete: true,
            };
            writeLocalPrefs(next);
            return next;
          });
          return true;
        } catch (error) {
          setAuthError(mapFirebaseAuthError(error));
          return false;
        } finally {
          setAuthBusy(false);
        }
      }

      // Guest (Anonymous) sign-in
      setAuthBusy(true);
      try {
        const res = await signInAnonymously(auth);
        const fallbackName =
          selectedRole === 'driver' ? 'Driver' : selectedRole === 'teacher' ? 'Teacher' : 'Student';
        await ensureUserDoc(res.user, {
          role: selectedRole,
          displayName: fallbackName,
          onboardingComplete: true,
        });
        setLocalPrefs((prev) => {
          const next = {
            ...prev,
            role: selectedRole,
            displayName: fallbackName,
            onboardingComplete: true,
          };
          writeLocalPrefs(next);
          return next;
        });
        return true;
      } catch (error) {
        const mapped = mapFirebaseAuthError(error);
        setAuthError(mapped);
        return false;
      } finally {
        setAuthBusy(false);
      }
    },
    [ensureUserDoc],
  );

  const signOutUser = useCallback(async () => {
    setAuthBusy(true);
    try {
      await signOut(auth);
      setUserProfile(null);
      setLocalPrefs((prev) => {
        const next = { ...prev, onboardingComplete: false };
        writeLocalPrefs(next);
        return next;
      });
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  const isOnline = browserOnline && !firestoreOffline;
  const isAdmin = Boolean(
    firebaseUser &&
      !firebaseUser.isAnonymous &&
      firebaseUser.emailVerified &&
      (firebaseUser.email === 'sinanmohd710@gmail.com' || hasAdminDoc),
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      firebaseUser,
      userProfile,
      authReady,
      isOnline,
      firestoreOffline: !isOnline,
      retryConnection,
      offlinePersistence: offlinePersistenceEnabled,
      isAdmin,
      language: userProfile?.language ?? localPrefs.language,
      role: userProfile?.role ?? localPrefs.role,
      displayName: userProfile?.displayName ?? localPrefs.displayName,
      onboardingComplete: userProfile?.onboardingComplete ?? localPrefs.onboardingComplete,
      savedSchool: localPrefs.savedSchool,
      authBusy,
      authError,
      clearAuthError,
      setLanguage,
      setRole,
      setDisplayName,
      saveSchool,
      completeOnboarding,
      signInWithGoogle,
      signOutUser,
    }),
    [
      firebaseUser,
      userProfile,
      authReady,
      isOnline,
      retryConnection,
      isAdmin,
      localPrefs,
      authBusy,
      authError,
      clearAuthError,
      setLanguage,
      setRole,
      setDisplayName,
      saveSchool,
      completeOnboarding,
      signInWithGoogle,
      signOutUser,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
