// Merge legacy duplicate products into their real catalogue rows.
//
// Each legacy row (auto-SKU, 0 stock) carries order history; the real catalogue
// row (NT####/numeric SKU) carries the stock. We REPOINT all references
// (orders, order_items, prediction_lead_items, inventory_logs) from legacy →
// survivor, then DELETE the legacy row. user_warehouse rows cascade-delete.
//
// Stock numbers are NOT changed (decision: "just fix dupes for now"), except
// the explicit Prostatol rename+stock.
//
//   node --env-file=.env scripts/merge-duplicate-products.mjs            # dry-run
//   node --env-file=.env scripts/merge-duplicate-products.mjs --commit   # execute
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const COMMIT = process.argv.slice(2).includes('--commit');

// legacy SKU → survivor SKU
const MERGES = [
  ['SKU-000002', 'NT0057'],  // Curcumactiv          → Curcumactiv (500ml)
  ['SKU-000015', 'NT0057'],  // Curcumactiv (dup)    → Curcumactiv (500ml)
  ['SKU-000004', 'NT0002'],  // Diabetol             → Диабетол Форте
  ['SKU-000001', 'NT0063'],  // Brain                → Brain active (30cps)
  ['SKU-000005', 'NT0025'],  // Snail                → Комплекс от охлюви (30cps)
  ['SKU-000008', '000982'],  // Collagen             → Колаген Пептид со ВАНИЛА 200 гр  (ASSUMED)
  ['SKU-000009', 'NT0143'],  // Enduro               → Enduro Max 30 капсули
  ['SKU-000007', 'NT0066'],  // Broncho              → Broncho Complex
  ['SKU-000006', 'NT0069'],  // Aloe                 → Aloe Vera 500ml
  ['SKU-000010', 'NT0055'],  // Palmetto             → SAW Palmetto
];
const RENAME = { sku: 'SKU-000003', newName: 'Простатол Комплекс', stock: 304 }; // Prostatol
const DEACTIVATE = ['SKU-000016']; // OSTEOfix (no twin; keep 2 orders, hide it)

const REF_TABLES = ['orders', 'order_items', 'prediction_lead_items', 'inventory_logs'];

async function bySku(sku) {
  const { data, error } = await supabase.from('products').select('id, name, sku, stock_quantity, is_active').eq('sku', sku).maybeSingle();
  if (error) { console.error(`lookup ${sku}:`, error.message); process.exit(1); }
  return data;
}
async function refCount(table, productId) {
  const { count } = await supabase.from(table).select('id', { count: 'exact', head: true }).eq('product_id', productId);
  return count || 0;
}

console.log(COMMIT ? '🟢 COMMIT MODE — applying changes\n' : '🔵 DRY-RUN — no changes (add --commit to apply)\n');

// ── MERGES ──
for (const [legSku, survSku] of MERGES) {
  const leg = await bySku(legSku), surv = await bySku(survSku);
  if (!leg) { console.log(`⚠️  legacy ${legSku} not found — skipping`); continue; }
  if (!surv) { console.log(`⚠️  survivor ${survSku} not found — skipping ${legSku}`); continue; }
  if (leg.id === surv.id) { console.log(`⚠️  ${legSku} == ${survSku} — skipping`); continue; }

  const counts = {};
  for (const t of REF_TABLES) counts[t] = await refCount(t, leg.id);
  console.log(`MERGE  "${leg.name}" (${legSku})  →  "${surv.name}" (${survSku})`);
  console.log(`        repoint: ${REF_TABLES.map(t => `${t}=${counts[t]}`).join('  ')}  then DELETE legacy`);

  if (COMMIT) {
    for (const t of REF_TABLES) {
      const { error } = await supabase.from(t).update({ product_id: surv.id }).eq('product_id', leg.id);
      if (error) { console.error(`   ✗ repoint ${t}: ${error.message}`); process.exit(1); }
    }
    const { error: delErr } = await supabase.from('products').delete().eq('id', leg.id);
    if (delErr) { console.error(`   ✗ delete ${legSku}: ${delErr.message}`); process.exit(1); }
    console.log('        ✓ merged + deleted');
  }
}

// ── RENAME (Prostatol) ──
const pros = await bySku(RENAME.sku);
if (pros) {
  console.log(`\nRENAME "${pros.name}" (${RENAME.sku}) → "${RENAME.newName}", stock ${pros.stock_quantity} → ${RENAME.stock} (keeps all orders)`);
  if (COMMIT) {
    const { error } = await supabase.from('products').update({ name: RENAME.newName, stock_quantity: RENAME.stock }).eq('id', pros.id);
    if (error) { console.error(`   ✗ rename: ${error.message}`); process.exit(1); }
    console.log('        ✓ renamed + stock set');
  }
} else console.log(`\n⚠️  Prostatol ${RENAME.sku} not found`);

// ── DEACTIVATE (OSTEOfix) ──
for (const sku of DEACTIVATE) {
  const p = await bySku(sku);
  if (!p) { console.log(`⚠️  ${sku} not found`); continue; }
  const ord = await refCount('order_items', p.id);
  console.log(`\nDEACTIVATE "${p.name}" (${sku}) — hide from catalogue, keep ${ord} order_items`);
  if (COMMIT) {
    const { error } = await supabase.from('products').update({ is_active: false }).eq('id', p.id);
    if (error) { console.error(`   ✗ deactivate: ${error.message}`); process.exit(1); }
    console.log('        ✓ deactivated');
  }
}

// ── Verify ──
if (COMMIT) {
  const { count } = await supabase.from('products').select('id', { count: 'exact', head: true });
  const { count: active } = await supabase.from('products').select('id', { count: 'exact', head: true }).eq('is_active', true);
  console.log(`\n✅ Done. Products now: ${count} total, ${active} active.`);
} else {
  console.log('\n🔵 Dry-run complete. Re-run with --commit to apply.');
}
