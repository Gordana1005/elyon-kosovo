import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function fetchAll(table, cols) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(cols).range(from, from + 999);
    if (error) { console.error(error); process.exit(1); }
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const products = await fetchAll('products', 'id, name, sku, barcode, stock_quantity, is_active');
const items = await fetchAll('order_items', 'product_id');
const refCount = {};
for (const it of items) if (it.product_id) refCount[it.product_id] = (refCount[it.product_id] || 0) + 1;

const norm = (s) => (s || '').toLowerCase().replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
// LEGACY = auto-generated SKU and no barcode (these carry the order history, 0 stock).
const isLegacy = (p) => /^sku-\d+/i.test(p.sku || '') || !(p.barcode && p.barcode.trim());
const legacy = products.filter(isLegacy);
const catalog = products.filter(p => !isLegacy(p));

console.log(`CATALOG rows (real SKU+barcode, the keepers): ${catalog.length}`);
console.log(`LEGACY rows (auto-SKU/no barcode): ${legacy.length}\n`);

// Suggest a catalog match for each legacy row by token overlap.
function suggest(leg) {
  const lt = norm(leg.name).split(' ').filter(w => w.length >= 3);
  let best = null, bestScore = 0;
  for (const c of catalog) {
    const cn = norm(c.name);
    let score = 0;
    for (const w of lt) if (cn.includes(w)) score += w.length;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore > 0 ? best : null;
}

console.log('── LEGACY rows → suggested merge target ──');
console.log('(repoint orders to target, then delete legacy. "??" = no match, needs manual decision)\n');
for (const leg of legacy.sort((a, b) => (refCount[b.id] || 0) - (refCount[a.id] || 0))) {
  const t = suggest(leg);
  const tag = t ? `→ "${t.name}" (stock ${t.stock_quantity ?? 0}, ${t.sku})` : '→ ?? NO MATCH';
  console.log(`  "${leg.name}"  [stock ${leg.stock_quantity ?? 0}, orders ${refCount[leg.id] || 0}, ${leg.sku}]`);
  console.log(`        ${tag}\n`);
}

console.log('\n── FULL CATALOG (keepers) ──');
for (const c of catalog.sort((a, b) => norm(a.name).localeCompare(norm(b.name)))) {
  console.log(`  stock ${String(c.stock_quantity ?? 0).padStart(5)}  orders ${String(refCount[c.id] || 0).padStart(5)}  ${c.sku.padEnd(12)} "${c.name}"`);
}
