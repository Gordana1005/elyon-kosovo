import { supabase } from '@/integrations/supabase/client';

const API_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api`;

async function getHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session?.access_token || ''}`,
    'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
}

async function apiFetch<T = any>(path: string, options?: RequestInit): Promise<T> {
  const headers = await getHeaders();
  const res = await fetch(`${API_BASE}/${path}`, {
    ...options,
    headers: { ...headers, ...options?.headers },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'API error');
  return data;
}

// Auth
export const apiGetMe = () => apiFetch('me');

// VoIP — per-agent SIP credentials (the browser registers as ITS OWN extension).
// The secret is returned only for the logged-in user and held in memory only.
export interface VoipCredentials {
  extension: string;
  secret: string;
  ws_url: string;
  primary_caller_id: string;
  secondary_caller_id: string | null;
}
export const apiGetVoipCredentials = (): Promise<VoipCredentials> => apiFetch('voip/credentials');

// Recordings — listed from the PBX; audio streamed on demand via a short-lived
// signed URL (admins/managers only).
export interface RecordingItem {
  file: string;
  date: string | null;
  time: string | null;
  callerid: string | null;
  dialed: string | null;
  ext: string | null;
  uniqueid: string | null;
  size: number;
  mtime: number;
  // Enriched from the matching call log (may be null if no match):
  agent_name: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  outcome: string | null;
  call_at: string | null;
}
export const apiGetRecordings = (): Promise<{ recordings: RecordingItem[] }> => apiFetch('recordings');
export const apiGetRecordingAudioUrl = (file: string): Promise<{ url: string }> =>
  apiFetch(`recordings/audio?file=${encodeURIComponent(file)}`);

// Per-agent caller-ID (superadmin) — default +35924234100; assign any owned DID.
export interface VoipAgent { user_id: string; extension: string; primary_caller_id: string; full_name: string; email: string; }
export interface VoipDid { value: string; label: string; }
export const apiGetVoipAgents = (): Promise<{ agents: VoipAgent[]; dids: VoipDid[] }> => apiFetch('voip/agents');
export const apiSetAgentCallerId = (userId: string, caller_id: string) =>
  apiFetch(`voip/agents/${userId}/caller-id`, { method: 'PUT', body: JSON.stringify({ caller_id }) });

// ── VOIP / Telephony Health (superadmin) ──
// Live PBX/server status (disk, memory, lines in use vs the 4-line A1 cap, trunk
// up/down, fail2ban attacks, recordings) merged with today's call/recording/
// quality stats, plus incidents[] that drive the in-CRM alert banner.
export interface VoipIncident { level: 'critical' | 'warning'; code: string; message: string; }
export interface PbxLiveHealth {
  ok?: boolean;
  error?: string;
  ts?: number;
  disk?: { total: number; used: number; free: number; pct: number; rec_bytes?: number; rec_human?: string };
  mem?: { total: number; used: number; free: number; pct: number };
  load?: { '1': number; '5': number; '15': number };
  asterisk?: { running: boolean; uptime_seconds?: number };
  lines?: { active: number; max: number; channels?: Array<{ ext: string | null; dialed: string | null; duration: number; state: string }> };
  trunk?: { name: string; reachable: boolean; rtt_ms?: number | null };
  extensions?: Array<{ ext: string; registered: boolean }>;
  recordings_today?: { count: number; newest_mtime?: number; newest_age_seconds?: number };
  attacks?: { jail?: string; banned_count: number; banned_ips?: string[] };
  errors?: Array<{ src: string; line: string }>;
}
export interface VoipHealth {
  pbx: PbxLiveHealth;
  snapshot_age_seconds: number | null;
  today: {
    calls: number; answered: number; no_answer: number; outbound_minutes: number;
    recording_coverage_pct: number; answered_recorded: number; answered_unrecorded: number; one_way_audio: number;
  };
  incidents: VoipIncident[];
}
export const apiGetVoipHealth = (): Promise<VoipHealth> => apiFetch('voip/health');

export interface PbxSnapshot {
  captured_at: string; disk_pct: number | null; mem_pct: number | null; load1: number | null;
  active_lines: number | null; trunk_reachable: boolean | null; recordings_today: number | null;
  banned_ips: number | null; rec_bytes: number | null;
}
export const apiGetVoipHealthHistory = (range: '24h' | '7d' | '30d' = '24h'): Promise<{ snapshots: PbxSnapshot[] }> =>
  apiFetch(`voip/health/history?range=${range}`);

export interface RecordingGap {
  id: string; agent_id: string | null; agent_name: string | null; customer_phone: string | null;
  call_at: string | null; outcome: string | null; reason: string;
}
export const apiGetRecordingCoverage = (range: '24h' | '7d' | '30d' = '7d'): Promise<{
  answered: number; recorded: number; unrecorded: number; coverage_pct: number; gaps: RecordingGap[];
}> => apiFetch(`voip/recording-coverage?range=${range}`);

export const apiGetVoipMinutes = (range: '24h' | '7d' | '30d' = '7d', group: 'agent' | 'day' = 'day'): Promise<{
  total_minutes: number; talk_minutes: number; group: string; series: Array<{ key: string; minutes: number }>;
}> => apiFetch(`voip/minutes?range=${range}&group=${group}`);

// Missed (incoming) calls
export interface MissedCall {
  id: string;
  caller_number: string;
  did: string | null;
  occurred_at: string;
  status: 'new' | 'assigned' | 'called_back' | 'ignored';
  assigned_agent_id: string | null;
  assigned_agent_name: string | null;
  linked_order_id: string | null;
  notes: string | null;
  customer_name: string | null;   // from the caller's last order, if any
  voicemail_file: string | null;     // set when the caller left a recorded message
  voicemail_seconds: number | null;  // approx message length
  // Who last contacted this caller — the agent who most recently CALLED the number
  // (call_logs), falling back to whoever handled their last order only if no call
  // exists — so a callback routes to the agent who already knows them.
  last_agent_name: string | null;
  last_agent_id: string | null;
  last_agent_at: string | null;
  last_agent_source: 'call' | 'order' | null;
  last_agent_detail: string | null;
}
export const apiGetMissedCalls = (status?: string): Promise<{ missed_calls: MissedCall[] }> =>
  apiFetch(`missed-calls${status ? `?status=${status}` : ''}`);
export const apiAssignMissedCall = (id: string, agent_id: string) =>
  apiFetch(`missed-calls/${id}/assign`, { method: 'POST', body: JSON.stringify({ agent_id }) });
export const apiBulkAssignMissedCalls = (ids: string[], agent_id: string) =>
  apiFetch('missed-calls/bulk-assign', { method: 'POST', body: JSON.stringify({ ids, agent_id }) });
export const apiGetMissedCallVoicemailUrl = (id: string): Promise<{ url: string }> =>
  apiFetch(`missed-calls/${id}/voicemail-url`);
export const apiSetMissedCallStatus = (id: string, status: string) =>
  apiFetch(`missed-calls/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) });

// Global search — matches orders + leads by phone (last-8 normalised), name, or
// order display_id. Powers the Search Prediction page and the topbar search.
export interface SearchPredictionResult {
  orders: any[];
  leads: any[];
  order_history: any[];
}
export const apiSearchPrediction = (q: string): Promise<SearchPredictionResult> =>
  apiFetch(`search-prediction?q=${encodeURIComponent(q)}`);

// Users
export const apiGetUsers = () => apiFetch('users');
export const apiGetAgents = () => apiFetch('users/agents');
export const apiCreateUser = (body: { email: string; password: string; full_name: string; role: string }) =>
  apiFetch('users/create', { method: 'POST', body: JSON.stringify(body) });
export const apiToggleUserActive = (userId: string) =>
  apiFetch(`users/${userId}/toggle-active`, { method: 'POST' });
export const apiUpdateUserRole = (userId: string, role: string) =>
  apiFetch(`users/${userId}/role`, { method: 'PATCH', body: JSON.stringify({ role }) });
export const apiSetUserRoles = (userId: string, roles: string[]) =>
  apiFetch(`users/${userId}/roles`, { method: 'PUT', body: JSON.stringify({ roles }) });
export const apiDeleteUser = (userId: string) =>
  apiFetch(`users/${userId}`, { method: 'DELETE' });

// ── TV Leaderboard ───────────────────────────────────────────────────────────
// The public board is fetched WITHOUT auth (token in the URL), so apiGetLeaderboard
// bypasses apiFetch/getHeaders (which attach an empty Bearer). The admin config
// endpoints use the normal authenticated apiFetch (admin/manager only).
export interface LeaderboardRow {
  user_id: string;
  full_name: string;
  is_super: boolean;         // admin/manager — shown but earns €0
  rank: number;
  confirmed_count: number;
  packages: number;
  avg_order_value: number;   // EUR
  revenue: number;           // EUR — total confirmed revenue that day (prediction)
  target_pct: number;        // percent of the top revenue target (prediction)
  sold_rate: number;         // percent — sales ÷ clients called (pending)
  calls: number;
  bonus: number;             // EUR (per-package + milestone/target bonus)
  bonus_breakdown: Record<string, number>; // pending {package,volume,avg} | prediction {package,target}
}
export type LeaderboardMode = 'prediction' | 'pending';
export interface LeaderboardResponse {
  generated_at: string;
  mode: LeaderboardMode;
  day: string;               // YYYY-MM-DD (Europe/Belgrade) being viewed
  today: string;             // YYYY-MM-DD (Europe/Belgrade) now
  is_today: boolean;
  target: number;            // top revenue target (prediction); 0 for pending
  team_revenue: number;      // prediction: combined team revenue today (€)
  team_target_pct: number;   // prediction: team revenue as % of the top target
  team_target_bonus: number; // prediction: € bonus the team has unlocked so far
  agents: LeaderboardRow[];
}
export const apiGetLeaderboard = async (key: string, day?: string, mode?: LeaderboardMode): Promise<LeaderboardResponse> => {
  const qs = `key=${encodeURIComponent(key)}${day ? `&day=${encodeURIComponent(day)}` : ''}${mode ? `&mode=${mode}` : ''}`;
  const res = await fetch(`${API_BASE}/leaderboard?${qs}`, {
    headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Leaderboard error');
  return data as LeaderboardResponse;
};

export type LeaderboardMetric = 'confirmed_count' | 'avg_order_value' | 'conversion_rate' | 'revenue_target';
export interface LeaderboardTier { min: number; bonus: number }
export interface LeaderboardBonusRule { metric: LeaderboardMetric; tiers: LeaderboardTier[]; is_active: boolean }
export interface LeaderboardAccessToken { id: string; label: string | null; token: string; is_active: boolean; created_at: string }
export interface LeaderboardAdminConfig {
  mode: LeaderboardMode;
  roster_date: string;
  roster: string[];          // agent user_ids on today's board (for this mode)
  rules: LeaderboardBonusRule[];
  tokens: LeaderboardAccessToken[];
}
export const apiGetLeaderboardAdmin = (mode: LeaderboardMode): Promise<LeaderboardAdminConfig> =>
  apiFetch(`leaderboard/admin?mode=${mode}`);
export const apiSetLeaderboardRoster = (mode: LeaderboardMode, agent_ids: string[]) =>
  apiFetch('leaderboard/roster', { method: 'POST', body: JSON.stringify({ mode, agent_ids }) });
export const apiSetLeaderboardRule = (mode: LeaderboardMode, rule: LeaderboardBonusRule) =>
  apiFetch('leaderboard/rules', { method: 'POST', body: JSON.stringify({ mode, ...rule }) });
export const apiManageLeaderboardToken = (
  body: { action: 'create' | 'rotate' | 'revoke'; id?: string; label?: string },
): Promise<{ success: boolean; token?: LeaderboardAccessToken }> =>
  apiFetch('leaderboard/token', { method: 'POST', body: JSON.stringify(body) });

// Orders
export const apiGetOrders = (params?: { status?: string; search?: string; agent_id?: string; source?: string; ready_only?: boolean; from?: string; to?: string; price_min?: number; price_max?: number; page?: number; limit?: number }) => {
  const sp = new URLSearchParams();
  if (params?.status) sp.set('status', params.status);
  if (params?.search) sp.set('search', params.search);
  if (params?.agent_id) sp.set('agent_id', params.agent_id);
  if (params?.source) sp.set('source', params.source);
  if (params?.ready_only) sp.set('ready_only', '1');
  if (params?.from) sp.set('from', params.from);
  if (params?.to) sp.set('to', params.to);
  if (params?.price_min != null) sp.set('price_min', String(params.price_min));
  if (params?.price_max != null) sp.set('price_max', String(params.price_max));
  if (params?.page) sp.set('page', String(params.page));
  if (params?.limit) sp.set('limit', String(params.limit));
  return apiFetch(`orders?${sp.toString()}`);
};
export const apiGetOrder = (id: string) => apiFetch(`orders/${id}`);

export interface CreateOrderBody {
  product_id?: string | null;
  product_name: string;
  customer_name?: string;
  customer_phone?: string;
  customer_address?: string;
  customer_city?: string;
  postal_code?: string;
  street?: string;
  street_number?: string;
  quarter?: string;
  apartment?: string;
  floor?: string;
  block?: string;
  entry?: string;
  delivery_instructions?: string;
  gift_note?: string;
  delivery_type?: 'home' | 'speedy_office' | 'econt_office';
  home_courier?: 'speedy' | 'econt';
  courier_office_code?: string;
  courier_office_name?: string;
  courier_office_city?: string;
  birthday?: string | null;
  ship_after_date?: string | null;
  price?: number;
  quantity?: number;
  status?: 'pending' | 'confirmed' | 'call_again' | 'cancelled' | 'trashed';
  cancellation_reason?: CancellationReason;
  cancellation_reason_notes?: string;
  trash_reason?: TrashReason;
  trash_reason_notes?: string;
  notes?: string;
  items?: { product_id: string | null; product_name: string; quantity: number; price_per_unit: number }[];
}
export const apiCreateOrder = (body: CreateOrderBody) =>
  apiFetch('orders', { method: 'POST', body: JSON.stringify(body) });

// Customer profile — per-phone customer info (birthday, address, delivery
// prefs, notes) saved independently of orders. Used to pre-fill the order
// modal and to "Save Info" during a call without creating an order.
export interface CustomerProfileBody {
  phone: string;
  customer_name?: string | null;
  birthday?: string | null;
  street?: string | null;
  street_number?: string | null;
  quarter?: string | null;
  apartment?: string | null;
  floor?: string | null;
  block?: string | null;
  entry?: string | null;
  city?: string | null;
  postal_code?: string | null;
  delivery_type?: string | null;
  home_courier?: string | null;
  courier_office_code?: string | null;
  courier_office_name?: string | null;
  courier_office_city?: string | null;
  delivery_instructions?: string | null;
  gift_note?: string | null;
  notes?: string | null;
}
export const apiGetCustomerProfile = (phone: string) =>
  apiFetch(`customer-profile?phone=${encodeURIComponent(phone)}`);
// One server-authorized bundle for the order modal prefill: saved profile +
// recent orders (with items), resolved across ALL agents so a front-line agent
// gets the customer's real name/address even when a prior order was taken by
// someone else (the RLS-scoped /orders search returns nothing for them).
export interface CustomerPrefill { profile: any | null; recent: any[]; }
export const apiGetCustomerPrefill = (phone: string): Promise<CustomerPrefill> =>
  apiFetch(`customer-prefill?phone=${encodeURIComponent(phone)}`);
export const apiSaveCustomerProfile = (body: CustomerProfileBody) =>
  apiFetch('customer-profile', { method: 'POST', body: JSON.stringify(body) });
// Notes-only save — upserts just the free-form customer note by phone without
// touching birthday/address/delivery prefs. Backs the Calls-page notes board.
export const apiSaveCustomerNotes = (phone: string, notes: string) =>
  apiFetch('customer-profile/notes', { method: 'POST', body: JSON.stringify({ phone, notes }) });

// BG address autocomplete (Econt-backed). Settlements = cities + villages.
export interface BgSettlement { id: string; name: string; name_en: string | null; post_code: string | null; region: string | null; municipality: string | null; }
export const apiSearchSettlements = (q: string): Promise<BgSettlement[]> =>
  apiFetch(`address/settlements?q=${encodeURIComponent(q)}`);
export const apiSearchStreets = (settlementId: string, q: string, kind?: 'street' | 'quarter'): Promise<string[]> =>
  apiFetch(`address/streets?settlement_id=${encodeURIComponent(settlementId)}&q=${encodeURIComponent(q)}${kind ? `&kind=${kind}` : ''}`);
// Match a free-text courier address against the cached office list → ranked offices.
export interface MatchedOffice { office_code: string; name: string; city: string; address: string; score: number; }
export const apiMatchCourierOffice = (courier: 'speedy' | 'econt', q: string): Promise<MatchedOffice[]> =>
  apiFetch(`courier-offices/match?courier=${courier}&q=${encodeURIComponent(q)}`);

export interface UpdateCustomerBody {
  customer_name?: string;
  customer_phone?: string;
  customer_city?: string;
  customer_address?: string;
  postal_code?: string;
  street?: string;
  street_number?: string;
  quarter?: string;
  apartment?: string;
  floor?: string;
  block?: string;
  entry?: string;
  delivery_instructions?: string;
  gift_note?: string;
  delivery_type?: 'home' | 'speedy_office' | 'econt_office';
  home_courier?: 'speedy' | 'econt';
  courier_office_code?: string;
  courier_office_name?: string;
  courier_office_city?: string;
  birthday?: string | null;
  price?: number;
  quantity?: number;
  product_id?: string | null;
  product_name?: string;
  ship_after_date?: string | null;
}
export const apiUpdateCustomer = (orderId: string, body: UpdateCustomerBody) =>
  apiFetch(`orders/${orderId}/customer`, { method: 'PATCH', body: JSON.stringify(body) });

// Fix a customer's name / phone across EVERY one of their orders at once (matched
// by the current phone, last-8 normalised). Re-keys the prediction queue sources
// too. Returns the stored E.164 phone so the caller can re-point Dial at it.
export interface UpdateCustomerContactBody {
  phone: string;            // current phone (identifies the customer)
  customer_name?: string;   // new full name
  customer_phone?: string;  // new phone (stored as +359… E.164)
}
export const apiUpdateCustomerContact = (
  body: UpdateCustomerContactBody,
): Promise<{ ok: true; orders_updated: number; new_phone: string }> =>
  apiFetch('customers/update-contact', { method: 'POST', body: JSON.stringify(body) });
export const apiUpdateOrderStatus = (
  orderId: string,
  status: string,
  extras?: {
    cancellation_reason?: CancellationReason;
    cancellation_reason_notes?: string;
    trash_reason?: TrashReason;
    trash_reason_notes?: string;
    return_reason?: string;
    return_reason_notes?: string;
  },
) =>
  apiFetch(`orders/${orderId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, ...(extras || {}) }),
  });

/** Admin-only: manually correct the immutable sales credit (original confirmer) on an order. */
export const apiCorrectOrderAttribution = (orderId: string, body: { confirmed_by_agent_id: string | null }) =>
  apiFetch(`orders/${orderId}/attribution`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const apiAssignOrder = (orderId: string, agentId: string) =>
  apiFetch(`orders/${orderId}/assign`, { method: 'POST', body: JSON.stringify({ agent_id: agentId }) });
export const apiAddOrderNote = (orderId: string, text: string) =>
  apiFetch(`orders/${orderId}/notes`, { method: 'POST', body: JSON.stringify({ text }) });

// Order Items
export const apiSyncOrderItems = (orderId: string, items: { product_id?: string | null; product_name: string; quantity: number; price_per_unit: number }[]) =>
  apiFetch(`orders/${orderId}/items`, { method: 'PUT', body: JSON.stringify({ items }) });
export const apiAddOrderItem = (orderId: string, body: { product_id?: string; product_name: string; quantity: number; price_per_unit: number }) =>
  apiFetch(`orders/${orderId}/items`, { method: 'POST', body: JSON.stringify(body) });
export const apiUpdateOrderItem = (itemId: string, body: any) =>
  apiFetch(`order-items/${itemId}`, { method: 'PATCH', body: JSON.stringify(body) });
export const apiDeleteOrderItem = (itemId: string) =>
  apiFetch(`order-items/${itemId}`, { method: 'DELETE' });
export const apiGetOrderStats = (from?: string, to?: string) => {
  const sp = new URLSearchParams();
  if (from) sp.set('from', from);
  if (to) sp.set('to', to);
  return apiFetch(`orders/stats?${sp.toString()}`);
};
export const apiGetDashboardStats = (params?: { period?: string; agent_id?: string }) => {
  const sp = new URLSearchParams();
  if (params?.period) sp.set('period', params.period);
  if (params?.agent_id) sp.set('agent_id', params.agent_id);
  return apiFetch(`dashboard-stats?${sp.toString()}`);
};
export const apiGetCeoDashboardStats = (params?: { period?: string; agent_id?: string; from?: string; to?: string }) => {
  const sp = new URLSearchParams();
  if (params?.period) sp.set('period', params.period);
  if (params?.agent_id) sp.set('agent_id', params.agent_id);
  if (params?.from) sp.set('from', params.from);
  if (params?.to) sp.set('to', params.to);
  return apiFetch(`ceo-dashboard-stats?${sp.toString()}`);
};

// Products
export const apiGetProducts = () => apiFetch('products');
export const apiCreateProduct = (body: any) =>
  apiFetch('products', { method: 'POST', body: JSON.stringify(body) });
export const apiUpdateProduct = (id: string, body: any) =>
  apiFetch(`products/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const apiGetInventoryLogs = (productId: string) =>
  apiFetch(`products/${productId}/inventory-logs`);

// Suppliers
export const apiGetSuppliers = () => apiFetch('suppliers');
export const apiCreateSupplier = (body: { name: string; contact_info?: string; email?: string; phone?: string; address?: string }) =>
  apiFetch('suppliers', { method: 'POST', body: JSON.stringify(body) });
export const apiUpdateSupplier = (id: string, body: any) =>
  apiFetch(`suppliers/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const apiDeleteSupplier = (id: string) =>
  apiFetch(`suppliers/${id}`, { method: 'DELETE' });

// Restock & Stock Movements
export const apiRestock = (body: { product_id: string; quantity: number; supplier_name?: string; invoice_number?: string; notes?: string }) =>
  apiFetch('restock', { method: 'POST', body: JSON.stringify(body) });
export const apiGetStockMovements = (params?: { product_id?: string; movement_type?: string; limit?: number }) => {
  const sp = new URLSearchParams();
  if (params?.product_id) sp.set('product_id', params.product_id);
  if (params?.movement_type) sp.set('movement_type', params.movement_type);
  if (params?.limit) sp.set('limit', String(params.limit));
  return apiFetch(`stock-movements?${sp.toString()}`);
};

// Prediction Lists
export const apiGetPredictionLists = () => apiFetch('prediction-lists');
export const apiGetPredictionList = (id: string) => apiFetch(`prediction-lists/${id}`);
export const apiCreatePredictionList = (body: { name: string; entries: any[] }) =>
  apiFetch('prediction-lists', { method: 'POST', body: JSON.stringify(body) });
export const apiAssignLeads = (listId: string, agentId: string, leadIds: string[]) =>
  apiFetch(`prediction-lists/${listId}/assign`, { method: 'POST', body: JSON.stringify({ agent_id: agentId, lead_ids: leadIds }) });

// Prediction Leads
export const apiGetMyLeads = (params?: { search?: string }) => {
  const sp = new URLSearchParams();
  if (params?.search) sp.set('search', params.search);
  const qs = sp.toString();
  return apiFetch(`prediction-leads/my${qs ? `?${qs}` : ''}`);
};
export const apiUpdateLead = (id: string, body: { status?: string; notes?: string; address?: string; city?: string; telephone?: string; product?: string; quantity?: number; price?: number }) =>
  apiFetch(`prediction-leads/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const apiUnassignLeads = (leadIds: string[]) =>
  apiFetch('prediction-leads/unassign', { method: 'POST', body: JSON.stringify({ lead_ids: leadIds }) });
export const apiTakeLead = (leadId: string) =>
  apiFetch(`prediction-leads/${leadId}/take`, { method: 'POST' });

// Prediction Lead Items
export const apiAddLeadItem = (leadId: string, body: { product_id?: string; product_name: string; quantity: number; price_per_unit: number }) =>
  apiFetch(`prediction-leads/${leadId}/items`, { method: 'POST', body: JSON.stringify(body) });
export const apiUpdateLeadItem = (itemId: string, body: any) =>
  apiFetch(`prediction-lead-items/${itemId}`, { method: 'PATCH', body: JSON.stringify(body) });
export const apiDeleteLeadItem = (itemId: string) =>
  apiFetch(`prediction-lead-items/${itemId}`, { method: 'DELETE' });

// Phone duplicate check
export const apiCheckPhoneDuplicates = (phone: string, excludeOrderId?: string) =>
  apiFetch('check-phone-duplicates', { method: 'POST', body: JSON.stringify({ phone, exclude_order_id: excludeOrderId }) });

// Call Scripts
export interface CallScriptHelper {
  title: string;
  content: string;
  category?: string | null;
}
// Per-language variant of a script. Every field is optional — missing fields fall
// back to the Bulgarian base columns at resolve time (see src/lib/callScripts.ts).
export interface CallScriptTranslation {
  title?: string;
  description?: string | null;
  script_text?: string;
  helpers?: CallScriptHelper[];
}
export interface CallScript {
  id: string;
  context_type: string;
  title: string;
  description: string | null;
  script_text: string;
  helpers?: CallScriptHelper[] | null;
  // Keyed by UI language code ('en' | 'sq'); 'bg' lives in the base columns above.
  translations?: Record<string, CallScriptTranslation> | null;
  updated_at: string;
  updated_by: string | null;
}

export const apiGetCallScript = (contextType: string): Promise<CallScript> =>
  apiFetch(`call-scripts/${contextType}`);
export const apiUpdateCallScript = (
  contextType: string,
  body: { script_text: string; translations?: Record<string, CallScriptTranslation> },
): Promise<CallScript> =>
  apiFetch(`call-scripts/${contextType}`, { method: 'PATCH', body: JSON.stringify(body) });
export const apiGetAllCallScripts = (): Promise<CallScript[]> =>
  apiFetch('call-scripts');
export const apiCreateProductScript = (body: { title: string; description?: string; script_text: string; helpers?: CallScriptHelper[]; translations?: Record<string, CallScriptTranslation> }): Promise<CallScript> =>
  apiFetch('call-scripts', { method: 'POST', body: JSON.stringify(body) });
export const apiUpdateProductScript = (id: string, body: { title?: string; description?: string; script_text?: string; helpers?: CallScriptHelper[]; translations?: Record<string, CallScriptTranslation> }): Promise<CallScript> =>
  apiFetch(`call-scripts/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const apiDeleteProductScript = (id: string): Promise<{ ok: boolean }> =>
  apiFetch(`call-scripts/${id}`, { method: 'DELETE' });

// Call Logs
export type CallOutcome =
  | 'no_answer' | 'interested' | 'not_interested' | 'wrong_number' | 'call_again'
  | 'confirmed' | 'cancelled' | 'trash'
  // Neutral "picked up, no order decision". Replaces the old auto-'interested'
  // on hangup; the real result is derived from the order's status.
  | 'answered';

export type CancellationReason =
  | 'no_money' | 'changed_mind' | 'wrong_product' | 'bought_elsewhere'
  | 'family_refused' | 'duplicate_order' | 'not_satisfied' | 'price_too_high'
  | 'still_using_product' | 'not_interested' | 'will_call_back' | 'other';

// Agent-facing trash reasons (the picker in ChooseAnswerButton). 'not_reachable'
// is server-only (5-no-answer auto-trash) so it's not part of this input union.
export type TrashReason =
  | 'wrong_number' | 'wrong_person' | 'rude' | 'uncooperative' | 'other';

export type ConnectionState = 'answered' | 'no_answer' | 'busy' | 'failed' | 'voicemail';

export interface LogCallBody {
  context_type: 'order' | 'prediction_lead' | 'standalone';
  context_id: string | null;
  outcome: CallOutcome | string;
  notes?: string;
  // Telemetry
  started_at?: string;
  connected_at?: string | null;
  ended_at?: string;
  customer_phone?: string;
  connection_state?: ConnectionState;
  // Structured cancel reason
  cancellation_reason?: CancellationReason;
  cancellation_reason_notes?: string;
}

export const apiLogCall = (body: LogCallBody) =>
  apiFetch('call-logs', { method: 'POST', body: JSON.stringify(body) });
export const apiGetCallLogs = (contextType: string, contextId: string) =>
  apiFetch(`call-logs/${contextType}/${contextId}`);

// Customer history dossier (Calls page)
export interface CustomerHistoryCall {
  id: string;
  agent_id: string;
  agent_name: string;
  context_type: 'order' | 'prediction_lead';
  context_id: string;
  outcome: string;
  notes: string;
  created_at: string;
  started_at: string | null;
  connected_at: string | null;
  ended_at: string | null;
  ring_seconds: number | null;
  talk_seconds: number | null;
  total_seconds: number | null;
  customer_phone: string | null;
  connection_state: ConnectionState | null;
}
export interface CustomerHistoryResponse {
  orders: any[];
  calls: CustomerHistoryCall[];
}
export const apiGetCustomerHistory = (phone: string): Promise<CustomerHistoryResponse> =>
  apiFetch(`customers/${encodeURIComponent(phone)}/history`);

// Active call views (TAKE status, heartbeat-based 2-min timeout)
export interface ActiveCallView {
  id: string;
  agent_id: string;
  agent_name: string;
  customer_phone: string;
  opened_at: string;
  expires_at: string;
}
export const apiHeartbeatActiveView = (customer_phone: string): Promise<ActiveCallView> =>
  apiFetch('active-call-views/heartbeat', { method: 'POST', body: JSON.stringify({ customer_phone }) });
export const apiReleaseActiveView = (customer_phone: string): Promise<{ ok: true; reverted: number }> =>
  apiFetch(`active-call-views/by-phone/${encodeURIComponent(customer_phone)}`, { method: 'DELETE' });
export const apiLookupActiveView = (customer_phone: string): Promise<ActiveCallView | null> =>
  apiFetch(`active-call-views/lookup?phone=${encodeURIComponent(customer_phone)}`);

export const apiGetActiveCallViews = (): Promise<ActiveCallView[]> =>
  apiFetch('active-call-views');

// Call Again queue (customers awaiting follow-up call)
export interface CallAgainEntry {
  source_kind?: 'order' | 'prediction';   // where the row came from (order wins on dedupe)
  list_id: string;
  customer_phone: string;
  customer_name: string | null;
  last_call_at: string | null;
  last_call_outcome: string | null;
  in_call_again_until: string | null;
  assigned_agent_id: string | null;
  assigned_agent_name: string | null;
  lifetime_value: number;
  paid_count: number | null;
  avg_package_price?: number | null;   // NEW - from prediction priority redesign
  trigger_event_at: string | null;
  prediction_segment_lists: { name: string; category: string } | null;
}
export const apiGetCallAgainQueue = (mine: boolean = true): Promise<CallAgainEntry[]> =>
  apiFetch(`call-again-queue?mine=${mine}`);

// Personal List
export interface PersonalHold {
  id: string;
  agent_id: string;
  agent_name: string;
  customer_phone: string;
  customer_name: string | null;
  reason: string;
  follow_up_by: string | null;
  claimed_at: string;
  expires_at: string;
  escalated_at: string | null;
  status: 'active' | 'released' | 'extended' | 'returned_to_pool';
}
export const apiCreatePersonalHold = (body: { customer_phone: string; customer_name?: string; reason: string; follow_up_by?: string }): Promise<PersonalHold> =>
  apiFetch('personal-list', { method: 'POST', body: JSON.stringify(body) });
export const apiGetMyPersonalHolds = (): Promise<PersonalHold[]> =>
  apiFetch('personal-list?mine=true');
export const apiLookupPersonalHold = (phone: string): Promise<PersonalHold | null> =>
  apiFetch(`personal-list/lookup?phone=${encodeURIComponent(phone)}`);
export const apiReleasePersonalHold = (id: string): Promise<{ ok: true }> =>
  apiFetch(`personal-list/${id}`, { method: 'DELETE' });
export const apiGetExpiringHolds = (): Promise<PersonalHold[]> =>
  apiFetch('personal-list/expiring');
export const apiGetExpiringHoldsCount = (): Promise<{ count: number }> =>
  apiFetch('personal-list/expiring-count');
export const apiExtendPersonalHold = (id: string, days: number): Promise<PersonalHold> =>
  apiFetch(`personal-list/${id}/extend`, { method: 'POST', body: JSON.stringify({ days }) });

// App settings (operator-tunable global knobs)
export interface AppSettings {
  personal_list_max_holds: number;
  [key: string]: any;
}
export const apiGetAppSettings = (): Promise<AppSettings> => apiFetch('app-settings');
export const apiUpdateAppSettings = (patch: Partial<AppSettings>): Promise<{ success: true }> =>
  apiFetch('app-settings', { method: 'PATCH', body: JSON.stringify(patch) });

// Call History
export const apiGetCallHistory = (params?: { agent_id?: string; result?: string; source?: string; from?: string; to?: string; search?: string; page?: number; limit?: number }) => {
  const sp = new URLSearchParams();
  if (params?.agent_id) sp.set('agent_id', params.agent_id);
  if (params?.result) sp.set('result', params.result);
  if (params?.source) sp.set('source', params.source);
  if (params?.from) sp.set('from', params.from);
  if (params?.to) sp.set('to', params.to);
  if (params?.search) sp.set('search', params.search);
  if (params?.page) sp.set('page', String(params.page));
  if (params?.limit) sp.set('limit', String(params.limit));
  return apiFetch(`call-history?${sp.toString()}`);
};

// ── Agent Activity Timeline ──
export interface AgentActivityCall {
  id: string;
  started_at: string | null;
  connected_at: string | null;
  ended_at: string | null;
  connection_state: string | null;
  outcome: string | null;
  customer_phone: string | null;
  ring_seconds: number | null;
  talk_seconds: number | null;
}
export interface AgentActivityRow {
  user_id: string;
  full_name: string;
  shift_windows: { start: string; end: string }[];
  breaks: { start: string; end: string | null }[];
  calls: AgentActivityCall[];
  totals: {
    calls: number;
    answered: number;
    answer_rate: number;
    talk_seconds: number;
    ring_seconds: number;
    first_call: string | null;
    last_call: string | null;
  };
}
export interface AgentActivityResponse {
  date: string;
  tz: string;
  agents: AgentActivityRow[];
}
export const apiGetAgentActivity = (params?: { date?: string; agent_id?: string }) => {
  const sp = new URLSearchParams();
  if (params?.date) sp.set('date', params.date);
  if (params?.agent_id) sp.set('agent_id', params.agent_id);
  const qs = sp.toString();
  return apiFetch<AgentActivityResponse>(`agent-activity${qs ? `?${qs}` : ''}`);
};

// Agent performance — per-agent sales/financial table (Insights → Agents tab).
export interface AgentPerformanceRow {
  user_id: string;
  full_name: string;
  email: string;
  leads_assigned: number;
  total_confirmed: number;
  total_shipped: number;
  total_paid: number;
  total_returned: number;
  total_cancelled: number;
  total_trashed: number;
  conversion_rate: number;
  shipment_rate: number;
  collection_rate: number;
  return_rate: number;
  gross_revenue: number;
  paid_revenue: number;
  outstanding_revenue: number;
  returned_value: number;
  total_profit: number;
  net_contribution: number;
  avg_order_value: number;
  revenue_per_lead: number;
  profit_per_lead: number;
  is_special_agent?: boolean;
  packages_sold?: number;
  avg_per_package?: number;
  payout_earned?: number;
}
export const apiGetAgentPerformance = (params?: {
  from?: string; to?: string; search?: string; source?: string;
  status?: string; agent_id?: string; include_cancelled?: boolean; show_zero?: boolean;
}): Promise<AgentPerformanceRow[]> => {
  const sp = new URLSearchParams();
  if (params?.from) sp.set('from', params.from);
  if (params?.to) sp.set('to', params.to);
  if (params?.search) sp.set('search', params.search);
  if (params?.source) sp.set('source', params.source);
  if (params?.status) sp.set('status', params.status);
  if (params?.agent_id) sp.set('agent_id', params.agent_id);
  if (params?.include_cancelled) sp.set('include_cancelled', 'true');
  if (params?.show_zero) sp.set('show_zero', 'true');
  const qs = sp.toString();
  return apiFetch<AgentPerformanceRow[]>(`agent-performance${qs ? `?${qs}` : ''}`);
};

// Warehouse
export const apiGetIncomingOrders = (params?: { agent_id?: string; from?: string; to?: string; product?: string; source?: string; status?: string }) => {
  const sp = new URLSearchParams();
  if (params?.agent_id) sp.set('agent_id', params.agent_id);
  if (params?.from) sp.set('from', params.from);
  if (params?.to) sp.set('to', params.to);
  if (params?.product) sp.set('product', params.product);
  if (params?.source) sp.set('source', params.source);
  if (params?.status) sp.set('status', params.status);
  return apiFetch(`warehouse/incoming-orders?${sp.toString()}`);
};
export const apiGetUserWarehouseItems = () => apiFetch('warehouse/user-items');
export const apiAssignWarehouseItem = (body: { user_id: string; product_id: string; quantity: number; notes?: string }) =>
  apiFetch('warehouse/user-items', { method: 'POST', body: JSON.stringify(body) });
export const apiUpdateWarehouseItem = (id: string, body: any) =>
  apiFetch(`warehouse/user-items/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const apiDeleteWarehouseItem = (id: string) =>
  apiFetch(`warehouse/user-items/${id}`, { method: 'DELETE' });
export const apiUpdateWarehouseOrder = (id: string, body: any) =>
  apiFetch(`warehouse/incoming-orders/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const apiDeleteWarehouseOrder = (id: string, source: string) =>
  apiFetch(`warehouse/incoming-orders/${id}?source=${source}`, { method: 'DELETE' });

export const apiGetShifts = (params?: { agent_id?: string; from?: string; to?: string }) => {
  const sp = new URLSearchParams();
  if (params?.agent_id) sp.set('agent_id', params.agent_id);
  if (params?.from) sp.set('from', params.from);
  if (params?.to) sp.set('to', params.to);
  return apiFetch(`shifts?${sp.toString()}`);
};
export const apiGetMyShifts = () => apiFetch('shifts/my');
// Breaks (pause during a shift). Start resolves the active shift server-side.
export const apiStartBreak = () => apiFetch('shifts/break/start', { method: 'POST', body: '{}' });
export const apiEndBreak = () => apiFetch('shifts/break/end', { method: 'POST', body: '{}' });
export const apiGetActiveBreak = () => apiFetch('shifts/break/active');
export const apiCreateShift = (body: { name: string; date: string; date_end?: string; start_time: string; end_time: string; agent_ids?: string[] }) =>
  apiFetch('shifts', { method: 'POST', body: JSON.stringify(body) });
export const apiUpdateShift = (id: string, body: any) =>
  apiFetch(`shifts/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const apiDeleteShift = (id: string) =>
  apiFetch(`shifts/${id}`, { method: 'DELETE' });
export const apiCheckShiftLogin = () => apiFetch('shifts/check-login');
export const apiLogShiftLogin = (body: { shift_id: string; shift_date: string; shift_start_time: string; shift_end_time: string }) =>
  apiFetch('shifts/login-log', { method: 'POST', body: JSON.stringify(body) });
export const apiLogShiftLogout = () =>
  apiFetch('shifts/logout-log', { method: 'PATCH', body: JSON.stringify({}) });
export const apiGetShiftStatistics = (params?: { from?: string; to?: string }) => {
  const sp = new URLSearchParams();
  if (params?.from) sp.set('from', params.from);
  if (params?.to) sp.set('to', params.to);
  return apiFetch(`shifts/statistics?${sp.toString()}`);
};
export const apiGetLoginActivity = (params?: { from?: string; to?: string; agent_id?: string; status?: string }) => {
  const sp = new URLSearchParams();
  if (params?.from) sp.set('from', params.from);
  if (params?.to) sp.set('to', params.to);
  if (params?.agent_id) sp.set('agent_id', params.agent_id);
  if (params?.status) sp.set('status', params.status);
  return apiFetch(`shifts/login-activity?${sp.toString()}`);
};

// Shift Templates
export const apiGetShiftTemplates = () => apiFetch('shift-templates');
export const apiCreateShiftTemplate = (body: { name: string; start_time: string; end_time: string }) =>
  apiFetch('shift-templates', { method: 'POST', body: JSON.stringify(body) });
export const apiUpdateShiftTemplate = (id: string, body: any) =>
  apiFetch(`shift-templates/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const apiDeleteShiftTemplate = (id: string) =>
  apiFetch(`shift-templates/${id}`, { method: 'DELETE' });
export const apiAssignTemplateWeek = (body: { template_id: string; agent_ids: string[]; week_start: string; days?: string[] }) =>
  apiFetch('shift-templates/assign-week', { method: 'POST', body: JSON.stringify(body) });

// Recent Activity
export const apiGetRecentActivity = (limit?: number) => {
  const sp = new URLSearchParams();
  if (limit) sp.set('limit', String(limit));
  return apiFetch(`recent-activity?${sp.toString()}`);
};

// Ads Campaigns
export const apiGetAdsCampaigns = (params?: { platform?: string; status?: string; search?: string }) => {
  const sp = new URLSearchParams();
  if (params?.platform) sp.set('platform', params.platform);
  if (params?.status) sp.set('status', params.status);
  if (params?.search) sp.set('search', params.search);
  return apiFetch(`ads-campaigns?${sp.toString()}`);
};
export const apiCreateAdsCampaign = (body: { campaign_name: string; platform: string; budget: number; notes?: string }) =>
  apiFetch('ads-campaigns', { method: 'POST', body: JSON.stringify(body) });
export const apiUpdateAdsCampaign = (id: string, body: any) =>
  apiFetch(`ads-campaigns/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const apiDeleteAdsCampaign = (id: string) =>
  apiFetch(`ads-campaigns/${id}`, { method: 'DELETE' });

// Inbound Leads (webhook)
export const apiGetInboundLeads = (status?: string) => {
  const sp = new URLSearchParams();
  if (status && status !== 'all') sp.set('status', status);
  return apiFetch(`inbound-leads?${sp.toString()}`);
};
export const apiUpdateInboundLead = (id: string, body: any) =>
  apiFetch(`inbound-leads/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const apiDeleteInboundLead = (id: string) =>
  apiFetch(`inbound-leads/${id}`, { method: 'DELETE' });

// Assigner
export const apiGetUnassignedPending = () => apiFetch('orders/unassigned-pending');
export const apiGetAssignedOrders = () => apiFetch('orders/assigned');
export const apiBulkAssignOrders = (orderIds: string[], agentId: string) =>
  apiFetch('orders/bulk-assign', { method: 'POST', body: JSON.stringify({ order_ids: orderIds, agent_id: agentId }) });
export const apiBulkUnassignOrders = (orderIds: string[]) =>
  apiFetch('orders/bulk-unassign', { method: 'POST', body: JSON.stringify({ order_ids: orderIds }) });
export const apiBulkStatusUpdate = (orderIds: string[], newStatus: string) =>
  apiFetch('orders/bulk-status-update', { method: 'POST', body: JSON.stringify({ order_ids: orderIds, new_status: newStatus }) });
export const apiBigArenaSync = (updates: Array<{ ref: string; rawStatus: string; targetStatus: 'paid' | 'returned' | 'cancelled' }>, meta?: { filename?: string; uploadedAt?: string }) =>
  apiFetch('orders/bigarena-sync', { method: 'POST', body: JSON.stringify({ updates, meta: meta || {} }) });
export const apiGetOnlineAgents = () => apiFetch('agents/online');
// Presence heartbeat — pinged every ~45s while the app is open so the
// agents/online endpoint can tell who is actually here right now.
export const apiPresenceHeartbeat = () => apiFetch('presence/heartbeat', { method: 'POST' });

// Webhooks
export const apiGetWebhooks = () => apiFetch('webhooks');
export const apiCreateWebhook = (body: { product_name: string; description?: string }) =>
  apiFetch('webhooks', { method: 'POST', body: JSON.stringify(body) });
export const apiUpdateWebhook = (id: string, body: any) =>
  apiFetch(`webhooks/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const apiDeleteWebhook = (id: string) =>
  apiFetch(`webhooks/${id}`, { method: 'DELETE' });

// Customer Intelligence
export const apiGetCustomerIntelligence = (phone: string) =>
  apiFetch(`customer-intelligence?phone=${encodeURIComponent(phone)}`);

// Management Insights
export interface InsightsResponse {
  meta: { from: string; to: string; granularity: 'day' | 'week' | 'month'; generated_at: string };
  overview: {
    revenue: number; paid_revenue: number; orders_total: number; sold_count: number; paid_count: number; aov: number;
    units_sold: number; return_rate: number; cancel_rate: number;
    returns_value: number; pipeline_value: number; returned_count: number; cancelled_count: number;
    trashed_count: number; leads_pending: number;
  };
  status_distribution: { status: string; count: number; value: number }[];
  revenue_trend: { bucket: string; revenue: number; orders: number }[];
  sales: {
    by_product: { product: string; units: number; revenue: number; orders: number }[];
    by_city: { city: string; orders: number; revenue: number }[];
    by_delivery: { delivery: string; orders: number; revenue: number }[];
    by_source: { source: string; orders: number; revenue: number }[];
  };
  agents: {
    name: string; orders: number; sold: number; paid: number; cancelled: number; returned: number; trashed: number;
    revenue: number; aov: number; units: number; avg_per_package: number; cancel_rate: number; return_rate: number;
    calls: number; answered: number; answer_rate: number; talk_seconds: number;
    payout_earned?: number;  // New for Pure Profit / special agent commissions
  }[];
  products_stock: {
    top_sellers: { product: string; units: number; revenue: number; orders: number }[];
    stock: { name: string; stock_quantity: number; low_stock_threshold: number; state: 'ok' | 'low' | 'out'; units_sold: number; days_of_cover: number | null; cost_price: number; price: number }[];
    low_stock: any[];
    out_of_stock: any[];
    movement: Record<string, number>;
  };
  returns: {
    rate: number; value_lost: number;
    by_reason: { reason: string; count: number }[];
    by_product: { product: string; count: number }[];
    by_city: { city: string; count: number }[];
  };
  cancellations: {
    total: number;
    trashed: number;
    by_reason: { reason: string; count: number }[];
    by_product: { product: string; count: number }[];
  };
  calls: {
    total: number; answered: number; answer_rate: number; talk_seconds: number;
    by_outcome: { outcome: string; count: number }[];
    per_agent: { name: string; calls: number; answered: number; answer_rate: number; talk_seconds: number }[];
  };
  profit: { has_costs: boolean; by_product: { product: string; revenue: number; cogs: number; profit: number; margin: number }[]; total_profit: number };

  // Pure Profit (actuals — money in vs money out)
  pure_profit?: {
    total_packages: number;
    avg_price_per_package: number;
    paid_orders?: number;           // distinct paid orders
    paid_packages?: number;         // total packages (units) across paid orders
    packages_per_order?: number;    // paid_packages / paid_orders
    by_product?: {                  // per-product breakdown on the paid basis
      product: string; packages: number; orders: number;
      unit_cost: number; unit_price: number;
      cogs: number; revenue: number; profit: number;
      net_revenue?: number;         // revenue excl. VAT
      net_profit?: number;          // net_revenue − cogs
    }[];
    cash_collected?: number;        // money in: cash actually collected (paid)
    vat?: number;                   // VAT included in collected cash (gross ÷ 6 at 20%)
    vat_rate?: number;              // e.g. 0.20
    cogs?: number;                  // product cost of what sold
    agent_commissions?: number;     // first-confirmer bonus (agents only)
    delivery_cost?: number;         // courier outbound on all shipped
    return_loss?: number;           // round-trip loss on every return
    cost_coverage?: number;         // share of sold packages with a known cost_price (0..1)
    products_missing_cost?: string[]; // products whose COGS counts €0 (no cost_price)
    gross_profit_from_cost: number; // back-compat alias (cash − cogs)
    special_agent_commissions: number; // back-compat alias of agent_commissions
    clear_profit: number;
  };

  // Margin Lab — realized price of every paid package + the floor each product
  // needs to net `target_profit_per_package`. Floor = 1.2·(target+cogs+deliver+commission).
  margin_lab?: {
    target_profit_per_package: number;
    vat_rate: number;
    blended_deliver_cost: number;   // default delivery/order for the bundle simulator
    commission_tiers: { max: number | null; bonus: number }[];
    realized: {
      packages: number;
      avg: number; median: number; p25: number; p75: number; min: number; max: number;
      net_profit_per_pkg: number;
    };
    by_product: {
      product: string; packages: number;
      cost_known: boolean; cogs_unit: number;
      avg_realized_price: number; avg_delivery_share: number;
      net_profit_per_pkg: number; clears_target: boolean;
      floor_price: number; uplift_pct: number | null;
    }[];
  };

  // Logistics spend by courier+service (which orders went by what).
  logistics?: {
    courier: string; service: string;
    delivered: number; returned: number;
    deliver_cost: number; return_cost: number; total_cost: number;
  }[];

  // Prediction Lists ROI — which list generated how much money. Order metrics are
  // exact (from the order's attribution snapshot); members is current membership.
  // returned/refund_value = money that came back (COD returns).
  prediction_lists?: {
    list_id: string;
    name: string;
    type: 'segment' | 'uploaded';
    category: string | null;
    orders: number;
    confirmed: number;
    paid: number;
    returned: number;
    cancelled: number;
    revenue: number;
    refund_value: number;
    net_revenue: number;
    bonus_paid: number;
    members: number;
    conversion_rate: number;
    return_rate: number;
  }[];
}
export const apiGetManagementInsights = (params?: { from?: string; to?: string; target?: number }): Promise<InsightsResponse> => {
  const sp = new URLSearchParams();
  if (params?.from) sp.set('from', params.from);
  if (params?.to) sp.set('to', params.to);
  if (params?.target != null) sp.set('target', String(params.target));
  return apiFetch(`management-insights?${sp.toString()}`);
};

// Courier rate card (logistics cost per courier+service — editable in Settings)
export interface CourierRate {
  id?: string;
  courier: 'speedy' | 'econt';
  service: 'door' | 'office';
  deliver_cost: number;
  return_cost: number;
  updated_at?: string;
}
export const apiGetCourierRates = (): Promise<CourierRate[]> => apiFetch('courier-rates');
export const apiUpdateCourierRates = (rates: Pick<CourierRate, 'courier' | 'service' | 'deliver_cost' | 'return_cost'>[]) =>
  apiFetch('courier-rates', { method: 'PATCH', body: JSON.stringify({ rates }) });

// Lead Distribution
export const apiGetLeadDistributionConfig = () => apiFetch('lead-distribution-config');
export const apiUpdateLeadDistributionConfig = (body: { strategy?: string; is_active?: boolean; max_leads_per_agent?: number; priority_threshold?: number }) =>
  apiFetch('lead-distribution-config', { method: 'PATCH', body: JSON.stringify(body) });
export const apiAutoAssignLeads = () =>
  apiFetch('lead-distribution/auto-assign', { method: 'POST' });

// Operations Center
export const apiGetOperationsCenter = () => apiFetch('operations-center');

// Courier offices (Speedy / Econt picker)
export const apiGetCourierCities = (courier: 'speedy' | 'econt', q: string, limit = 15) => {
  const sp = new URLSearchParams({ courier, q, limit: String(limit) });
  return apiFetch<{ city: string; count: number }[]>(`courier-offices/cities?${sp.toString()}`);
};
export const apiGetCourierOffices = (courier: 'speedy' | 'econt', city: string) => {
  const sp = new URLSearchParams({ courier, city });
  return apiFetch<{ office_code: string; name: string; address: string; hours: string; lat: number | null; lng: number | null; post_code: string }[]>(`courier-offices?${sp.toString()}`);
};
export const apiGetCourierOfficeByCode = (courier: 'speedy' | 'econt', code: string) => {
  const sp = new URLSearchParams({ courier, code });
  return apiFetch<{ office_code: string; name: string; city: string; address: string; hours: string; post_code: string } | null>(`courier-offices/by-code?${sp.toString()}`);
};

// Segments (rule-driven prediction lists)
export const apiGetSegments = () => apiFetch('segments');
export const apiGetSegment = (id: string, params?: { page?: number; limit?: number; assigned?: string; completed?: string }) => {
  const sp = new URLSearchParams();
  if (params?.page) sp.set('page', String(params.page));
  if (params?.limit) sp.set('limit', String(params.limit));
  if (params?.assigned) sp.set('assigned', params.assigned);
  if (params?.completed) sp.set('completed', params.completed);
  const qs = sp.toString();
  return apiFetch(`segments/${id}${qs ? `?${qs}` : ''}`);
};
export const apiAssignSegmentMembers = (id: string, memberPhones: string[], agentId: string | null) =>
  apiFetch(`segments/${id}/assign`, { method: 'POST', body: JSON.stringify({ member_phones: memberPhones, agent_id: agentId }) });
/** Bulk-assign a prediction list across N agents. 1 agent_id = whole list to
 *  them; 2+ = members are shuffled then distributed round-robin so every member
 *  lands with exactly one agent. Default scope='unassigned' preserves whatever
 *  agents already had; scope='all' wipes + redistributes. Optional opts.limit
 *  (exact count) or opts.fraction (0–1, e.g. 0.5 for half) distribute only part
 *  of the eligible pool, sampled fairly after the shuffle. */
export const apiAutoAssignSegment = (
  id: string,
  agentIds: string[],
  scope: 'unassigned' | 'all' = 'unassigned',
  opts?: { limit?: number; fraction?: number },
) =>
  apiFetch(`segments/${id}/auto-assign`, {
    method: 'POST',
    body: JSON.stringify({ agent_ids: agentIds, scope, ...(opts || {}) }),
  });
/** Clear assignment for a whole list (scope='all') or just one agent's slice
 *  (scope=<agent_id>). */
export const apiBulkUnassignSegment = (id: string, scope: 'all' | string = 'all') =>
  apiFetch(`segments/${id}/bulk-unassign`, { method: 'POST', body: JSON.stringify({ scope }) });
export const apiUpdateSegment = (id: string, body: Record<string, any>) =>
  apiFetch(`segments/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const apiRecomputeSegments = () =>
  apiFetch('segments/recompute', { method: 'POST' });

// ── Prediction Engine config (no-code list builder) ──
export interface SegmentRecencyBand { label: string; max_days: number | null; holding_pen?: boolean; strip_assignment?: boolean; }
export interface SegmentValueBand { label: string; max_price: number | null; }
export interface SegmentFrequencyBand { label: string; min_count: number; }
export interface SegmentEngineConfig {
  recency_bands: SegmentRecencyBand[];
  value_bands: SegmentValueBand[];
  frequency_bands: SegmentFrequencyBand[];
  windows: { current_cancels_days: number; never_converted_recent_days: number };
  reorder: { enabled: boolean; default_days_of_supply_per_unit: number; buffer_days: number; list_name: string; aggregation?: 'longest' | 'earliest' };
}
export interface SegmentEngineConfigRow {
  id: string;
  version: number;
  config: SegmentEngineConfig;
  active_engine: 'v3_4' | 'v4';
  note: string;
  created_at: string;
}
export interface SegmentEngineDiffList {
  list_id: string; name: string; is_static: boolean; is_active: boolean; live: number; shadow: number;
}
export interface SegmentEngineDiff {
  lists: SegmentEngineDiffList[];
  drift: number;
  live_total: number;
  shadow_total: number;
}
export const apiGetSegmentEngineConfig = (): Promise<SegmentEngineConfigRow> =>
  apiFetch('segments/engine-config');
export const apiSaveSegmentEngineConfig = (
  config: SegmentEngineConfig,
  note?: string,
): Promise<{ version: number; diff: SegmentEngineDiff }> =>
  apiFetch('segments/engine-config', { method: 'PUT', body: JSON.stringify({ config, note }) });
export const apiGetSegmentEngineDiff = (): Promise<SegmentEngineDiff> =>
  apiFetch('segments/engine-diff');
export const apiCreateSegmentList = (body: {
  name: string; description?: string; category?: string; trigger_event?: string; is_static?: boolean; display_order?: number;
}) => apiFetch('segments', { method: 'POST', body: JSON.stringify(body) });
export const apiDeleteSegmentList = (id: string, hard = false) =>
  apiFetch(`segments/${id}${hard ? '?hard=true' : ''}`, { method: 'DELETE' });

// ── Engine controls (kill-switch + on-demand recompute) ──
export interface SegmentEngineControls {
  shadow_enabled: boolean;
  active_engine: 'v3_4' | 'v4';
  shadow_cron_active: boolean;
  shadow_cron_schedule: string | null;
  live_cron_active: boolean;
  live_cron_schedule: string | null;
}
export const apiGetSegmentEngineControls = (): Promise<SegmentEngineControls> =>
  apiFetch('segments/engine-controls');
export const apiSetShadowEngine = (enabled: boolean): Promise<{ shadow_enabled: boolean }> =>
  apiFetch('segments/shadow-engine', { method: 'POST', body: JSON.stringify({ enabled }) });
export const apiRecomputeShadow = (): Promise<{ recomputed_customers: number }> =>
  apiFetch('segments/recompute-shadow', { method: 'POST' });

export interface CooldownClient {
  phone: string;
  last_status: string;
  last_at: string;
  cooldown_until: string;
}
export const apiGetCooldownClients = (): Promise<{ clients: CooldownClient[]; total: number }> =>
  apiFetch('cooldown-clients');
