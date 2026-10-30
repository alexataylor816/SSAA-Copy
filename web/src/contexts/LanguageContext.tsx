import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { Language, getTranslation } from '@/i18n/translations';
import {
  getLanguage,
  setLanguage as setRuntimeLanguage,
  onLanguageChange,
  dateLocale,
  type Replacements,
} from '@/i18n/runtime';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, replacements?: Replacements) => string;
  /** 'en-US' or 'es-MX', for toLocaleDateString / Intl. */
  locale: string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Persisted (see i18n/runtime) so a reload keeps the choice. Signed-in users
  // also get it saved on their profile; AuthContext syncs it on sign-in.
  const [language, setLanguageState] = useState<Language>(getLanguage);

  useEffect(() => onLanguageChange(setLanguageState), []);

  const setLanguage = useCallback((lang: Language) => {
    setRuntimeLanguage(lang);
  }, []);

  const t = useCallback(
    (key: string, replacements?: Replacements) => getTranslation(key, language, replacements),
    [language],
  );

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, locale: dateLocale(language) }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
