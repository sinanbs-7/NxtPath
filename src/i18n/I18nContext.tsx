import React, { createContext, useContext, useMemo } from 'react';
import type { Language, TranslationStrings } from './types';
import { translations } from './translations';

interface I18nContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: TranslationStrings;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  language,
  onChangeLanguage,
  children,
}: {
  language: Language;
  onChangeLanguage: (lang: Language) => void;
  children: React.ReactNode;
}) {
  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage: onChangeLanguage,
      t: translations[language] ?? translations.en,
    }),
    [language, onChangeLanguage],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used inside I18nProvider');
  }
  return ctx;
}
