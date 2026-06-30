import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import i18n, { LANG_STORAGE_KEY, SUPPORTED_LANGUAGES, type AppLanguage } from '@/i18n';

interface LanguageContextType {
  language: AppLanguage;
  setLanguage: (lang: AppLanguage) => void;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

// Thin sync layer over the i18n singleton: localStorage gives an instant
// language before auth resolves; the profiles.language column makes the
// choice follow the user across devices.
export function LanguageProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [language, setLanguageState] = useState<AppLanguage>(i18n.language as AppLanguage);

  // Once the profile loads, the DB preference wins over the localStorage
  // cache (covers logging in on a fresh device / cleared storage).
  useEffect(() => {
    const dbLang = user?.language;
    if (dbLang && SUPPORTED_LANGUAGES.includes(dbLang) && dbLang !== i18n.language) {
      void i18n.changeLanguage(dbLang);
      try { localStorage.setItem(LANG_STORAGE_KEY, dbLang); } catch { /* private mode */ }
      setLanguageState(dbLang);
    }
  }, [user?.language]);

  const setLanguage = useCallback((lang: AppLanguage) => {
    if (!SUPPORTED_LANGUAGES.includes(lang)) return;
    void i18n.changeLanguage(lang);
    try { localStorage.setItem(LANG_STORAGE_KEY, lang); } catch { /* private mode */ }
    setLanguageState(lang);
    if (user) {
      // Fire-and-forget; RLS "Users can update own profile" permits this.
      // Fails silently if the language column migration isn't applied yet —
      // the choice still sticks per-device via localStorage.
      void supabase.from('profiles').update({ language: lang }).eq('user_id', user.id)
        .then(() => {}, () => {});
    }
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}
