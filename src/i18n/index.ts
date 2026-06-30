import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import bg from './locales/bg.json';
import sq from './locales/sq.json';

// App-wide i18n singleton. Imported for its side effect at the very top of
// src/main.tsx so the cached language is active before the first paint.
//
// Re-render contract: changing language re-renders ONLY components subscribed
// via useTranslation(). Components that render translated text through helper
// functions (statusLabel, cancelReasonLabel, friendlyRoleLabel, …) must call
// useTranslation() themselves — even if they don't use `t` directly — so they
// re-render on switch. NEVER force a tree remount with key={language}: that
// would wipe an agent's half-filled order form mid-call.

export type AppLanguage = 'en' | 'bg' | 'sq';
// Albanian ('sq', Kosovo standard) — live since 2026-06-22. Professional wording
// review happens in-app (operator workflow); keys stay stable, only values change.
// Cross-device persistence needs migration 20260622120000_profiles_language_sq.sql
// applied remotely; until then the choice still sticks per-device via localStorage.
export const SUPPORTED_LANGUAGES: AppLanguage[] = ['en', 'bg', 'sq'];
export const LANG_STORAGE_KEY = 'elyon.lang';

function storedLanguage(): AppLanguage {
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY) as AppLanguage | null;
    if (stored && SUPPORTED_LANGUAGES.includes(stored)) return stored;
  } catch {
    // localStorage unavailable (private mode etc.) — fall through to default.
  }
  // Kosovo default = Albanian (was 'en' in Bulgaria). fallbackLng stays 'en' below
  // so a missing key still resolves. See deploy-kit/06-PER-MARKET-CHANGES.md (A5).
  return 'sq';
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    bg: { translation: bg },
    sq: { translation: sq },
  },
  lng: storedLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false,
  saveMissing: import.meta.env.DEV,
  missingKeyHandler: import.meta.env.DEV
    ? (_langs, _ns, key) => console.warn(`[i18n] missing key: ${key}`)
    : undefined,
  // In dev, render misses loudly as ⟪key⟫; in prod a miss falls back to the
  // English value (fallbackLng) or, failing that, the key itself.
  parseMissingKeyHandler: import.meta.env.DEV ? (key) => `⟪${key}⟫` : undefined,
});

export default i18n;
