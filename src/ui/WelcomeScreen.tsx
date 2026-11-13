import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { LANGUAGE_LABELS } from '../i18n/translations';
import { useI18n } from '../i18n/I18nContext';
import { useAuth } from '../auth/AuthContext';
import type { Language, UserRole } from '../types/firestore';
import { Wordmark } from './Wordmark';

function RolePicture({ role }: { role: UserRole }) {
  if (role === 'student') {
    return (
      <svg viewBox="0 0 64 48" className="w-16 h-12 shrink-0" aria-hidden="true">
        <rect x="6" y="10" width="28" height="32" rx="4" fill="#FFC20E" stroke="#1F2A2E" strokeWidth="2.5" />
        <rect x="12" y="16" width="16" height="8" rx="1.5" fill="#FFFFFF" stroke="#1F2A2E" strokeWidth="2" />
        <path d="M14 10V6C14 4.9 14.9 4 16 4H24C25.1 4 26 4.9 26 6V10" stroke="#1F2A2E" strokeWidth="2.5" fill="none" />
        <rect x="42" y="14" width="16" height="28" rx="3" fill="#0E6B4E" stroke="#1F2A2E" strokeWidth="2.5" />
        <circle cx="50" cy="23" r="4" fill="#FFC20E" />
        <line x1="50" y1="31" x2="50" y2="37" stroke="#FFFFFF" strokeWidth="2.5" />
      </svg>
    );
  }
  if (role === 'driver') {
    return (
      <svg viewBox="0 0 64 48" className="w-16 h-12 shrink-0" aria-hidden="true">
        <rect x="4" y="12" width="34" height="24" rx="3" fill="#FFFFFF" stroke="#1F2A2E" strokeWidth="2.5" />
        <path d="M38 18H51L58 25V36H38V18Z" fill="#0E6B4E" stroke="#1F2A2E" strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M42 21H49L53 25H42V21Z" fill="#FFC20E" />
        <circle cx="16" cy="39" r="5" fill="#1F2A2E" stroke="#FFC20E" strokeWidth="2" />
        <circle cx="48" cy="39" r="5" fill="#1F2A2E" stroke="#FFC20E" strokeWidth="2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 64 48" className="w-16 h-12 shrink-0" aria-hidden="true">
      <rect x="10" y="6" width="44" height="30" rx="4" fill="#0E6B4E" stroke="#1F2A2E" strokeWidth="2.5" />
      <rect x="16" y="12" width="32" height="18" rx="2" fill="#F2F5F3" />
      <line x1="21" y1="18" x2="43" y2="18" stroke="#1F2A2E" strokeWidth="2.5" />
      <line x1="21" y1="24" x2="35" y2="24" stroke="#0E6B4E" strokeWidth="2.5" />
      <path d="M18 42L24 36H40L46 42" stroke="#1F2A2E" strokeWidth="2.5" fill="none" />
    </svg>
  );
}

interface WelcomeScreenProps {
  onFinished: () => void;
}

export function WelcomeScreen({ onFinished }: WelcomeScreenProps) {
  const { t, language, setLanguage } = useI18n();
  const { role: currentRole, completeOnboarding, authBusy, authError, clearAuthError } = useAuth();
  const [selectedRole, setSelectedRole] = useState<UserRole>(currentRole);

  const languages: Language[] = ['en', 'kn', 'hi'];
  const roles: Array<{ id: UserRole; title: string; hint: string }> = [
    { id: 'student', title: t.roleStudentTitle, hint: t.roleStudentHint },
    { id: 'driver', title: t.roleDriverTitle, hint: t.roleDriverHint },
    { id: 'teacher', title: t.roleTeacherTitle, hint: t.roleTeacherHint },
  ];

  const handleContinue = async (method: 'google' | 'guest') => {
    const ok = await completeOnboarding(method, selectedRole);
    if (ok) {
      onFinished();
    }
  };

  const errorText =
    authError === 'guest_unavailable'
      ? t.authGuestUnavailable
      : authError === 'popup_closed'
        ? t.authPopupClosed
        : authError === 'network_error'
          ? t.authNetworkError
          : authError
            ? t.authNetworkError
            : null;

  return (
    <div className="fixed inset-0 z-[800] bg-[#1F2A2E]/70 flex items-stretch md:items-center justify-center p-0 md:p-6 overflow-y-auto">
      <main className="w-full md:max-w-xl bg-white md:border-4 border-[#1F2A2E] rounded-none md:rounded-2xl shadow-xl overflow-hidden h-full md:h-auto md:max-h-[94vh] flex flex-col">
        <div className="bg-[#FFC20E] border-b-2 border-[#1F2A2E] px-4 py-3 flex items-center justify-between gap-4 shrink-0">
          <div>
            <Wordmark size="sm" />
            <p className="text-sm font-bold text-[#1F2A2E] mt-0.5">{t.tagline}</p>
          </div>
        </div>

        <div className="p-4 sm:p-5 space-y-3.5 overflow-y-auto flex-1">
          <h1 className="font-sign text-xl sm:text-2xl font-bold text-[#1F2A2E]">
            {t.welcomeTitle}
          </h1>

          <section aria-label={t.pickLanguage} className="space-y-1.5">
            <p className="text-sm font-bold text-[#1F2A2E]">{t.pickLanguage}</p>
            <div className="grid grid-cols-3 gap-2">
              {languages.map((lang) => {
                const active = language === lang;
                return (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => {
                      clearAuthError();
                      void setLanguage(lang);
                    }}
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

          <section aria-label={t.pickRole} className="space-y-1.5">
            <p className="text-sm font-bold text-[#1F2A2E]">{t.pickRole}</p>
            <div className="grid grid-cols-1 gap-2">
              {roles.map((item) => {
                const active = selectedRole === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      clearAuthError();
                      setSelectedRole(item.id);
                    }}
                    aria-pressed={active}
                    className={`min-h-[60px] px-3 py-2 rounded-xl border-2 text-left flex items-center gap-3 transition-colors ${
                      active
                        ? 'bg-[#FFC20E]/20 border-[#1F2A2E]'
                        : 'bg-white border-[#D5DDD8] hover:border-[#1F2A2E]'
                    }`}
                  >
                    <RolePicture role={item.id} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-sign font-bold text-base sm:text-lg text-[#1F2A2E] leading-snug break-words">
                        {item.title}
                      </span>
                      <span className="block text-sm text-[#526066] leading-snug break-words">
                        {item.hint}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <div className="p-3 rounded-xl bg-[#F2F5F3] border border-[#D5DDD8] flex items-start gap-2.5">
            <ShieldCheck className="w-5 h-5 text-[#0E6B4E] mt-0.5 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-[#1F2A2E]">{t.locationNoticeTitle}</p>
              <p className="text-sm text-[#526066] leading-snug break-words">{t.locationNoticeBody}</p>
            </div>
          </div>

          {errorText && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-[#D7352B]/10 border-2 border-[#D7352B] text-sm font-medium text-[#1F2A2E] break-words"
            >
              {errorText}
            </div>
          )}

          <div className="space-y-2 pt-0.5">
            <button
              type="button"
              disabled={authBusy}
              onClick={() => void handleContinue('google')}
              className="w-full min-h-[56px] px-4 py-2 rounded-xl bg-[#0E6B4E] hover:bg-[#0A523B] text-white font-sign font-bold text-base sm:text-lg leading-snug border-2 border-[#1F2A2E] disabled:opacity-60 transition-colors"
            >
              {authBusy ? t.signingIn : t.continueWithGoogle}
            </button>

            <button
              type="button"
              disabled={authBusy}
              onClick={() => void handleContinue('guest')}
              className="w-full min-h-[56px] px-4 py-2 rounded-xl bg-white hover:bg-[#F2F5F3] text-[#1F2A2E] font-bold text-base leading-snug border-2 border-[#1F2A2E] disabled:opacity-60 transition-colors"
            >
              {t.continueAsGuest}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
