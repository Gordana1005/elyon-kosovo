#!/usr/bin/env node
// ============================================================================
// Imports the per-product Call Support Center scripts (the Diabetol-style
// follow-up talk tracks) from docs/scripts/*.docx into the `call_scripts`
// table as product scripts (context_type='product').
//
// These power the "Scripts & Helpers" tab in Call Support Center and the
// 70/30 viewer on the Calls page. Each .docx becomes one product script:
//   • title         = first line of the doc (product name, e.g. "Brain Active 30 caps")
//   • description   = second line (the focus/sub-title)
//   • script_text   = the rest of the body (the talk track)
//   • helpers       = []   (none for now, per operator — added later)
//
// SAFE / IDEMPOTENT:
//   • Existing product scripts are fetched first; any doc whose title already
//     exists is SKIPPED. So the live Diabetol script is never touched and
//     re-running this never creates duplicates.
//   • Dry-run by default — prints exactly what it would insert.
//
// Usage:
//   node scripts/import-call-scripts.mjs                              (dry-run)
//   node --env-file=.env scripts/import-call-scripts.mjs --commit
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { join } from 'node:path';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const DOCS_DIR = 'docs/scripts';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (COMMIT && (!SUPABASE_URL || !SERVICE_ROLE_KEY)) {
  console.error('--commit requires VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env.');
  console.error('Run with:  node --env-file=.env scripts/import-call-scripts.mjs --commit');
  process.exit(1);
}

// ── Minimal, dependency-free .docx → text reader ────────────────────────────
// A .docx is a ZIP; the body lives in word/document.xml (DEFLATE-compressed).
// We read it via the ZIP central directory + zlib.inflateRawSync (no deps).
function extractDocxText(path) {
  const buf = readFileSync(path);
  // Locate End-Of-Central-Directory record (sig 0x06054b50), scanning from end.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(`${path}: EOCD not found (not a valid .docx?)`);
  const cdCount = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // central directory offset
  let entry = null;
  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break; // central dir header sig
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === 'word/document.xml') entry = { method, compSize, localOffset };
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (!entry) throw new Error(`${path}: word/document.xml not found`);
  // Local file header gives the real data offset (name/extra lengths can differ).
  const lo = entry.localOffset;
  const dataStart = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
  const comp = buf.subarray(dataStart, dataStart + entry.compSize);
  const xml = entry.method === 0 ? comp.toString('utf8') : inflateRawSync(comp).toString('utf8');
  return xmlToText(xml);
}

function xmlToText(xml) {
  return xml
    .replace(/<\/w:p>/g, '\n')        // paragraph end → newline
    .replace(/<w:tab[^>]*\/>/g, '\t') // tab element → tab
    .replace(/<[^>]+>/g, '')          // strip all remaining tags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/﻿/g, '')           // strip BOM
    .replace(/\r/g, '');
}

// ── Build a product script record from one .docx ────────────────────────────
function buildScript(path) {
  const text = extractDocxText(path);
  const lines = text.split('\n').map(l => l.trimEnd());
  // Drop leading blank lines
  while (lines.length && !lines[0].trim()) lines.shift();
  const title = (lines.shift() || '').trim();
  // Line 2 is internal scaffolding ("CRM Follow-up Script (Elyon) – Стил на
  // Диабетол Форте | <focus>"). Keep only the customer-focus part after "|".
  const subtitle = (lines.shift() || '').trim();
  const description = subtitle.includes('|') ? subtitle.split('|').pop().trim() : '';
  // Body = everything else; drop the trailing operator "Бележка:" meta note
  // (it documents the script, it is not part of the customer talk track).
  const body = lines
    .filter(l => !/^\s*Бележка\s*:/i.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, description, script_text: body };
}

// ── Main ─────────────────────────────────────────────────────────────────────
const files = readdirSync(DOCS_DIR).filter(f => f.toLowerCase().endsWith('.docx')).sort();
const built = files.map(f => ({ file: f, ...buildScript(join(DOCS_DIR, f)) }));

console.log(`\nFound ${built.length} .docx scripts in ${DOCS_DIR}/\n`);

let existingTitles = new Set();
let supabase = null;
if (COMMIT) {
  supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from('call_scripts')
    .select('title, context_type')
    .eq('context_type', 'product');
  if (error) { console.error('Failed to read existing scripts:', error.message); process.exit(1); }
  existingTitles = new Set((data || []).map(r => r.title.trim().toLowerCase()));
  console.log(`Existing product scripts in DB: ${existingTitles.size}\n`);
}

let inserted = 0, skipped = 0;
for (const s of built) {
  const dupe = existingTitles.has(s.title.trim().toLowerCase());
  const preview = s.script_text.slice(0, 90).replace(/\n/g, ' ');
  if (dupe) {
    console.log(`SKIP (already exists)  "${s.title}"`);
    skipped++;
    continue;
  }
  console.log(`${COMMIT ? 'INSERT' : 'WOULD INSERT'}  "${s.title}"`);
  console.log(`   desc: ${s.description}`);
  console.log(`   body: ${s.script_text.length} chars — ${preview}…\n`);

  if (COMMIT) {
    const { error } = await supabase.from('call_scripts').insert({
      context_type: 'product',
      title: s.title,
      description: s.description || null,
      script_text: s.script_text,
      helpers: [],
      updated_at: new Date().toISOString(),
    });
    if (error) { console.error(`   ERROR inserting "${s.title}": ${error.message}`); continue; }
    inserted++;
  }
}

console.log('\n────────────────────────────────────────');
if (COMMIT) {
  console.log(`Done. Inserted ${inserted}, skipped ${skipped} (already existed).`);
} else {
  console.log(`Dry-run complete. ${built.length} scripts ready.`);
  console.log('Re-run with:  node --env-file=.env scripts/import-call-scripts.mjs --commit');
}
console.log('────────────────────────────────────────\n');
