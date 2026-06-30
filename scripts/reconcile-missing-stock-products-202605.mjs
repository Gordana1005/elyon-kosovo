#!/usr/bin/env node
/**
 * One-off stock reconciliation (2026-05).
 *
 * Purpose:
 *   - Correct the SKU on the existing "Колаген Пептид со ВАНИЛА 200 гр" from the legacy
 *     '000982' to the proper original 'NT0108' that appears in the latest BigArena panel export.
 *   - Insert the 21 genuinely missing products that have positive stock in the warehouse
 *     export but were never created in the CRM catalogue.
 *
 * Rules applied (per operator instructions):
 *   - "Комплекс от охлюви (30cps)" [NT0025] — duplicate of existing Snail Complex → SKIP
 *   - "Osteo Fix (30cps)" [NT0140] — leave exactly as it is in the CRM → SKIP
 *   - "SNAIL COMPLEX 30+30cps" [NT0088] — do not add → SKIP
 *   - Collagen: only update the SKU (barcode already matches, keep current live stock, keep name)
 *   - Products without SKU in the export → insert with barcode only (trigger will generate SKU-XXXXXX)
 *   - Products with proper SKU in the export → use that SKU on insert (it is the "original")
 *   - All inserts get an inventory_logs row with reason 'bigarena_import' (consistent with normal imports)
 *
 * Usage (dry-run is default and safe):
 *   node --env-file=.env scripts/reconcile-missing-stock-products-202605.mjs
 *   node --env-file=.env scripts/reconcile-missing-stock-products-202605.mjs --commit
 *
 * The .env must contain a real SUPABASE_SERVICE_ROLE_KEY (from docs/VAULT.md) for --commit.
 * The key is never committed.
 *
 * This script is intentionally a one-off and can be deleted after the run.
 */

import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const DRY_RUN = !COMMIT;

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
  console.error('Run with:  node --env-file=.env scripts/reconcile-missing-stock-products-202605.mjs [--commit]');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const normalizeName = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// ────────────────────────────────────────────────────────────────────────────
// EXACT DATA FROM D:\stock.xlsx (only the rows we are acting on)
// ────────────────────────────────────────────────────────────────────────────

const COLLAGEN_UPDATE = {
  id: '24dfb42b-dcd3-4246-adc3-96b122c8c53a',
  current_sku: '000982',
  new_sku: 'NT0108',
  name: 'Колаген Пептид со ВАНИЛА 200 гр',
  barcode: '5310416000743'
};

// The 21 products to INSERT (in the exact order from the export for readability).
// sku: string | null   → when null we let the trigger generate one
const TO_INSERT = [
  { name: 'TURMERIC BOOST - Куркума буст - 500мл.',          sku: null, barcode: '5310416001412', stock: 341 },
  { name: 'Амино Енерджи Бустер - 500 мл.',                   sku: null, barcode: '5310416001313', stock: 341 },
  { name: 'MAGNESIUM CITRAT 325mg',                           sku: null, barcode: '5310416000132', stock: 229 },
  { name: 'Vitamin B6',                                       sku: 'NT0132', barcode: '5310416000156', stock: 123 },
  { name: 'Vitamin D3',                                       sku: 'NT0131', barcode: '5310416000149', stock: 115 },
  { name: 'Zinc 30 cps',                                      sku: null, barcode: '5310416000101', stock: 100 },
  { name: 'DR.SLIM 90cps',                                    sku: null, barcode: '5310416001498', stock: 100 },
  { name: 'NUTRI SHAKE-chocolate 500 g',                      sku: null, barcode: '5310416001450', stock: 98 },
  { name: 'NUTRI SHAKE- strawberry 500 g',                    sku: null, barcode: '5310416001474', stock: 98 },
  { name: 'ВИТАМИН Б6 365/1 таб',                             sku: null, barcode: '5310416002259', stock: 90 },
  { name: 'ВИТАМИН Д3 365/1 таб',                             sku: null, barcode: '5310416001191', stock: 70 },
  { name: 'ЦИНК 365/1 таб',                                   sku: null, barcode: '5310416002266', stock: 70 },
  { name: 'МЕЛАТОНИН 365/1 таб',                              sku: null, barcode: '5310416000095', stock: 70 },
  { name: 'САМБУКУС сирoп 250 мл',                            sku: null, barcode: '5310416001207', stock: 60 },
  { name: 'МАЧА с КОЛАГЕН 175 гр',                            sku: null, barcode: '5310416001849', stock: 56 },
  { name: 'АШВАГАНДА  ЕКСТРАКТ 60/1 cps',                     sku: null, barcode: '5310416001122', stock: 50 },
  { name: 'ДР.СЛИМ РАСТИТЕЛЕН 210 гр',                        sku: null, barcode: '5310416001481', stock: 38 },
  { name: 'Jade Roler',                                       sku: 'NT0090', barcode: '6901722300437', stock: 8 },
  { name: 'Vitamin C complex',                                sku: 'NT0130', barcode: '5319991983243', stock: 6 },
  { name: 'Whey Protein 1.5 kg с вкус на шоколад',            sku: 'NT0121', barcode: '5310416000811', stock: 3 },
  { name: 'Whey Protein 1.5 kg с вкус на ванилия',            sku: 'NT0122', barcode: '5310416000804', stock: 2 }
];

// The three we are deliberately skipping (documented only)
const SKIPPED = [
  { name: 'Комплекс от охлюви (30cps)', reason: 'duplicate of existing Snail Complex (NT0025)' },
  { name: 'Osteo Fix (30cps)',          reason: 'operator: leave exactly as it is in the CRM' },
  { name: 'SNAIL COMPLEX 30+30cps',     reason: 'operator: do not add' }
];

async function main() {
  console.log('══════════════════════════════════════════════════════════════');
  console.log('STOCK RECONCILIATION — 2026-05 (one-off)');
  console.log('Source: D:\\stock.xlsx (BigArena Fulfillment Panel)');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(DRY_RUN ? '🌵 DRY RUN (no writes)' : '🚀 COMMIT MODE — writing to DB');
  console.log();

  // Load current products for collision checks (same pattern as bigarena importer)
  const existingBySku = new Map();
  const existingByNameNorm = new Map();
  {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('products')
        .select('id, sku, name, barcode, stock_quantity, is_active')
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const p of data) {
        if (p.sku) existingBySku.set(p.sku, p);
        const norm = normalizeName(p.name);
        if (norm) existingByNameNorm.set(norm, p);
      }
      if (data.length < PAGE) break;
    }
  }
  console.log(`🗂  Loaded ${existingBySku.size} products with SKU + ${existingByNameNorm.size} by normalized name.`);

  // ── 1. Collagen SKU correction ───────────────────────────────────────────
  console.log('\n── Collagen SKU correction ──────────────────────────────────');
  const currentCollagen = existingBySku.get(COLLAGEN_UPDATE.current_sku) ||
                          Array.from(existingByNameNorm.values()).find(p => p.id === COLLAGEN_UPDATE.id);

  if (!currentCollagen) {
    console.log('  ⚠️  Could not find the collagen row by id or current SKU. Aborting.');
    process.exit(1);
  }

  if (currentCollagen.sku === COLLAGEN_UPDATE.new_sku) {
    console.log(`  ✓ Already has the correct SKU (${COLLAGEN_UPDATE.new_sku}). Nothing to do.`);
  } else {
    console.log(`  Current: sku=${currentCollagen.sku}  name="${currentCollagen.name}"`);
    console.log(`  Target : sku=${COLLAGEN_UPDATE.new_sku} (barcode already matches)`);

    if (!DRY_RUN) {
      const { error } = await supabase
        .from('products')
        .update({ sku: COLLAGEN_UPDATE.new_sku })
        .eq('id', currentCollagen.id);
      if (error) {
        console.error('  ❌ Update failed:', error.message);
        process.exit(1);
      }
      console.log('  ✅ SKU updated in DB.');
    } else {
      console.log('  (would UPDATE sku on this row)');
    }
  }

  // ── 2. The 21 inserts ────────────────────────────────────────────────────
  console.log('\n── New products to insert (21) ──────────────────────────────');
  let wouldInsert = 0;
  let wouldSkipCollision = 0;
  const insertPlan = [];

  for (const item of TO_INSERT) {
    const norm = normalizeName(item.name);
    const bySku = item.sku ? existingBySku.get(item.sku) : null;
    const byName = existingByNameNorm.get(norm);

    if (bySku || byName) {
      console.log(`  ⏭  SKIP (already exists): ${item.name}  [${item.sku || 'no-sku'}]`);
      wouldSkipCollision++;
      continue;
    }

    insertPlan.push(item);
    wouldInsert++;
    const skuDisplay = item.sku || '(trigger will generate)';
    console.log(`  + ${item.name.padEnd(42)}  sku=${skuDisplay.padEnd(10)}  stock=${String(item.stock).padStart(4)}  bc=${item.barcode}`);
  }

  if (wouldInsert === 0) {
    console.log('  (no new inserts needed — all already present or skipped by collision check)');
  }

  // ── 3. Skipped (for the record) ──────────────────────────────────────────
  console.log('\n── Explicitly skipped (per your rules) ──────────────────────');
  for (const s of SKIPPED) {
    console.log(`  − ${s.name}  — ${s.reason}`);
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`Planned actions:`);
  console.log(`  • Collagen SKU correction : ${currentCollagen.sku === COLLAGEN_UPDATE.new_sku ? 'already correct' : '1 update'}`);
  console.log(`  • New products to insert  : ${wouldInsert}`);
  console.log(`  • Skipped by collision    : ${wouldSkipCollision}`);
  console.log(`  • Explicitly not touched  : ${SKIPPED.length}`);

  if (DRY_RUN) {
    console.log('\n🌵 This was a dry run. Re-run with --commit to perform the writes.');
    console.log('   (Make sure the real SERVICE_ROLE_KEY is in your .env)');
    process.exit(0);
  }

  // ── COMMIT ───────────────────────────────────────────────────────────────
  console.log('\n🚀 COMMIT — performing writes...');

  let inserted = 0;
  let stockLogged = 0;
  const failures = [];

  for (const item of insertPlan) {
    const insertRow = {
      name: item.name,
      barcode: item.barcode,
      stock_quantity: item.stock,
      is_active: true,
      price: 0,
      description: ''
    };
    if (item.sku) insertRow.sku = item.sku;

    const { data: ins, error: insErr } = await supabase
      .from('products')
      .insert(insertRow)
      .select('id, stock_quantity, sku')
      .single();

    if (insErr) {
      failures.push({ name: item.name, error: insErr.message });
      continue;
    }

    // Write the initial stock log (exactly like bigarena_import does)
    const logErr = await supabase.from('inventory_logs').insert({
      product_id: ins.id,
      change_amount: item.stock,
      previous_stock: 0,
      new_stock: item.stock,
      reason: 'bigarena_import'
    });

    if (logErr.error) {
      console.warn(`  ⚠️  Inserted product but failed to write inventory log for ${item.name}: ${logErr.error.message}`);
    } else {
      stockLogged++;
    }

    inserted++;
    console.log(`  ✅ Inserted: ${ins.sku} — ${item.name} (stock=${item.stock})`);
  }

  console.log('\n──────────────────────────────────────────────');
  console.log(`✅ Products inserted : ${inserted}`);
  console.log(`📦 inventory_logs written : ${stockLogged}`);
  if (failures.length > 0) {
    console.log(`❌ Failures: ${failures.length}`);
    for (const f of failures) console.log(`     ${f.name}: ${f.error}`);
  }

  console.log('\nDone. You can now verify in /products and in the inventory logs.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
