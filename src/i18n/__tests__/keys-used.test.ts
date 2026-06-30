import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import en from '../locales/en.json';
import bg from '../locales/bg.json';

// Guards the bug class we shipped on 2026-06-13: code referencing keys that
// don't exist (renders the raw key in prod) and EN/BG drifting on
// interpolation placeholders or plural forms.

function flat(obj: Record<string, unknown>, prefix = '', out: Record<string, string> = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flat(v as Record<string, unknown>, key, out);
    else out[key] = String(v);
  }
  return out;
}
const EN = flat(en as Record<string, unknown>);
const BG = flat(bg as Record<string, unknown>);

const exists = (key: string) => key in EN || `${key}_other` in EN || `${key}_one` in EN;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (!/node_modules|__tests__/.test(p)) sourceFiles(p, out);
    } else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

describe('i18n key usage', () => {
  it('every statically referenced key exists in en.json', () => {
    const keyRe = /(?:[^a-zA-Z0-9_.]|^)(?:t|i18n\.t)\(\s*['"`]([a-zA-Z][a-zA-Z0-9_.]*)['"`]\s*[,)]/g;
    const propRe = /(?:labelKey|descKey|titleKey|subtitleKey)\s*:\s*['"]([a-zA-Z][a-zA-Z0-9_.]*)['"]/g;
    const missing: string[] = [];
    for (const f of sourceFiles('src')) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(keyRe)) {
        if (m[1].includes('.') && !m[1].endsWith('.') && !exists(m[1])) missing.push(`${f}: t('${m[1]}')`);
      }
      for (const m of src.matchAll(propRe)) {
        if (!exists(m[1])) missing.push(`${f}: '${m[1]}'`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('EN and BG agree on {{placeholders}} per key', () => {
    const ph = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]).sort().join(',');
    const mismatches: string[] = [];
    for (const k of Object.keys(EN)) {
      if (k in BG && ph(EN[k]) !== ph(BG[k])) mismatches.push(`${k}: en(${ph(EN[k])}) vs bg(${ph(BG[k])})`);
    }
    expect(mismatches).toEqual([]);
  });

  it('plural keys come in complete _one/_other pairs', () => {
    const issues: string[] = [];
    for (const dict of [EN, BG]) {
      for (const k of Object.keys(dict)) {
        if (k.endsWith('_one') && !(k.replace(/_one$/, '_other') in dict)) issues.push(`${k} missing _other`);
        if (k.endsWith('_other') && !(k.replace(/_other$/, '_one') in dict)) issues.push(`${k} missing _one`);
      }
    }
    expect(issues).toEqual([]);
  });
});
