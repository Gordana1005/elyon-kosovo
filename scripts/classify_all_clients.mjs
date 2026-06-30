#!/usr/bin/env node
/**
 * classify_all_clients.mjs
 * Classifies every phone into the new proposed structure.
 * Run with production env vars.
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function paginate(queryFn, pageSize = 1000) {
  const all = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await queryFn().range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
  }
  return all;
}

function getRecencyBucket(days) {
  if (days <= 21) return '0-21d';
  if (days <= 57) return '22-57d';
  if (days <= 120) return '58-120d';
  if (days <= 180) return '121-180d';
  if (days <= 365) return '181-365d';
  if (days <= 730) return '1-2yr';
  return '2yr+';
}

function getFreqBucket(count) {
  if (count === 0) return '0';
  if (count <= 3) return '1-3';
  if (count <= 5) return '3-5';
  if (count <= 7) return '5-7';
  return '7+';
}

function getValueBucket(price) {
  return (price || 0) <= 26 ? '≤26' : '26+';
}

(async () => {
  console.log('Fetching all orders...');
  const orders = await paginate(() => supabase.from('orders').select('customer_phone, status, price, created_at').not('customer_phone', 'is', null));

  const phones = {};
  orders.forEach(o => {
    const p = o.customer_phone;
    if (!phones[p]) phones[p] = { paidCount: 0, lastPaidAt: null, lastPaidPrice: 0, orders: [] };
    phones[p].orders.push(o);
    if (o.status === 'paid') {
      phones[p].paidCount++;
      const d = new Date(o.created_at);
      if (!phones[p].lastPaidAt || d > new Date(phones[p].lastPaidAt)) {
        phones[p].lastPaidAt = o.created_at;
        phones[p].lastPaidPrice = Number(o.price || 0);
      }
    }
  });

  const buckets = {};
  const samples = [];

  Object.keys(phones).forEach(phone => {
    const d = phones[phone];
    let bucketName = 'Never-Converted';

    if (d.paidCount > 0 && d.lastPaidAt) {
      const days = Math.floor((Date.now() - new Date(d.lastPaidAt).getTime()) / (1000*60*60*24));
      const rec = getRecencyBucket(days);
      const val = getValueBucket(d.lastPaidPrice);
      const freq = getFreqBucket(d.paidCount);
      bucketName = `${rec} ${val} (${freq})`;
    } else {
      // find most recent non-paid for rough recency
      const nonPaid = d.orders.filter(o => o.status !== 'paid').sort((a,b) => new Date(b.created_at) - new Date(a.created_at))[0];
      if (nonPaid) {
        const days = Math.floor((Date.now() - new Date(nonPaid.created_at).getTime()) / (1000*60*60*24));
        const rec = getRecencyBucket(days);
        bucketName = `Never-Converted (${rec})`;
      }
    }

    buckets[bucketName] = (buckets[bucketName] || 0) + 1;

    if (samples.length < 30) {
      samples.push({
        phone: phone.slice(-8),
        paid: d.paidCount,
        lastPrice: d.lastPaidPrice,
        bucket: bucketName
      });
    }
  });

  console.log('=== BUCKET COUNTS ===');
  Object.entries(buckets).sort((a,b) => b[1]-a[1]).forEach(([b,c]) => console.log(`${b}: ${c}`));

  console.log('\nTotal phones classified:', Object.keys(phones).length);

  fs.writeFileSync('bucket_counts.json', JSON.stringify(buckets, null, 2));
  fs.writeFileSync('samples.json', JSON.stringify(samples, null, 2));

  console.log('\nReports written: bucket_counts.json and samples.json');
})();
