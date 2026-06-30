# Recording ↔ Call linkage (the accurate, no-exceptions design)

This is how a call recording becomes attached to the right `call_logs` row, why
the old design failed, and exactly what to deploy on the PBX.

## What was wrong (operator bug reports #1 and #4)

Recordings live only on the PBX disk; the CRM matched them to calls at READ time
by **last-8 phone + nearest timestamp within ±20 min**, comparing the recording
`mtime` (≈ call END) against the call `connected_at` (call START):

- **#1 long calls had no recording** — a 35-min call's start and end are 35 min
  apart, always outside the ±20 min window, so it could *never* match.
- **#4 a recording showed on the wrong call** — "nearest wins" with no stable
  identity let two calls to the same number swap recordings.

## The contract that makes it accurate

Asterisk records via MixMonitor in `[macro-dialout-trunk-predial-hook]` to:

```
/var/spool/asterisk/monitor/YYYY/MM/DD/out-<HHMMSS>-<ext>-<callerid>-to-<dialed>-<uniqueid>.wav
```

Two facts we now exploit:

1. **`uniqueid` is the last filename token and is `<epoch>.<seq>`** — its leading
   integer is the channel-creation time = the call **start**. So the CRM derives
   a reliable recording `[start, end]` interval (start from the uniqueid, end from
   `mtime`) with no timezone math and **no `elyon-rec.php` change**.
2. **`ext` identifies the agent** → `telephony_extensions` → `agent_id`.

## Two layers (both shipped)

**Layer 1 — correct matcher (live, no PBX deploy needed).**
`matchRecordingsToCalls()` in `supabase/functions/api/index.ts` is the single
matcher used by Call History, `/recordings`, and both `/voip/health` coverage
surfaces. It matches a recording `[start, end]` to a call `[started_at, ended_at]`
by **interval overlap** (falling back to END-proximity within 20 min only when no
start can be derived), **gated on agent + last-8 phone**, assigned **one-to-one**.
Long calls overlap fully regardless of length (#1 fixed); distinct calls don't
overlap, so they never swap (#4 fixed).

**Layer 2 — permanent uniqueid anchor (PBX deploy).**
On hangup the PBX posts the recording's identity to `POST /api/webhook/recording`,
which upserts `call_recordings` (PK `uniqueid`) and stamps
`call_logs.recording_uniqueid` / `recording_file` onto the matched call. Idempotent
on uniqueid → the link is persisted and can never drift. Call History then reads
`recording_file` straight from the DB (Layer 1 only fills rows not yet anchored).

## PBX deploy (Layer 2)

Artifacts live in `docs/telephony/health/`. Same trust model / secret as the other
hooks — read `docs/telephony/MONITORING.md` first.

1. Install the new hook script:
   ```
   install -o root -g asterisk -m 750 elyon-recording.sh /usr/local/bin/elyon-recording.sh
   ```
   (`/etc/asterisk/elyon-webhook.secret` already exists for the call-quality hook;
   `WEBHOOK_SECRET` is the same value already set on the edge function.)
2. Apply the dialplan edits in `extensions_custom_hangup_hook.conf`:
   - in `[macro-dialout-trunk-predial-hook]` add `Set(ELYONSTART=${EPOCH})` next to
     the existing `ELYONEXT`/`OUTNUM` sets;
   - add the `System(/usr/local/bin/elyon-recording.sh …)` line to `[elyon-cq]`
     (already shown in that file).
   - `fwconsole reload`.
3. Verify: place a test call, then
   `select uniqueid, file, call_log_id from call_recordings order by created_at desc limit 5;`
   shows the new row linked to a `call_logs.id`, and Call History shows Play on it.

## Backfill (last ~30 days)

`node scripts/backfill-recordings.mjs` pulls the current `elyon-rec.php?mode=list`,
parses `uniqueid`/`start` from each filename, populates `call_recordings`, and links
to historical `call_logs` with the same overlap matcher. Re-runnable (idempotent on
uniqueid). Recordings older than ~30 days are purged from the PBX (operator
decision — no archival) and are out of reach by design; Call History shows
"expired" for answered calls past retention with no file.

## Optional: `elyon-rec.php` enhancement (not required)

The matcher derives `start`/`uniqueid` from the filename, so no change is needed.
If you ever want them returned explicitly by `mode=list`, parse the last
hyphen-separated token (minus `.wav`) as `uniqueid` and its leading integer as the
start epoch, and add them to each JSON entry. Keep the existing signed/path-jailed
serving untouched.
