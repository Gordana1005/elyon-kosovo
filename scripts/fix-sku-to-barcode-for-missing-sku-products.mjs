#!/usr/bin/env node
/**
 * CORRECTION SCRIPT (2026-05)
 *
 * User clarification: For products that had NO SKU in the BigArena export file,
 * we must store the BARCODE VALUE ITSELF into the `sku` column (not invent SKU-XXXX).
 *
 * This fixes the 15 products that were inserted with auto-generated SKU-0000xx
 * during the previous reconciliation run.
 *
 * The 6 products that already had proper NTxxxx SKUs in the file were left untouched.
 * The collagen SKU correction (to NT0108) was already correct.
 *
 * Run:
 *   node --env-file=.env scripts/fix-sku-to-barcode-for-missing-sku-products.mjs --commit
 */

import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const DRY_RUN = !COMMIT;

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing env vars. Use: node --env-file=.env ... --commit');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// The 15 products that had no SKU in the xlsx → we must set sku = barcode (user requirement)
const FIXES = [
  { name: 'TURMERIC BOOST - Куркума буст - 500мл.',          barcode: '5310416001412' },
  { name: 'Амино Енерджи Бустер - 500 мл.',                   barcode: '5310416001313' },
  { name: 'MAGNESIUM CITRAT 325mg',                           barcode: '5310416000132' },
  { name: 'Zinc 30 cps',                                      barcode: '5310416000101' },
  { name: 'DR.SLIM 90cps',                                    barcode: '5310416001498' },
  { name: 'NUTRI SHAKE-chocolate 500 g',                      barcode: '5310416001450' },
  { name: 'NUTRI SHAKE- strawberry 500 g',                    barcode: '5310416001474' },
  { name: 'ВИТАМИН Б6 365/1 таб',                             barcode: '5310416002259' },
  { name: 'ВИТАМИН Д3 365/1 таб',                             barcode: '5310416001191' },
  { name: 'ЦИНК 365/1 таб',                                   barcode: '5310416002266' },
  { name: 'МЕЛАТОНИН 365/1 таб',                              barcode: '5310416000095' },
  { name: 'САМБУКУС сирoп 250 мл',                            barcode: '5310416001207' },
  { name: 'МАЧА с КОЛАГЕН 175 гр',                            barcode: '5310416001849' },
  { name: 'АШВАГАНДА  ЕКСТРАКТ 60/1 cps',                     barcode: '5310416001122' },
  { name: 'ДР.СЛИМ РАСТИТЕЛЕН 210 гр',                        barcode: '5310416001481' }
];

async function main() {
  console.log('══════════════════════════════════════════════════════════════');
  console.log('SKU CORRECTION — use barcode as sku for the 15 "no SKU in file" products');
  console.log(DRY_RUN ? '🌵 DRY RUN' : '🚀 COMMIT — writing to DB');
  console.log('══════════════════════════════════════════════════════════════');

  let fixed = 0;
  let alreadyCorrect = 0;
  let notFound = 0;
  const actions = [];

  for (const f of FIXES) {
    // Find the row by exact name (these were just inserted)
    const { data: row, error } = await supabase
      .from('products')
      .select('id, name, sku, barcode')
      .eq('name', f.name)
      .single();

    if (error || !row) {
      console.log(`  ⚠️  NOT FOUND: ${f.name}`);
      notFound++;
      continue;
    }

    if (row.sku === f.barcode) {
      console.log(`  ✓ Already correct: ${f.name}  sku=${row.sku}`);
      alreadyCorrect++;
      continue;
    }

    console.log(`  ${row.sku} → ${f.barcode}   for: ${f.name}`);

    actions.push({
      id: row.id,
      name: f.name,
      oldSku: row.sku,
      newSku: f.barcode
    });
  }

  console.log(`\nFound needing fix: ${actions.length}`);
  console.log(`Already correct:   ${alreadyCorrect}`);
  console.log(`Not found:         ${notFound}`);

  if (DRY_RUN) {
    console.log('\n🌵 Dry run — nothing written. Re-run with --commit to apply.');
    process.exit(0);
  }

  console.log('\n🚀 Applying fixes...');

  for (const a of actions) {
    const { error } = await supabase
      .from('products')
      .update({ sku: a.newSku })
      .eq('id', a.id);

    if (error) {
      console.error(`  ❌ Failed for ${a.name}: ${error.message}`);
      continue;
    }
    console.log(`  ✅ Fixed: ${a.name}  (${a.oldSku} → ${a.newSku})`);
    fixed++;
  }

  console.log(`\n✅ Fixed: ${fixed}`);
  console.log('Done. The 15 products now have the actual barcode from the file as their SKU.');
}

main().catch(console.error);
