import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CYR_MAP = {а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sht',ъ:'a',ь:'',ю:'yu',я:'ya'};
const slugify = (s) => String(s||'').toLowerCase().split('').map(ch=>CYR_MAP[ch]??ch).join('').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60);

const { data: webhooks } = await supabase.from('webhooks').select('slug, product_name, status, total_leads').order('product_name');
const { data: products } = await supabase.from('products').select('name, is_active, stock_quantity');
const active = products.filter(p => p.is_active);
const activeSlugs = new Set(active.map(p => slugify(p.name)));
const activeNames = new Set(active.map(p => p.name));

console.log(`Webhooks: ${webhooks.length}  |  active products: ${active.length}`);
console.log(`  active webhooks: ${webhooks.filter(w=>w.status==='active').length}  disabled: ${webhooks.filter(w=>w.status!=='active').length}`);
const totalLeads = webhooks.reduce((t,w)=>t+(w.total_leads||0),0);
console.log(`  total leads captured across all webhooks: ${totalLeads}`);

// Webhooks whose slug doesn't match any current active product = STALE
const stale = webhooks.filter(w => !activeSlugs.has(w.slug));
console.log(`\n── STALE webhooks (slug no longer maps to an active product): ${stale.length} ──`);
for (const w of stale.sort((a,b)=>(b.total_leads||0)-(a.total_leads||0))) {
  console.log(`   leads=${String(w.total_leads||0).padStart(5)}  ${w.status.padEnd(8)} /${w.slug.padEnd(34)} "${w.product_name}"`);
}

// Active products with NO webhook (by slug) = GAP
const haveSlug = new Set(webhooks.map(w => w.slug));
const gaps = active.filter(p => !haveSlug.has(slugify(p.name)));
console.log(`\n── ACTIVE products with NO webhook: ${gaps.length} ──`);
for (const p of gaps) console.log(`   "${p.name}"  (would be slug: ${slugify(p.name)})`);

// Disabled webhooks
const disabled = webhooks.filter(w => w.status !== 'active');
if (disabled.length) {
  console.log(`\n── DISABLED webhooks: ${disabled.length} ──`);
  for (const w of disabled) console.log(`   /${w.slug}  "${w.product_name}"`);
}
