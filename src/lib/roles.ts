import type { AppRole } from '@/contexts/AuthContext';
import i18n from '@/i18n';

// The three role variants an agent who makes calls can have. They're kept
// separate in the DB for permission granularity, but to users they're all
// just "Call Agent" — no need to surface the internal taxonomy.
const CALL_AGENT_ROLES: AppRole[] = ['agent', 'pending_agent', 'prediction_agent'];

const FRIENDLY_LABEL_KEYS: Partial<Record<AppRole, string>> = {
  manager: 'roles.manager',
  warehouse: 'roles.warehouse',
  ads_admin: 'roles.adsAdmin',
  affiliate: 'roles.affiliate',
};

/**
 * Human-friendly role label for display in the UI.
 * - Any admin → "Superadmin" (admins implicitly hold every role anyway).
 * - agent / pending_agent / prediction_agent → collapsed to a single "Call Agent".
 * - manager / warehouse / ads_admin → their own label.
 * Multiple distinct labels are joined with " + " (e.g. "Manager + Call Agent").
 * Labels come from i18n ("roles.*") — callers must subscribe via useTranslation().
 */
export function friendlyRoleLabel(roles: AppRole[] | undefined | null): string {
  if (!roles || roles.length === 0) return '';
  if (roles.includes('admin')) return i18n.t('roles.superadmin');

  const labels: string[] = [];
  if (roles.some(r => CALL_AGENT_ROLES.includes(r))) labels.push(i18n.t('roles.callAgent'));
  for (const r of roles) {
    const key = FRIENDLY_LABEL_KEYS[r];
    if (!key) continue;
    const friendly = i18n.t(key);
    if (!labels.includes(friendly)) labels.push(friendly);
  }
  return labels.join(' + ');
}
