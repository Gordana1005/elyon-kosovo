#!/usr/bin/env node
/**
 * analyze_new_prediction_lists_full.mjs
 *
 * Full production analysis for the new prediction list structure.
 *
 * Run this on your machine against the REAL full production database:
 *
 *   VITE_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/analyze_new_prediction_lists_full.mjs
 *
 * It will:
 * - Process every single phone with orders (paginated, safe)
 * - Assign every client to the exact proposed bucket
 * - Generate a detailed report + CSV mapping
 * - Give you the final numbers for every list you described
 *
 * No changes to the database. Read-only.
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const NOW = Date.now();

function getRecencyBucket(days) {
  if (days <= 21) return '0-21d';
  if (days <= 57) return '22-57d';
  if (days <= 120) return '58-120d';
  if (days <= 180) return '121-180d';
  if (days <= 365) return '181-365d';
  if (days <= 730) return '1-2yr';
  return '2yr+';
}

function getFrequencyBucket(paidCount) {
  if (paidCount === 0) return '0';
  if (paidCount <= 3) return '1-3';
  if (paidCount <= 5) return '3-5';
  if (paidCount <= 7) return '5-7';
  return '7+';
}

function getValueBucket(price) {
  return (price || 0) <= 26 ? '≤26€' : '26+';
}

async function paginate(queryBuilder, pageSize = 1000) {
  const all = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await queryBuilder.range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
  }
  return all;
}

(async () => {
  console.log('=== FULL PRODUCTION ANALYSIS FOR NEW PREDICTION LISTS ===\n');

  console.log('Fetching all orders (paginated)...');
  const allOrders = await paginate(() =>
    supabase
      .from('orders')
      .select('customer_phone, status, price, created_at')
      .not('customer_phone', 'is', null)
      .not('customer_phone', 'eq', '')
  );

  console.log(`Total order rows: ${allOrders.length}`);

  // Build per-phone data
  const phoneMap = {};
  allOrders.forEach(o => {
    const p = o.customer_phone;
    if (!phoneMap[p]) {
      phoneMap[p] = {
        orders: [],
        paidCount: 0,
        lastPaidAt: null,
        lastPaidPrice: 0,
        lifetimePaid: 0,
      };
    }
    const data = phoneMap[p];
    data.orders.push(o);

    if (o.status === 'paid') {
      data.paidCount++;
      data.lifetimePaid += Number(o.price || 0);
      const created = new Date(o.created_at);
      if (!data.lastPaidAt || created > new Date(data.lastPaidAt)) {
        data.lastPaidAt = o.created_at;
        data.lastPaidPrice = Number(o.price || 0);
      }
    }
  });

  const phones = Object.keys(phoneMap);
  console.log(`Total unique phones with orders: ${phones.length}\n`);

  // Build the mapping
  const mapping = [];
  const bucketCounts = {};

  phones.forEach(phone => {
    const d = phoneMap[phone];

    let recency = 'never-paid';
    let valueBucket = 'N/A';
    let freqBucket = '0';
    let proposedList = 'Never-Converted';

    if (d.paidCount > 0 && d.lastPaidAt) {
      const days = Math.floor((NOW - new Date(d.lastPaidAt).getTime()) / (1000 * 60 * 60 * 24));
      recency = getRecencyBucket(days);
      valueBucket = getValueBucket(d.lastPaidPrice);
      freqBucket = getFrequencyBucket(d.paidCount);

      proposedList = `${recency} ${valueBucket} (${freqBucket} orders)`;
    } else {
      // Pure non-buyer - use most recent non-paid for recency (simplified)
      const lastNonPaid = d.orders
        .filter(o => o.status !== 'paid')
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

      if (lastNonPaid) {
        const days = Math.floor((NOW - new Date(lastNonPaid.created_at).getTime()) / (1000 * 60 * 60 * 24));
        recency = getRecencyBucket(days);
      }
      proposedList = `Never-Converted (${recency})`;
    }

    if (!bucketCounts[proposedList]) bucketCounts[proposedList] = 0;
    bucketCounts[proposedList]++;

    // Store sample-friendly row (last 8 digits for privacy in this env)
    const last8 = phone.slice(-8);
    mapping.push({
      phone_last8: last8,
      paid_count: d.paidCount,
      last_paid_price: d.lastPaidPrice || null,
      recency_bucket: recency,
      value_bucket: valueBucket,
      frequency_bucket: freqBucket,
      proposed_list: proposedList,
      lifetime_paid: Math.round(d.lifetimePaid * 100) / 100,
    });
  });

  // Summary
  console.log('=== PROPOSED LIST COUNTS ===');
  Object.entries(bucketCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([list, count]) => {
      console.log(`${list}: ${count}`);
    });

  console.log(`\nTotal phones mapped: ${phones.length}`);

  // Write detailed report
  const report = [
    '# Full Client Mapping to New Prediction List Structure',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Total phones: ${phones.length}`,
    '',
    '## Bucket Counts',
    '',
  ];

  Object.entries(bucketCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([list, count]) => {
      report.push(`- **${list}**: ${count}`);
    });

  report.push('');
  report.push('## Sample Clients (last 8 digits + summary)');
  report.push('');

  // Take diverse samples
  const samples = mapping.slice(0, 30);
  samples.forEach(m => {
    report.push(`**${m.phone_last8}**`);
    report.push(`- Paid orders: ${m.paid_count}`);
    report.push(`- Last paid price: ${m.last_paid_price ? '€' + m.last_paid_price : 'N/A'}`);
    report.push(`- Proposed list: ${m.proposed_list}`);
    report.push(`- Lifetime paid: €${m.lifetime_paid}`);
    report.push('');
  });

  fs.writeFileSync('client_mapping_report.md', report.join('\n'));
  console.log('\nDetailed report written to: client_mapping_report.md');

  // Also write CSV for easy filtering
  const csvHeader = 'phone_last8,paid_count,last_paid_price,recency_bucket,value_bucket,frequency_bucket,proposed_list,lifetime_paid\n';
  const csvRows = mapping.map(m =>
    `${m.phone_last8},${m.paid_count},${m.last_paid_price || ''},${m.recency_bucket},${m.value_bucket},${m.frequency_bucket},"${m.proposed_list}",${m.lifetime_paid}`
  ).join('\n');

  fs.writeFileSync('client_mapping_full.csv', csvHeader + csvRows);
  console.log('Full mapping CSV written to: client_mapping_full.csv');

  console.log('\n=== DONE ===');
  console.log('Run this script on your real full production database for the complete picture.');
})();
