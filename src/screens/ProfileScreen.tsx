import React, { useEffect, useState } from 'react';
import { Check, Database, LogOut, MapPin, ShieldCheck, Trash2 } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import { LANGUAGE_LABELS } from '../i18n/translations';
import type { UseGeolocationResult } from '../map/useGeolocation';
import type { Language, UserRole } from '../types/firestore';
import { OfflineBadge, OfflineLocalBanner } from '../ui/OfflineBadge';
import { PWAInstallButton } from '../ui/PWAInstallButton';
import { Wordmark } from '../ui/Wordmark';

interface ProfileScreenProps {
  geo: UseGeolocationResult;
  onOpenAdmin?: () => void;
}

export function ProfileScreen({ geo, onOpenAdmin }: ProfileScreenProps) {
  const {
    firebaseUser,
    role,
    displayName,
    savedSchool,
    isAdmin,
    isOnline,
    offlinePersistence,
    authBusy,
    authError,
    setRole,
    setDisplayName,
    saveSchool,
    signInWithGoogle,
    signOutUser,
    retryConnection,
  } = useAuth();
  const { t, language, setLanguage } = useI18n();

  const [nameInput, setNameInput] = useState(displayName);
  const [nameSaved, setNameSaved] = useState(false);

  useEffect(() => {
    setNameInput(displayName);
  }, [displayName]);

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameInput.trim()) return;
    await setDisplayName(nameInput);
    setNameSaved(true);
    window.setTimeout(() => setNameSaved(false), 2000);
  };

  const languages: Language[] = ['en', 'kn', 'hi'];
  const roles: Array<{ id: UserRole; label: string }> = [
    { id: 'student', label: t.roleStudentTitle },
    { id: 'driver', label: t.roleDriverTitle },
    { id: 'teacher', label: t.roleTeacherTitle },
  ];

  const locationSummary = geo.position
    ? `${t.gpsReady} (${Math.round(geo.position.accuracy)} m${geo.position.isSimulated ? ` · ${t.simulatedBadge}` : ''})`
    : geo.permissionState === 'denied'
      ? t.gpsDeniedTitle
      : t.gpsSearching;

  return (
    <div className="min-h-full pb-24 bg-[#F2F5F3]">
      <header className="h-14 px-4 bg-white border-b-2 border-[#1F2A2E] flex items-center justify-between gap-2">
        <Wordmark size="sm" />
        {!isOnline && <OfflineBadge compact />}
      </header>

      <main className="max-w-2xl mx-auto p-4 sm:p-6 space-y-5">
        {!isOnline && <OfflineLocalBanner onRetry={() => void retryConnection()} />}

        <h1 className="font-sign text-2xl font-bold text-[#1F2A2E]">{t.profileTitle}</h1>

        {isAdmin && onOpenAdmin && (
          <section className="bg-[#FFC20E]/20 border-2 border-[#1F2A2E] rounded-2xl p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#0E6B4E] text-white flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h2 className="font-sign font-bold text-base text-[#1F2A2E]">{t.adminTitle}</h2>
                <p className="text-sm text-[#526066] mt-0.5 break-words">{t.adminOpenHint}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenAdmin}
              data-testid="open-admin-btn"
              className="w-full min-h-[52px] px-4 rounded-xl bg-[#1F2A2E] hover:bg-[#0E6B4E] text-white font-sign font-bold text-base transition-colors"
            >
              {t.adminOpenBtn}
            </button>
          </section>
        )}

        <form
          onSubmit={(e) => void handleSaveName(e)}
          className="bg-white border-2 border-[#1F2A2E] rounded-2xl p-4 space-y-3"
        >
          <label htmlFor="profile-name" className="block text-sm font-bold text-[#1F2A2E]">
            {t.profileNameLabel}
          </label>
          <div className="flex flex-col sm:flex-row gap-2.5">
            <input
              id="profile-name"
              type="text"
              maxLength={80}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              className="flex-1 min-w-0 min-h-[56px] px-3.5 rounded-xl bg-[#F2F5F3] border-2 border-[#1F2A2E] text-base text-[#1F2A2E]"
            />
            <button
              type="submit"
              className="min-h-[56px] px-5 rounded-xl bg-[#0E6B4E] hover:bg-[#0A523B] text-white font-bold text-base inline-flex items-center justify-center gap-2 shrink-0"
            >
              {nameSaved && <Check className="w-5 h-5 shrink-0" aria-hidden="true" />}
              <span>{nameSaved ? t.profileSavedBadge : t.profileSaveNameBtn}</span>
            </button>
          </div>
        </form>

        <section className="bg-white border-2 border-[#1F2A2E] rounded-2xl p-4 space-y-3">
          <p className="text-sm font-bold text-[#1F2A2E]">{t.profileLanguageLabel}</p>
          <div className="grid grid-cols-3 gap-2">
            {languages.map((lang) => {
              const active = language === lang;
              return (
                <button
                  key={lang}
                  type="button"
                  onClick={() => void setLanguage(lang)}
                  aria-pressed={active}
                  className={`min-w-0 min-h-[56px] px-2 rounded-xl border-2 text-sm sm:text-base font-bold leading-snug break-words transition-colors ${
                    active
                      ? 'bg-[#0E6B4E] text-white border-[#1F2A2E]'
                      : 'bg-[#F2F5F3] text-[#1F2A2E] border-[#D5DDD8] hover:border-[#1F2A2E]'
                  }`}
                >
                  {LANGUAGE_LABELS[lang]}
                </button>
              );
            })}
          </div>
        </section>

        <section className="bg-white border-2 border-[#1F2A2E] rounded-2xl p-4 space-y-3">
          <p className="text-sm font-bold text-[#1F2A2E]">{t.profileRoleLabel}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {roles.map((item) => {
              const active = role === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void setRole(item.id)}
                  aria-pressed={active}
                  className={`min-w-0 min-h-[56px] px-3 py-2 rounded-xl border-2 text-sm sm:text-base font-bold leading-snug break-words transition-colors ${
                    active
                      ? 'bg-[#FFC20E] text-[#1F2A2E] border-[#1F2A2E]'
                      : 'bg-[#F2F5F3] text-[#1F2A2E] border-[#D5DDD8] hover:border-[#1F2A2E]'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </section>

        {savedSchool && (
          <section className="bg-white border-2 border-[#1F2A2E] rounded-2xl p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-[#526066]">{t.savedSchoolLabel}</p>
              <p className="font-bold text-base text-[#1F2A2E] truncate">{savedSchool.name}</p>
              <p className="text-sm text-[#526066] truncate">{savedSchool.address}</p>
            </div>
            <button
              type="button"
              onClick={() => void saveSchool(null)}
              className="min-h-[48px] px-3.5 rounded-xl border-2 border-[#1F2A2E] text-sm font-bold text-[#1F2A2E] inline-flex items-center gap-1.5 shrink-0"
            >
              <Trash2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{t.clearSavedSchool}</span>
            </button>
          </section>
        )}

        <PWAInstallButton />

        <section className="bg-white border-2 border-[#1F2A2E] rounded-2xl p-4 space-y-3">
          <p className="text-sm font-bold text-[#1F2A2E]">{t.profileAccountLabel}</p>
          {firebaseUser && !firebaseUser.isAnonymous ? (
            <p className="text-base text-[#1F2A2E] break-words">
              {t.profileSignedInAs}{' '}
              <span className="font-bold">{firebaseUser.email || firebaseUser.displayName}</span>
            </p>
          ) : firebaseUser?.isAnonymous ? (
            <p className="text-base text-[#526066]">{t.profileGuestNote}</p>
          ) : (
            <p className="text-base text-[#526066]">{t.profileNotSignedIn}</p>
          )}

          {authError && (
            <p role="alert" className="text-sm font-medium text-[#D7352B]">
              {authError === 'popup_closed' ? t.authPopupClosed : t.authNetworkError}
            </p>
          )}

          {(!firebaseUser || firebaseUser.isAnonymous) && (
            <button
              type="button"
              disabled={authBusy}
              onClick={() => void signInWithGoogle()}
              className="w-full min-h-[56px] px-4 rounded-xl bg-[#0E6B4E] hover:bg-[#0A523B] text-white font-bold text-base"
            >
              {t.profileLinkGoogleBtn}
            </button>
          )}

          {firebaseUser && (
            <button
              type="button"
              disabled={authBusy}
              onClick={() => void signOutUser()}
              className="w-full min-h-[56px] px-4 rounded-xl bg-white hover:bg-[#F2F5F3] text-[#1F2A2E] border-2 border-[#1F2A2E] font-bold text-base inline-flex items-center justify-center gap-2"
            >
              <LogOut className="w-5 h-5 shrink-0" aria-hidden="true" />
              <span>{t.profileSignOutBtn}</span>
            </button>
          )}
        </section>

        <section className="bg-white border border-[#D5DDD8] rounded-2xl p-4 space-y-2 text-sm text-[#526066]">
          <div className="flex items-start gap-2 text-[#1F2A2E] font-bold">
            <MapPin className="w-4 h-4 text-[#2F6FDE] mt-0.5 shrink-0" aria-hidden="true" />
            <span className="break-words">
              {t.profileLocationStatus}: {locationSummary}
            </span>
          </div>
          <div className="flex items-start gap-2">
            <Database className="w-4 h-4 text-[#0E6B4E] mt-0.5 shrink-0" aria-hidden="true" />
            <span className="break-words">
              {offlinePersistence ? t.profileOfflineReady : t.profileOfflineFallback}
            </span>
          </div>
        </section>
      </main>
    </div>
  );
}
