import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ── Pull ALL products (paginate past the 1000-row cap) ──
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

const products = await fetchAll('products', 'id, name, sku, barcode, stock_quantity, is_active, created_at');
console.log(`Total product rows: ${products.length}`);
console.log(`  active:   ${products.filter(p => p.is_active).length}`);
console.log(`  inactive: ${products.filter(p => !p.is_active).length}`);
console.log(`  zero/neg stock: ${products.filter(p => (p.stock_quantity ?? 0) <= 0).length}`);

// ── Count order_items references per product (safe-to-delete check) ──
const items = await fetchAll('order_items', 'product_id');
const refCount = {};
for (const it of items) if (it.product_id) refCount[it.product_id] = (refCount[it.product_id] || 0) + 1;

// ── Group by normalized name to find duplicates ──
const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const byName = {};
for (const p of products) (byName[norm(p.name)] ||= []).push(p);
const dupes = Object.entries(byName).filter(([, arr]) => arr.length > 1);

console.log(`\n── EXACT-NAME DUPLICATES (${dupes.length} groups) ──`);
for (const [name, arr] of dupes.sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n  "${arr[0].name}"  (${arr.length} rows)`);
  for (const p of arr) {
    console.log(`     stock=${String(p.stock_quantity ?? 0).padStart(5)}  active=${p.is_active ? 'Y' : 'n'}  orders=${refCount[p.id] || 0}  sku=${p.sku || '-'}  id=${p.id}`);
  }
}

// ── Keyword spotlight (the examples you named) ──
const keywords = ['простат', 'prostat', 'охлюв', 'snail', 'снаил', 'brain', 'мозъ', 'curcum', 'куркум'];
console.log(`\n── KEYWORD SPOTLIGHT ──`);
for (const kw of keywords) {
  const hits = products.filter(p => norm(p.name).includes(kw));
  if (!hits.length) continue;
  console.log(`\n  [${kw}]`);
  for (const p of hits.sort((a, b) => (b.stock_quantity ?? 0) - (a.stock_quantity ?? 0))) {
    console.log(`     stock=${String(p.stock_quantity ?? 0).padStart(5)}  active=${p.is_active ? 'Y' : 'n'}  orders=${refCount[p.id] || 0}  "${p.name}"  id=${p.id}`);
  }
}

// ── Zero-stock, active products (these are the "warehouse says empty") ──
const zeroActive = products.filter(p => p.is_active && (p.stock_quantity ?? 0) <= 0);
console.log(`\n── ZERO-STOCK ACTIVE PRODUCTS (${zeroActive.length}) ──`);
for (const p of zeroActive.sort((a, b) => norm(a.name).localeCompare(norm(b.name)))) {
  console.log(`     orders=${refCount[p.id] || 0}  "${p.name}"  id=${p.id}`);
}
