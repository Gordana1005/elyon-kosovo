import i18n from '@/i18n';
import type { CallScript, CallScriptHelper, CallScriptTranslation } from '@/lib/api';

// The language the existing base columns (title/description/script_text/helpers)
// were authored in. Everything else lives in call_scripts.translations[<lang>]
// and falls back to these base columns per field.
export const BASE_SCRIPT_LANG = 'bg';

export interface ResolvedScript {
  title: string;
  description: string | null;
  script_text: string;
  helpers: CallScriptHelper[];
}

/** Normalise an i18next language tag ('sq', 'sq-XK', undefined) to a bare code. */
function normalizeLang(lang?: string): string {
  return (lang || i18n.language || BASE_SCRIPT_LANG).split('-')[0];
}

const hasText = (v?: string | null): v is string => typeof v === 'string' && v.trim().length > 0;

/** The raw translation object for a given language, if any (no fallback applied). */
export function getTranslation(script: CallScript, lang?: string): CallScriptTranslation | undefined {
  const code = normalizeLang(lang);
  if (code === BASE_SCRIPT_LANG) return undefined;
  return script.translations?.[code];
}

/**
 * Resolve the script for the active (or given) language, falling back PER FIELD to
 * the Bulgarian base column when a translated field is empty/missing. Helpers fall
 * back as a whole array (a non-empty translated array replaces the base set),
 * which avoids index drift on partially translated helper lists.
 */
export function resolveScript(script: CallScript, lang?: string): ResolvedScript {
  const base: ResolvedScript = {
    title: script.title,
    description: script.description ?? null,
    script_text: script.script_text,
    helpers: script.helpers ?? [],
  };
  const tr = getTranslation(script, lang);
  if (!tr) return base;
  return {
    title: hasText(tr.title) ? tr.title : base.title,
    description: hasText(tr.description) ? tr.description : base.description,
    script_text: hasText(tr.script_text) ? tr.script_text : base.script_text,
    helpers: Array.isArray(tr.helpers) && tr.helpers.length > 0 ? tr.helpers : base.helpers,
  };
}

/** Language codes (other than the base) that have any non-empty translated field. */
export function translatedLanguages(script: CallScript): string[] {
  const t = script.translations;
  if (!t) return [];
  return Object.keys(t).filter((lang) => {
    const v = t[lang];
    return !!v && (hasText(v.title) || hasText(v.description) || hasText(v.script_text) || (Array.isArray(v.helpers) && v.helpers.length > 0));
  });
}
