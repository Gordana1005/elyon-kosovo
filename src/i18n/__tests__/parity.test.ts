import { describe, it, expect } from 'vitest';
import en from '../locales/en.json';
import bg from '../locales/bg.json';
import sq from '../locales/sq.json';
import { ALL_STATUSES, PREDICTION_LEAD_STATUSES } from '@/types';
import { CANCEL_REASON_VALUES } from '@/lib/cancellationReasons';

// CI guard for the translation files: every key must exist in ALL languages
// (a missing key would silently fall back to English in production), and
// every enum value rendered through statusLabel / predictionLeadLabel /
// cancelReasonLabel must have a corresponding entry. 'sq' (Albanian) is guarded
// here even while it's hidden from the switcher, so its tree never drifts.

type Tree = { [key: string]: string | Tree };

function flattenKeys(obj: Tree, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return typeof v === 'string' ? [path] : flattenKeys(v as Tree, path);
  });
}

describe('i18n locale parity', () => {
  const enKeys = new Set(flattenKeys(en as Tree));
  const bgKeys = new Set(flattenKeys(bg as Tree));
  const sqKeys = new Set(flattenKeys(sq as Tree));

  it('bg.json has every key from en.json', () => {
    const missing = [...enKeys].filter(k => !bgKeys.has(k));
    expect(missing, `keys missing from bg.json: ${missing.join(', ')}`).toEqual([]);
  });

  it('bg.json has no extra keys absent from en.json', () => {
    const extra = [...bgKeys].filter(k => !enKeys.has(k));
    expect(extra, `keys in bg.json but not en.json: ${extra.join(', ')}`).toEqual([]);
  });

  it('sq.json has every key from en.json', () => {
    const missing = [...enKeys].filter(k => !sqKeys.has(k));
    expect(missing, `keys missing from sq.json: ${missing.join(', ')}`).toEqual([]);
  });

  it('sq.json has no extra keys absent from en.json', () => {
    const extra = [...sqKeys].filter(k => !enKeys.has(k));
    expect(extra, `keys in sq.json but not en.json: ${extra.join(', ')}`).toEqual([]);
  });

  it('no empty translation values', () => {
    const empties = (lang: Tree, name: string) =>
      flattenKeys(lang).filter(k => {
        const value = k.split('.').reduce<Tree | string>((o, part) => (o as Tree)[part], lang);
        return typeof value === 'string' && value.trim() === '';
      }).map(k => `${name}:${k}`);
    expect([...empties(en as Tree, 'en'), ...empties(bg as Tree, 'bg'), ...empties(sq as Tree, 'sq')]).toEqual([]);
  });
});

describe('i18n enum coverage', () => {
  const treeFor = (lang: 'en' | 'bg' | 'sq') => (lang === 'en' ? en : lang === 'bg' ? bg : sq) as Tree;

  it.each(['en', 'bg', 'sq'] as const)('%s covers all order statuses', (lang) => {
    const tree = treeFor(lang);
    const statusKeys = Object.keys(tree.status as Tree);
    for (const s of ALL_STATUSES) expect(statusKeys, `status.${s} missing in ${lang}`).toContain(s);
  });

  it.each(['en', 'bg', 'sq'] as const)('%s covers all prediction lead statuses', (lang) => {
    const tree = treeFor(lang);
    const keys = Object.keys(tree.leadStatus as Tree);
    for (const s of PREDICTION_LEAD_STATUSES) expect(keys, `leadStatus.${s} missing in ${lang}`).toContain(s);
  });

  it.each(['en', 'bg', 'sq'] as const)('%s covers all active cancellation reasons (and retired ones)', (lang) => {
    const tree = treeFor(lang);
    const keys = Object.keys(tree.cancelReason as Tree);
    for (const v of CANCEL_REASON_VALUES) expect(keys, `cancelReason.${v} missing in ${lang}`).toContain(v);
    // Retired reasons still on historical orders must keep rendering friendly labels.
    for (const v of ['family_refused', 'wrong_product', 'duplicate_order', 'other']) {
      expect(keys, `retired cancelReason.${v} missing in ${lang}`).toContain(v);
    }
  });
});
