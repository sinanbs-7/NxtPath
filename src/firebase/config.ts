import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import firebaseAppletConfig from '../../firebase-applet-config.json';

const envConfig = {
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || firebaseAppletConfig.projectId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || firebaseAppletConfig.appId,
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || firebaseAppletConfig.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || firebaseAppletConfig.authDomain,
  firestoreDatabaseId:
    import.meta.env.VITE_FIREBASE_DATABASE_ID || firebaseAppletConfig.firestoreDatabaseId,
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || firebaseAppletConfig.storageBucket,
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || firebaseAppletConfig.messagingSenderId,
};

export const firebaseApp: FirebaseApp = initializeApp({
  projectId: envConfig.projectId,
  appId: envConfig.appId,
  apiKey: envConfig.apiKey,
  authDomain: envConfig.authDomain,
  storageBucket: envConfig.storageBucket,
  messagingSenderId: envConfig.messagingSenderId,
});

function createFirestoreInstance(): { db: Firestore; offlinePersistenceEnabled: boolean } {
  const databaseId = envConfig.firestoreDatabaseId || '(default)';
  try {
    const instance = initializeFirestore(
      firebaseApp,
      {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      },
      databaseId,
    );
    return { db: instance, offlinePersistenceEnabled: true };
  } catch {
    const fallback = getFirestore(firebaseApp, databaseId);
    return { db: fallback, offlinePersistenceEnabled: false };
  }
}

const firestoreResult = createFirestoreInstance();
export const db: Firestore = firestoreResult.db;
export const offlinePersistenceEnabled: boolean = firestoreResult.offlinePersistenceEnabled;
export const auth: Auth = getAuth(firebaseApp);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function isFirestoreOfflineError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  const code =
    typeof (error as { code?: unknown }).code === 'string'
      ? String((error as { code?: unknown }).code).toLowerCase()
      : '';
  return (
    code === 'unavailable' ||
    msg.includes('the client is offline') ||
    msg.includes('could not reach cloud firestore') ||
    msg.includes('failed to get document because the client is offline') ||
    msg.includes('network error')
  );
}

export async function testFirestoreConnection(): Promise<{ ok: boolean; offline: boolean }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { ok: false, offline: true };
  }
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return { ok: true, offline: false };
  } catch (error) {
    if (isFirestoreOfflineError(error)) {
      return { ok: false, offline: true };
    }
    // Permission denied on nonexistent test/connection still confirms server reachability
    return { ok: true, offline: false };
  }
}
