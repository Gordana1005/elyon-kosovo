// Mirrors role_privacy masking: team leads see masked customer data; agents see their own
// customers in full; superadmin sees everything.
export function maskName(name?: string | null): string {
  const n = (name || '').trim();
  if (!n) return '—';
  const parts = n.split(/\s+/);
  const first = parts[0];
  const lastInitial = parts.length > 1 ? ` ${parts[parts.length - 1]!.charAt(0)}.` : '';
  return `${first}${lastInitial}`;
}

export function maskPhone(phone?: string | null): string {
  const p = (phone || '').replace(/\s+/g, '');
  if (!p) return '—';
  return `•••••${p.slice(-3)}`;
}

export function maskAddress(_addr?: string | null): string {
  return '••• (hidden)';
}
