// Delete webhooks whose slug no longer maps to an active product (left over
// from the product dedupe). SAFETY GUARD: only deletes webhooks with 0 leads,
// so a webhook that has ever captured a lead is never removed.
//
//   node --env-file=.env scripts/delete-stale-webhooks.mjs            # dry-run
//   node --env-file=.env scripts/delete-stale-webhooks.mjs --commit   # delete
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const COMMIT = process.argv.includes('--commit');

const CYR_MAP = {а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sht',ъ:'a',ь:'',ю:'yu',я:'ya'};
const slugify = (s) => String(s||'').toLowerCase().split('').map(ch=>CYR_MAP[ch]??ch).join('').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60);

const { data: webhooks } = await supabase.from('webhooks').select('id, slug, product_name, total_leads');
const { data: products } = await supabase.from('products').select('name').eq('is_active', true);
const activeSlugs = new Set(products.map(p => slugify(p.name)));

const stale = webhooks.filter(w => !activeSlugs.has(w.slug) && (w.total_leads || 0) === 0);
const staleWithLeads = webhooks.filter(w => !activeSlugs.has(w.slug) && (w.total_leads || 0) > 0);

console.log(COMMIT ? '🟢 COMMIT MODE\n' : '🔵 DRY-RUN (add --commit)\n');
console.log(`Stale to delete (0 leads): ${stale.length}`);
for (const w of stale) console.log(`   /${w.slug}  "${w.product_name}"`);
if (staleWithLeads.length) {
  console.log(`\n⚠️  KEPT — stale but have leads (not deleting): ${staleWithLeads.length}`);
  for (const w of staleWithLeads) console.log(`   /${w.slug}  leads=${w.total_leads}  "${w.product_name}"`);
}

if (COMMIT && stale.length) {
  const { error } = await supabase.from('webhooks').delete().in('id', stale.map(w => w.id));
  if (error) { console.error('Delete failed:', error.message); process.exit(1); }
  console.log(`\n✅ Deleted ${stale.length} stale webhooks.`);
} else if (!COMMIT) {
  console.log('\n🔵 Dry-run only.');
}
