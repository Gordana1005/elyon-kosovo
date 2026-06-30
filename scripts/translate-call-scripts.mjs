#!/usr/bin/env node
// ============================================================================
// Loads AI-drafted EN + SQ translations of the product Call Scripts into the
// `call_scripts.translations` jsonb column, for operator review in-app.
//
// The Bulgarian base columns (title/description/script_text/helpers) are the
// source of truth and are NEVER touched here. We only fill row.translations:
//
//   row.translations.en = { ...existing.en, ...draft.en }   // title/description/script_text
//   row.translations.sq = { ...existing.sq, ...draft.sq }
//
// Field-level merge means re-running updates the drafted fields but preserves
// anything the operator already added (e.g. translated helpers) and any other
// language. Helpers are intentionally NOT seeded — they fall back to the BG base
// via src/lib/callScripts.ts until the operator translates them in the editor.
//
// Drafts live in scripts/data/call-script-translations.json, keyed by the BG
// base title (matched case-insensitively, trimmed).
//
// SAFE / IDEMPOTENT:
//   • Dry-run by default — prints exactly what it would change, touching nothing.
//   • Re-runnable: merges, never duplicates; base columns untouched.
//
// Usage:
//   node scripts/translate-call-scripts.mjs                                 (dry-run)
//   node --env-file=.env scripts/translate-call-scripts.mjs --commit
//   node --env-file=.env scripts/translate-call-scripts.mjs --commit --lang sq   (only sq)
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const langArgIdx = args.indexOf('--lang');
const ONLY_LANG = langArgIdx >= 0 ? args[langArgIdx + 1] : null; // optional: limit to one language

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, 'data', 'call-script-translations.json');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (COMMIT && (!SUPABASE_URL || !SERVICE_ROLE_KEY)) {
  console.error('--commit requires VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env.');
  console.error('Run with:  node --env-file=.env scripts/translate-call-scripts.mjs --commit');
  process.exit(1);
}

const FIELDS = ['title', 'description', 'script_text'];
const norm = (s) => (s || '').trim().toLowerCase();

// Keep only the non-empty translatable fields from a draft language object.
function cleanLang(obj) {
  const out = {};
  for (const f of FIELDS) {
    if (typeof obj?.[f] === 'string' && obj[f].trim()) out[f] = obj[f].trim();
  }
  return out;
}

// ── Load drafts ──────────────────────────────────────────────────────────────
let drafts;
try {
  drafts = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
} catch (e) {
  console.error(`Could not read ${DATA_FILE}: ${e.message}`);
  process.exit(1);
}
const draftTitles = Object.keys(drafts).filter((t) => !t.startsWith('_')); // skip _README and other meta keys
console.log(`\nLoaded ${draftTitles.length} script drafts from ${DATA_FILE}`);
if (ONLY_LANG) console.log(`Limiting to language: ${ONLY_LANG}`);

if (!COMMIT) {
  console.log('\nDRY RUN — no writes. Re-run with --commit (and --env-file=.env) to apply.\n');
  for (const title of draftTitles) {
    const langs = Object.keys(drafts[title]).filter((l) => !ONLY_LANG || l === ONLY_LANG);
    const summary = langs.map((l) => `${l}:${Object.keys(cleanLang(drafts[title][l])).join('+') || '—'}`).join('  ');
    console.log(`  "${title}"  →  ${summary}`);
  }
  console.log('\n────────────────────────────────────────');
  console.log(`Dry-run complete. ${draftTitles.length} scripts ready to translate.`);
  console.log('────────────────────────────────────────\n');
  process.exit(0);
}

// ── Apply ─────────────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: rows, error } = await supabase
  .from('call_scripts')
  .select('id, title, context_type, translations');
if (error) { console.error('Failed to read call_scripts:', error.message); process.exit(1); }

const byTitle = new Map();
for (const r of rows || []) byTitle.set(norm(r.title), r);

let updated = 0, unmatched = 0, unchanged = 0;
for (const title of draftTitles) {
  const row = byTitle.get(norm(title));
  if (!row) {
    console.log(`SKIP (no live script titled)  "${title}"`);
    unmatched++;
    continue;
  }
  const existing = (row.translations && typeof row.translations === 'object') ? row.translations : {};
  const next = { ...existing };
  const draft = drafts[title];
  let touched = [];
  for (const lang of Object.keys(draft)) {
    if (ONLY_LANG && lang !== ONLY_LANG) continue;
    const incoming = cleanLang(draft[lang]);
    if (!Object.keys(incoming).length) continue;
    next[lang] = { ...(existing[lang] || {}), ...incoming }; // field-merge; preserves helpers/other fields
    touched.push(lang);
  }
  if (!touched.length) { unchanged++; continue; }

  const { error: upErr } = await supabase
    .from('call_scripts')
    .update({ translations: next, updated_at: new Date().toISOString() })
    .eq('id', row.id);
  if (upErr) { console.error(`   ERROR updating "${title}": ${upErr.message}`); continue; }
  console.log(`UPDATE  "${title}"  →  ${touched.join(', ')}`);
  updated++;
}

console.log('\n────────────────────────────────────────');
console.log(`Done. Updated ${updated}, unchanged ${unchanged}, unmatched ${unmatched}.`);
if (unmatched) console.log('Unmatched drafts have no live script with that exact title — check titles.');
console.log('────────────────────────────────────────\n');
