#!/usr/bin/env node
// ============================================================================
// Exports every per-product Call Script (context_type='product') from the
// `call_scripts` table into docs/CALL_SCRIPTS.md — one readable reference of the
// talk tracks so they can be opened from anywhere (GitHub web/mobile, etc).
//
// SCRIPTS ONLY — the per-script `helpers` / FAQ pane is intentionally EXCLUDED
// (operator asked for "only the scripts, without helpers"). The script body's
// own line breaks are preserved as Markdown hard breaks so it reads as written.
//
// READ-ONLY: it never writes to the database.
//
// Usage:
//   node --env-file=.env scripts/export-call-scripts.mjs
//   (needs VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing env. Run with:  node --env-file=.env scripts/export-call-scripts.mjs');
  console.error('(needs VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)');
  process.exit(1);
}

const OUT = 'docs/CALL_SCRIPTS.md';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Product scripts only. Deliberately NOT selecting `helpers`.
const { data, error } = await supabase
  .from('call_scripts')
  .select('title, description, script_text')
  .eq('context_type', 'product');
if (error) { console.error('Failed to read call_scripts:', error.message); process.exit(1); }

const scripts = (data || [])
  .filter((s) => String(s.title || '').trim() || String(s.script_text || '').trim())
  .sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'bg'));

// GitHub-style heading slug for the table-of-contents links: lowercase, keep
// latin + cyrillic + digits, drop punctuation, spaces → hyphens, dedupe like GH.
const seen = new Map();
const slugify = (title) => {
  const base = String(title || '').trim().toLowerCase()
    .replace(/[^\wЀ-ӿ\s-]/g, '')
    .replace(/\s+/g, '-') || 'script';
  const n = seen.get(base) || 0;
  seen.set(base, n + 1);
  return n ? `${base}-${n}` : base;
};
const slugs = scripts.map((s) => slugify(s.title));

// Render a talk track as readable Markdown prose while keeping it faithful:
//   • the script's own line breaks are preserved (hard breaks),
//   • inline metacharacters are escaped so the many "_____" name-blanks and any
//     stray * never bold/italicise half the script,
//   • a full-width ASCII dash/equals divider line becomes a clean rule (a bare
//     "----" under text would otherwise turn that text into a huge heading).
const DIVIDER = /^\s*[-=_*~]{3,}\s*$/;
const escapeInline = (s) =>
  s.replace(/([\\`*_~<])/g, '\\$1').replace(/^(\s*)([#>])/, '$1\\$2');
function body(text) {
  const src = String(text || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').split('\n');
  const lines = [];
  for (const rawLine of src) {
    const line = rawLine.replace(/[ \t]+$/, '');
    if (!line.trim()) { lines.push(''); continue; }
    if (DIVIDER.test(line)) {
      if (lines.length && lines[lines.length - 1] !== '') lines.push('');
      lines.push('---', '');
      continue;
    }
    lines.push(`${escapeInline(line)}  `); // 2 trailing spaces = Markdown hard break
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
const out = [];
out.push('# Call Scripts');
out.push('');
out.push(`_${scripts.length} product script${scripts.length === 1 ? '' : 's'} · exported ${stamp} UTC · script text only (helpers excluded)._`);
out.push('');
out.push('> Auto-generated from the Call Scripts library. Regenerate with');
out.push('> `node --env-file=.env scripts/export-call-scripts.mjs`.');
out.push('');

if (scripts.length === 0) {
  out.push('No product call scripts found.');
} else {
  if (scripts.length > 1) {
    out.push('## Contents');
    out.push('');
    scripts.forEach((s, i) => out.push(`${i + 1}. [${s.title || 'Untitled'}](#${slugs[i]})`));
    out.push('');
  }
  scripts.forEach((s, i) => {
    out.push('---');
    out.push('');
    out.push(`## ${s.title || 'Untitled'}`);
    out.push('');
    if (String(s.description || '').trim()) {
      out.push(`*${s.description.trim()}*`);
      out.push('');
    }
    out.push(body(s.script_text) || '_No script content._');
    out.push('');
  });
}

mkdirSync('docs', { recursive: true });
const text = out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
writeFileSync(OUT, text, 'utf8');

console.log(`Wrote ${OUT} — ${scripts.length} script(s), ${text.length} chars.`);
scripts.forEach((s, i) => console.log(`  ${i + 1}. ${s.title}`));
