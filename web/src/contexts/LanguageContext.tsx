import React, { createContext, useContext, useState, useCallback } from 'react';
import { Language, getTranslation } from '@/i18n/translations';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, replacements?: Record<string, string>) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Persisted so a reload (or a refresh straight to /dashboard) keeps the
  // choice. The original kept this in component state only, which meant every
  // page load silently fell back to English.
  const [language, setLanguageState] = useState<Language>(() => {
    const stored = window.localStorage.getItem('ssaa-language');
    return stored === 'en' || stored === 'es' ? stored : 'en';
  });

  const setLanguage = useCallback((lang: Language) => {
    window.localStorage.setItem('ssaa-language', lang);
    setLanguageState(lang);
  }, []);

  const t = useCallback((key: string, replacements?: Record<string, string>) => {
    return getTranslation(key, language, replacements);
  }, [language]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
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
