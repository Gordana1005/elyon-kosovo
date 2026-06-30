#!/usr/bin/env node
// Backfill + audit recording↔call linkage (operator bug reports #1 and #4).
//
// Pulls the current PBX recordings list (elyon-rec.php?mode=list), derives each
// recording's uniqueid + start from its filename (uniqueid = last filename
// token = "<epoch>.<seq>"; the leading epoch is the call START), then matches
// recordings to call_logs with the SAME deterministic one-to-one matcher the
// CRM uses (interval overlap, agent + last-8 phone gated) and:
//   • upserts public.call_recordings (PK uniqueid),
//   • stamps call_logs.recording_uniqueid / recording_file on the matched row.
// Idempotent on uniqueid. Recordings older than the PBX ~30-day purge are out of
// reach by design (no archival).
//
// Usage:
//   node --env-file=.env scripts/backfill-recordings.mjs            # dry-run + audit
//   node --env-file=.env scripts/backfill-recordings.mjs --commit   # write links
//   node --env-file=.env scripts/backfill-recordings.mjs --audit    # audit only
//
// Env: VITE_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
//      REC_SHARED_SECRET (same value as /etc/asterisk/elyon-rec.key),
//      REC_HOST (optional, defaults to the production PBX).

import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'node:crypto';

const COMMIT = process.argv.includes('--commit');
const AUDIT_ONLY = process.argv.includes('--audit');
const DAYS = (() => { const a = process.argv.find(x => x.startsWith('--days=')); return a ? parseInt(a.split('=')[1]) : 45; })();

// PostgREST caps a single response at db-max-rows (1000 on Supabase), so a plain
// .limit(20000) silently returns only 1000 — which starved the matcher of older
// candidate calls. Page through with .range() to get the full set.
async function fetchAll(table, cols, sinceIso) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await supabase.from(table).select(cols)
      .gte('created_at', sinceIso).order('created_at', { ascending: false })
      .range(off, off + 999);
    if (error) { console.error(`${table} fetch error:`, error.message); process.exit(1); }
    if (!data || !data.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REC_SECRET = process.env.REC_SHARED_SECRET;
const REC_HOST = process.env.REC_HOST || 'https://pbx.elyoncall.com/elyon-rec.php';
if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const last8 = (v) => String(v || '').replace(/\D/g, '').slice(-8);

// ── the matcher (must mirror matchRecordingsToCalls in the edge function) ──────
function matchRecordingsToCalls(recordings, calls, extToAgent = {}) {
  const WINDOW_MS = 20 * 60 * 1000;
  const callEndMs = (c) => new Date(c.ended_at || c.connected_at || c.started_at || c.created_at || 0).getTime();
  const callStartMs = (c) => new Date(c.connected_at || c.started_at || c.created_at || 0).getTime();
  const recStartMs = (r) => {
    if (r.start) return r.start * 1000;
    const uid = r.uniqueid || (r.file ? String(r.file).replace(/\.wav$/i, '').split('-').pop() || '' : '');
    const epoch = parseInt(String(uid).split('.')[0], 10);
    return Number.isFinite(epoch) && epoch > 1e9 ? epoch * 1000 : null;
  };
  const byPhone = {};
  for (const c of calls) { const p = last8(c.customer_phone); if (p) (byPhone[p] = byPhone[p] || []).push(c); }
  const pairs = [];
  for (const rec of recordings) {
    const p = last8(rec.dialed); if (!p || !byPhone[p]) continue;
    const recEnd = (rec.mtime || 0) * 1000;
    const recStart = recStartMs(rec);
    const recAgent = rec.ext ? extToAgent[rec.ext] : undefined;
    for (const call of byPhone[p]) {
      if (recAgent && call.agent_id && recAgent !== call.agent_id) continue;
      const cEnd = callEndMs(call), cStart = callStartMs(call);
      let score;
      if (recStart) {
        const overlap = Math.min(recEnd, cEnd) - Math.max(recStart, cStart);
        if (overlap > 0) score = overlap;
        else { const d = Math.abs(cEnd - recEnd); if (d > WINDOW_MS) continue; score = -d; }
      } else { const d = Math.abs(cEnd - recEnd); if (d > WINDOW_MS) continue; score = -d; }
      pairs.push({ rec, call, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const out = new Map(); const usedRec = new Set(); const usedCall = new Set();
  for (const { rec, call } of pairs) {
    if (usedRec.has(rec) || usedCall.has(call.id)) continue;
    usedRec.add(rec); usedCall.add(call.id); out.set(call.id, rec);
  }
  return out;
}

function parseRec(r) {
  const uniqueid = r.uniqueid || (r.file ? String(r.file).replace(/\.wav$/i, '').split('-').pop() || '' : '');
  const startEpoch = (() => { const e = parseInt(String(uniqueid).split('.')[0], 10); return Number.isFinite(e) && e > 1e9 ? e : null; })();
  return { ...r, uniqueid, start: r.start || startEpoch || undefined };
}

async function fetchRecordings() {
  if (!REC_SECRET) { console.error('Missing REC_SHARED_SECRET — cannot list PBX recordings.'); process.exit(1); }
  const exp = Math.floor(Date.now() / 1000) + 120;
  const sig = createHmac('sha256', REC_SECRET).update(`list|${exp}`).digest('hex');
  const res = await fetch(`${REC_HOST}?mode=list&exp=${exp}&sig=${sig}`);
  if (!res.ok) { console.error(`elyon-rec.php list failed: ${res.status}`); process.exit(1); }
  const arr = await res.json();
  return (Array.isArray(arr) ? arr : []).filter((x) => (x.size || 0) > 2000).map(parseRec);
}

async function audit() {
  const since = new Date(Date.now() - DAYS * 864e5).toISOString();
  const { data: longCalls } = await supabase.from('call_logs')
    .select('id,recording_file,talk_seconds').gte('created_at', since).gt('talk_seconds', 1200);
  const longTotal = (longCalls || []).length;
  const longWithRec = (longCalls || []).filter((c) => c.recording_file).length;
  // one-to-one invariant: recording_uniqueid is uniquely indexed, so a duplicate
  // is structurally impossible; we surface unlinked recent recordings instead.
  const { count: unlinked } = await supabase.from('call_recordings')
    .select('uniqueid', { count: 'exact', head: true }).is('call_log_id', null).gte('created_at', since);
  console.log('── audit ──');
  console.log(`  long (>20min) calls last ${DAYS}d: ${longTotal}; with recording: ${longWithRec}; MISSING: ${longTotal - longWithRec}`);
  console.log(`  call_recordings unlinked (no call_log) last ${DAYS}d: ${unlinked ?? 'n/a'}`);
}

async function main() {
  if (AUDIT_ONLY) { await audit(); return; }

  const recs = await fetchRecordings();
  const since = new Date(Date.now() - DAYS * 864e5).toISOString();
  const calls = await fetchAll('call_logs', 'id,agent_id,customer_phone,started_at,connected_at,ended_at,created_at', since);
  const { data: te } = await supabase.from('telephony_extensions').select('extension,user_id');
  const extToAgent = {}; for (const x of te || []) if (x.extension && x.user_id) extToAgent[x.extension] = x.user_id;

  const matched = matchRecordingsToCalls(recs, calls || [], extToAgent); // call.id -> rec
  const recToCall = new Map(); for (const [cid, rec] of matched) recToCall.set(rec, cid);

  let willLink = 0, willOrphan = 0;
  const recRows = [];
  for (const rec of recs) {
    const cid = recToCall.get(rec) || null;
    if (cid) willLink++; else willOrphan++;
    recRows.push({
      uniqueid: rec.uniqueid,
      ext: rec.ext || null,
      dialed_last8: last8(rec.dialed) || null,
      started_at: rec.start ? new Date(rec.start * 1000).toISOString() : null,
      ended_at: rec.mtime ? new Date(rec.mtime * 1000).toISOString() : null,
      duration_seconds: (rec.start && rec.mtime) ? Math.max(0, rec.mtime - rec.start) : null,
      file: rec.file || null,
      size: rec.size || null,
      agent_id: (rec.ext && extToAgent[rec.ext]) || null,
      call_log_id: cid,
    });
  }

  console.log(`recordings: ${recs.length} | would link: ${willLink} | orphans: ${willOrphan} | commit: ${COMMIT}`);
  if (!COMMIT) { await audit(); console.log('\n(dry-run — pass --commit to write)'); return; }

  // Upsert call_recordings (PK uniqueid), in chunks.
  for (let i = 0; i < recRows.length; i += 500) {
    const chunk = recRows.slice(i, i + 500).filter((r) => r.uniqueid);
    if (!chunk.length) continue;
    const { error } = await supabase.from('call_recordings').upsert(chunk, { onConflict: 'uniqueid' });
    if (error) { console.error('call_recordings upsert error:', error.message); process.exit(1); }
  }
  // Stamp the link onto call_logs (clear any stale holder of the uniqueid first).
  let stamped = 0;
  for (const [cid, rec] of matched) {
    if (!rec.file || !rec.uniqueid) continue;
    await supabase.from('call_logs').update({ recording_uniqueid: null, recording_file: null })
      .eq('recording_uniqueid', rec.uniqueid).neq('id', cid);
    const { error } = await supabase.from('call_logs')
      .update({ recording_uniqueid: rec.uniqueid, recording_file: rec.file }).eq('id', cid);
    if (!error) stamped++;
  }
  console.log(`linked ${stamped} call_logs rows.`);
  await audit();
}

main().catch((e) => { console.error(e); process.exit(1); });
