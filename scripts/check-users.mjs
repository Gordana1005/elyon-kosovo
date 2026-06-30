import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: profiles } = await supabase.from('profiles').select('user_id, full_name, email, is_active');
console.log(`Profiles: ${profiles?.length || 0}`);
for (const p of (profiles || [])) {
  console.log(`  ${p.user_id}  "${p.full_name}"  <${p.email}>  active=${p.is_active}`);
}
