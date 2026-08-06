// Shared phone-recovery logic — single source of truth for both the
// read-only report (recover-wrong-phones.mjs) and the apply pass
// (apply-phone-recovery.mjs). No DB access here; pure functions over rows.
//
// Recovery key: in this CRM a customer IS their phone (no customer id), so a
// broken phone can't find its owner's other orders by phone. We bridge by
// NAME (+ postal/city corroboration) to a sibling order that has a clean number.

// Columns the order scan must select.
export const ORDER_SELECT =
  'id, display_id, customer_name, customer_phone, customer_city, customer_address, postal_code, status, trash_reason, created_at';

// ── Cyrillic↔Latin name normalization ────────────────────────────────────────
// Kept in sync with src/lib/transliterate.ts (same precedent as the import .mjs).
const CYR_TO_LAT = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ж':'zh','з':'z','и':'i',
  'й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s',
  'т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sht',
  'ъ':'a','ь':'y','ю':'yu','я':'ya',
  // Macedonian-only letters — absent from the Bulgarian original, so they used
  // to pass through unchanged and leave a mixed-script key. Keep in sync with
  // src/lib/transliterate.ts.
  'ѓ':'gj','ѕ':'dz','ј':'j','љ':'lj','њ':'nj','ќ':'kj','џ':'dzh','ѐ':'e','ѝ':'i',
  'А':'a','Б':'b','В':'v','Г':'g','Д':'d','Е':'e','Ж':'zh','З':'z','И':'i',
  'Й':'y','К':'k','Л':'l','М':'m','Н':'n','О':'o','П':'p','Р':'r','С':'s',
  'Т':'t','У':'u','Ф':'f','Х':'h','Ц':'ts','Ч':'ch','Ш':'sh','Щ':'sht',
  'Ъ':'a','Ь':'y','Ю':'yu','Я':'ya',
  'Ѓ':'gj','Ѕ':'dz','Ј':'j','Љ':'lj','Њ':'nj','Ќ':'kj','Џ':'dzh','Ѐ':'e','Ѝ':'i',
};
export function translit(s) {
  return String(s || '').split('').map(c => CYR_TO_LAT[c] ?? c).join('');
}
// Person key: transliterate → lowercase → keep letters/digits/space → sort tokens
// (so "Иван Петров" === "Петров Иван"). Empty / too-short keys are unusable.
export function nameKey(name) {
  const norm = translit(name).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!norm) return '';
  const tokens = norm.split(' ').filter(t => t.length >= 2);
  if (!tokens.length) return '';
  return tokens.sort().join(' ');
}

// ── Phone classification (mirrors normalizeBgPhone + sci-notation pollution) ──
const SCI = /[eE]\+?\d/; // 3.59889E+11 style pollution
export function classifyPhone(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { good: false, reason: 'empty' };
  if (SCI.test(s)) return { good: false, reason: 'sci_notation' };
  const digits = s.replace(/\D/g, '');
  if (!digits) return { good: false, reason: 'empty' };
  if (digits.length < 8) return { good: false, reason: 'too_short' };
  let nat = digits;
  if (nat.startsWith('00')) nat = nat.slice(2);
  if (nat.startsWith('359')) nat = nat.slice(3);
  else if (nat.startsWith('0')) nat = nat.slice(1);
  nat = nat.replace(/^0+/, '');
  if (nat.length < 8) return { good: false, reason: 'too_short' };
  if (nat.length > 10) return { good: false, reason: 'too_long' };
  return { good: true, reason: 'valid', e164: '+359' + nat };
}
export const last8 = (p) => String(p || '').replace(/\D/g, '').slice(-8);

// ── Self-salvage: recover the buried number from a concatenated string ────────
// Import bugs glued two phones together (e.g. "0889799264" + "889942668").
// We ONLY salvage when the FIRST chunk is unambiguously a BG mobile — national
// 9 digits starting with a real mobile prefix (87/88/89/98/99). This skips
// foreign numbers (+49…, +44…), landline-first blobs (052…, 032…) and junk,
// so we recover the clear majority without ever guessing.
const BG_MOBILE_HEAD = new Set(['87', '88', '89', '98', '99']);
export function salvageBuriedMobile(raw) {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length < 9) return null;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('359')) d = d.slice(3);
  else if (d.startsWith('0')) d = d.slice(1);
  if (d.length < 9) return null;
  if (!BG_MOBILE_HEAD.has(d.slice(0, 2))) return null;
  return '+359' + d.slice(0, 9);
}

// ── Address corroboration tokens ─────────────────────────────────────────────
export function postalToken(o) {
  const pc = String(o.postal_code || '').match(/\b(\d{4})\b/);
  if (pc) return pc[1];
  const inAddr = `${o.customer_city || ''} ${o.customer_address || ''}`.match(/\b(\d{4})\b/);
  return inAddr ? inAddr[1] : '';
}
export function cityToken(o) {
  let v = translit(o.customer_city || '').toLowerCase();
  v = v.replace(/\b(gr|s|grad|selo|obsht|obl)\.?\b/g, ' ');   // drop гр./с./общ./обл. prefixes
  v = v.replace(/[^a-z]+/g, ' ').replace(/\s+/g, ' ').trim();
  return v.length >= 3 ? v : '';
}

const TRASHED_WRONG = ['wrong_number', 'not_reachable'];

// computeRecovery(orders) → { rows, tierA, tierSelf, tierB, conflicts, unrecoverable, reasonCounts, goodCount }
// Each row carries CSV fields plus internal refs (_bad order, _proposed e164,
// _source good order) so the apply pass can act without re-deriving.
//
// Recovery preference per bad order:
//   A    — sibling by name + postal/city (address-corroborated), single number.
//   SELF — the order's OWN buried BG mobile, de-corrupted from a glued string.
//   B    — sibling by name only (single agreed number, no address to confirm).
//   CONFLICT / UNRECOVERABLE otherwise.
// SELF outranks B (own data beats a name-only stranger) and breaks sibling ties.
export function computeRecovery(orders) {
  const goodByName = new Map(); // nameKey → [good orders]
  const bad = [];
  let goodCount = 0;
  const reasonCounts = {};

  for (const o of orders) {
    o._cls = classifyPhone(o.customer_phone);
    o._nk = nameKey(o.customer_name);
    o._postal = postalToken(o);
    o._city = cityToken(o);
    // Buried-mobile salvage only makes sense when the raw value is over-long.
    o._self = o._cls.reason === 'too_long' ? salvageBuriedMobile(o.customer_phone) : null;
    const trashedWrong = o.status === 'trashed' && TRASHED_WRONG.includes(o.trash_reason || '');

    // A clean-format number is only a trustworthy SOURCE if the order itself
    // isn't trashed — a trashed order's contact is suspect, never propagate it.
    if (o._cls.good && o.status !== 'trashed') {
      goodCount++;
      if (o._nk) {
        if (!goodByName.has(o._nk)) goodByName.set(o._nk, []);
        goodByName.get(o._nk).push(o);
      }
    }
    if (!o._cls.good || trashedWrong) {
      o._badReason = trashedWrong ? `trashed_${o.trash_reason}` : o._cls.reason;
      reasonCounts[o._badReason] = (reasonCounts[o._badReason] || 0) + 1;
      bad.push(o);
    }
  }

  const rows = [];
  let tierA = 0, tierSelf = 0, tierB = 0, conflicts = 0, unrecoverable = 0;

  for (const o of bad) {
    // Same-name siblings with a clean number (address-aware accept/reject).
    const accepted = [];
    if (o._nk) {
      for (const g of (goodByName.get(o._nk) || [])) {
        if (g.id === o.id) continue;
        if (last8(g.customer_phone) && last8(g.customer_phone) === last8(o.customer_phone)) continue; // self-fix guard
        let corroborated = false, basis = 'name-only';
        if (o._postal && g._postal) {
          if (o._postal === g._postal) { corroborated = true; basis = 'name+postal'; }
          else continue; // different postal → likely different person
        }
        if (!corroborated && o._city && g._city) {
          if (o._city === g._city) { corroborated = true; basis = 'name+city'; }
          else continue; // different city → reject
        }
        accepted.push({ g, corroborated, basis });
      }
    }
    const distinct = new Set(accepted.map(a => last8(a.g._cls.e164)));

    // A: corroborated sibling with a single agreed number — strongest.
    if (distinct.size >= 1 && accepted.some(a => a.corroborated) && distinct.size === 1) {
      accepted.sort((a, b) => (b.corroborated - a.corroborated) || (new Date(b.g.created_at) - new Date(a.g.created_at)));
      tierA++; rows.push(mkRow(o, { tier: 'A', best: accepted[0], nCandidates: accepted.length })); continue;
    }
    // SELF: own buried mobile (also breaks sibling conflicts and beats name-only).
    if (o._self) { tierSelf++; rows.push(mkRow(o, { tier: 'SELF' })); continue; }
    // CONFLICT: siblings disagree and we have no own number to fall back on.
    if (distinct.size > 1) { conflicts++; rows.push(mkRow(o, { tier: 'CONFLICT', accepted })); continue; }
    // B: single name-only sibling.
    if (distinct.size === 1) {
      accepted.sort((a, b) => new Date(b.g.created_at) - new Date(a.g.created_at));
      tierB++; rows.push(mkRow(o, { tier: 'B', best: accepted[0], nCandidates: accepted.length })); continue;
    }
    unrecoverable++; rows.push(mkRow(o, null));
  }

  return { rows, tierA, tierSelf, tierB, conflicts, unrecoverable, reasonCounts, goodCount };
}

function mkRow(o, res) {
  const base = {
    bad_display_id: o.display_id,
    status: o.status,
    bad_reason: o._badReason,
    customer_name: o.customer_name || '',
    bad_phone: o.customer_phone || '',
    _bad: o,
    _wasTrashed: o.status === 'trashed',
  };
  if (!res) return { ...base, proposed_phone: '', source_display_id: '', source_status: '', tier: 'UNRECOVERABLE', match_basis: '', n_candidates: 0 };
  if (res.tier === 'CONFLICT') {
    const opts = [...new Set(res.accepted.map(a => a.g._cls.e164))].join(' | ');
    return { ...base, proposed_phone: opts, source_display_id: '', source_status: '', tier: 'CONFLICT', match_basis: 'name (disagreeing siblings)', n_candidates: res.accepted.length };
  }
  if (res.tier === 'SELF') {
    return {
      ...base,
      proposed_phone: o._self, source_display_id: '(buried in number)', source_status: '',
      tier: 'SELF', match_basis: 'self-buried-mobile', n_candidates: 0,
      _proposed: o._self, _source: null,
    };
  }
  return {
    ...base,
    proposed_phone: res.best.g._cls.e164,
    source_display_id: res.best.g.display_id,
    source_status: res.best.g.status,
    tier: res.tier,
    match_basis: res.best.basis,
    n_candidates: res.nCandidates,
    _proposed: res.best.g._cls.e164,
    _source: res.best.g,
  };
}
