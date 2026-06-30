#!/usr/bin/env node
// Bulk-create one inbound webhook per active product.
//
// Why: landing pages are wired one-per-product — the URL the form POSTs to
// tells the CRM which product the lead is interested in. So every active
// product needs its own webhook in public.webhooks. Doing this manually in
// the GUI for 44 products is tedious and error-prone.
//
// Idempotent: upserts on `slug`. Re-runnable. Only inserts/updates the
// product_name + description; existing total_leads, status, created_by stay.
//
// Usage:
//   node --env-file=.env scripts/create-webhooks-for-products.mjs           # dry-run
//   node --env-file=.env scripts/create-webhooks-for-products.mjs --commit  # actually write

import { createClient } from '@supabase/supabase-js';

const COMMIT = process.argv.includes('--commit');
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Cyrillic → Latin so a product like "Куркумактив" yields a clean URL slug.
const CYR_MAP = {
  а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',
  м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',
  ш:'sh',щ:'sht',ъ:'a',ь:'',ю:'yu',я:'ya',
};
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .split('')
    .map(ch => CYR_MAP[ch] ?? ch)
    .join('')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip Latin diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

async function pickAdminUserId() {
  const { data, error } = await supabase
    .from('user_roles')
    .select('user_id')
    .eq('role', 'admin')
    .limit(1)
    .single();
  if (error || !data) throw new Error('No admin user found in user_roles — cannot satisfy webhooks.created_by NOT NULL');
  return data.user_id;
}

async function main() {
  console.log(COMMIT ? '── COMMIT MODE — will write to DB ──' : '── DRY RUN — pass --commit to apply ──');

  const createdBy = await pickAdminUserId();
  console.log(`created_by will be admin user: ${createdBy}`);

  // 1. All active products
  const { data: products, error: prodErr } = await supabase
    .from('products')
    .select('id, name, sku')
    .eq('is_active', true)
    .order('name', { ascending: true });
  if (prodErr) throw prodErr;
  console.log(`Found ${products.length} active products.`);

  // 2. Existing webhooks
  const { data: existing, error: whErr } = await supabase
    .from('webhooks')
    .select('id, slug, product_name');
  if (whErr) throw whErr;
  const existingBySlug = new Map((existing || []).map(w => [w.slug, w]));
  console.log(`Found ${existing.length} existing webhooks.`);

  // 3. Resolve slug collisions: if two products slugify to the same value,
  // append a counter so each product gets a distinct webhook.
  const plan = [];
  const slugSeen = new Set();
  for (const p of products) {
    let base = slugify(p.name);
    if (!base) base = (p.sku || p.id).toLowerCase();
    let slug = base;
    let n = 2;
    while (slugSeen.has(slug)) { slug = `${base}-${n++}`; }
    slugSeen.add(slug);

    const existingRow = existingBySlug.get(slug);
    plan.push({
      product_id: p.id,
      product_name: p.name,
      slug,
      action: existingRow ? 'update' : 'insert',
      existingId: existingRow?.id || null,
    });
  }

  // 4. Print plan
  const toInsert = plan.filter(x => x.action === 'insert');
  const toUpdate = plan.filter(x => x.action === 'update');
  console.log(`\nPlan: ${toInsert.length} INSERT, ${toUpdate.length} UPDATE (idempotent).`);
  for (const row of plan) {
    console.log(`  ${row.action.padEnd(6)} ${row.slug.padEnd(40)} → "${row.product_name}"`);
  }

  if (!COMMIT) {
    console.log('\nDry run — no writes. Re-run with --commit.');
    return;
  }

  // 5. Apply
  let inserted = 0, updated = 0, failed = 0;
  for (const row of plan) {
    const payload = {
      product_name: row.product_name,
      description: `Auto-created webhook for "${row.product_name}". Wire your landing-page form for this product to POST here.`,
      slug: row.slug,
      created_by: createdBy,
    };
    if (row.action === 'update') {
      const { error } = await supabase
        .from('webhooks')
        .update({ product_name: payload.product_name, description: payload.description })
        .eq('id', row.existingId);
      if (error) { failed++; console.error(`  UPDATE failed ${row.slug}:`, error.message); }
      else updated++;
    } else {
      const { error } = await supabase.from('webhooks').insert(payload);
      if (error) { failed++; console.error(`  INSERT failed ${row.slug}:`, error.message); }
      else inserted++;
    }
  }

  console.log(`\nDone — inserted: ${inserted}, updated: ${updated}, failed: ${failed}.`);
  console.log(`\nLanding-page URL template:`);
  console.log(`  ${SUPABASE_URL}/functions/v1/api/webhook/<slug>`);
}

main().catch(e => { console.error(e); process.exit(1); });
