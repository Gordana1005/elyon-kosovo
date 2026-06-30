#!/usr/bin/env node
// Quick sanity check on the imported orders.
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { count: orderCount } = await supabase.from('orders').select('*', { count: 'exact', head: true });
const { count: itemCount } = await supabase.from('order_items').select('*', { count: 'exact', head: true });
const { count: noteCount } = await supabase.from('order_notes').select('*', { count: 'exact', head: true });
const { count: productCount } = await supabase.from('products').select('*', { count: 'exact', head: true });

console.log(`orders:       ${orderCount}`);
console.log(`order_items:  ${itemCount}`);
console.log(`order_notes:  ${noteCount}`);
console.log(`products:     ${productCount}`);

// Status breakdown
const { data: byStatus } = await supabase.rpc('exec_sql', {}).select().limit(0); // not avail; use multiple queries

const statuses = ['paid', 'pending', 'shipped', 'returned', 'cancelled', 'confirmed', 'delivered'];
console.log('\nBy status:');
for (const s of statuses) {
  const { count } = await supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', s);
  console.log(`  ${s.padEnd(12)} ${count ?? 0}`);
}

// Currency check: total EUR sum across all orders (paginated — Supabase JS caps each query at 1k rows)
let total = 0;
let from = 0;
const PAGE = 1000;
while (true) {
  const { data: page } = await supabase.from('orders').select('price').range(from, from + PAGE - 1);
  if (!page || page.length === 0) break;
  total += page.reduce((s, o) => s + Number(o.price || 0), 0);
  if (page.length < PAGE) break;
  from += PAGE;
}
console.log(`\nTotal EUR across orders: €${total.toFixed(2)}`);

// Fallback-date count (orders with our synthetic 2024-06-01 created_at)
const { count: fallbackCount } = await supabase
  .from('orders')
  .select('*', { count: 'exact', head: true })
  .eq('created_at', '2024-06-01T12:00:00+00:00');
console.log(`Orders with fallback date (2024-06-01): ${fallbackCount ?? 0}`);

// Date range
const { data: minDate } = await supabase.from('orders').select('created_at').order('created_at', { ascending: true }).limit(1);
const { data: maxDate } = await supabase.from('orders').select('created_at').order('created_at', { ascending: false }).limit(1);
console.log(`\nDate range: ${minDate?.[0]?.created_at} → ${maxDate?.[0]?.created_at}`);

// Product breakdown
const { data: products } = await supabase.from('products').select('id, name');
console.log('\nBy canonical product:');
for (const p of products || []) {
  const { count } = await supabase.from('orders').select('*', { count: 'exact', head: true }).eq('product_id', p.id);
  console.log(`  ${p.name.padEnd(15)} ${count ?? 0}`);
}

// Sample 3 orders
const { data: samples } = await supabase
  .from('orders')
  .select('display_id, customer_name, customer_phone, customer_city, product_name, price, status, created_at')
  .order('created_at', { ascending: true })
  .limit(3);
console.log('\nFirst 3 orders chronologically:');
for (const s of samples || []) console.log('  ' + JSON.stringify(s));
