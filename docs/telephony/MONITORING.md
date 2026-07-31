# Elyon Telephony — Health & Observability

> The superadmin-only **VOIP Health** page in the CRM (`/voip-health`, sidebar → *VOIP Health*)
> shows the true state of the phone system: server (disk/memory/CPU), **lines in use vs the
> A1 trunk's channel cap** (read live from the PBX — never hardcoded), A1 trunk up/down, recording coverage (which answered calls have **no**
> recording and why), call-quality (one-way audio), fail2ban attacks, recent errors, and
> outbound minutes. A red/amber **alert banner** appears app-wide for the superadmin when
> something trips a threshold.
>
> The CRM half ships with the repo (migration `20260618120000_pbx_health.sql`, edge-function
> routes, page, banner). This doc is the **PBX-side deploy** that feeds it. No secrets here.

## Architecture

```
 CRM browser ──► GET /api/voip/health ─(HMAC)─► elyon-health.php (live pull, on demand)
 (superadmin)                 │ merges call_logs + recordings + call_quality + incidents[]
                              ▼
        pbx_health_snapshots ◄── POST /api/webhook/pbx-health ◄── cron: elyon-pbx-health.sh (every 3 min)
        call_quality         ◄── POST /api/webhook/call-quality ◄── hangup hook: elyon-call-quality.sh
```

- **Live pull** = instant "right now" cards (admin opens the page).
- **Cron push** = trend history + alerting even when the page is closed.
- **Hangup hook** = brand-new per-call quality data (one-way audio / packet loss).

All three reuse the existing trust boundaries: the live pull is HMAC-signed with
`/etc/asterisk/elyon-rec.key` (same as recordings); the two pushes are HMAC-signed with
`WEBHOOK_SECRET` (same as the missed-call webhooks).

## Files in this folder (deploy targets on the PBX, `104.152.48.222`)

| Repo file | Deploy to | Perms |
|---|---|---|
| `health/elyon-health.php` | `/var/www/html/elyon-health.php` | `root:apache 644` |
| `health/elyon-pbx-health.sh` | `/usr/local/bin/elyon-pbx-health.sh` | `root:root 750` |
| `health/elyon-pbx-health.cron` | `/etc/cron.d/elyon-pbx-health` | `root:root 644` |
| `health/elyon-call-quality.sh` | `/usr/local/bin/elyon-call-quality.sh` | `root:asterisk 750` |
| `health/extensions_custom_hangup_hook.conf` | append into `/etc/asterisk/extensions_custom.conf` | — |

## Deploy steps (run as root on the PBX)

1. **Shared secret for the pushes** (same value as Supabase function secret `WEBHOOK_SECRET`):
   ```bash
   printf '%s' '<WEBHOOK_SECRET>' > /etc/asterisk/elyon-webhook.secret
   chmod 600 /etc/asterisk/elyon-webhook.secret
   ```

2. **Health collector + scripts:**
   ```bash
   cp elyon-health.php        /var/www/html/elyon-health.php
   cp elyon-pbx-health.sh     /usr/local/bin/   && chmod 750 /usr/local/bin/elyon-pbx-health.sh
   cp elyon-call-quality.sh   /usr/local/bin/   && chown root:asterisk /usr/local/bin/elyon-call-quality.sh && chmod 750 /usr/local/bin/elyon-call-quality.sh
   cp elyon-pbx-health.cron   /etc/cron.d/elyon-pbx-health
   ```

3. **Privilege note.** php-fpm runs as the **`asterisk`** user on this box, so the live-pull
   collector runs `asterisk -rx …` and reads `/var/log/asterisk/full` + the monitor dir directly —
   **no sudo needed** for those. The only privileged command is fail2ban, so add one narrow grant
   (the cron path runs as root and already gets everything):
   ```bash
   cat >/etc/sudoers.d/elyon-health <<'EOF'
   asterisk ALL=(root) NOPASSWD: /usr/bin/fail2ban-client status asterisk
   EOF
   chmod 440 /etc/sudoers.d/elyon-health
   visudo -c
   systemctl restart php-fpm
   ```
   The collector degrades gracefully (null) for anything it can't read.

4. **Call-quality hangup hook** — append `extensions_custom_hangup_hook.conf` into
   `/etc/asterisk/extensions_custom.conf`, then `fwconsole reload`. Verify the RTP-QoS unit
   once: `asterisk -rx 'pjsip show channelstats'` during a live call (the script assumes
   seconds→ms; adjust `elyon-call-quality.sh` if your build already reports ms).

5. **Smoke test:**
   ```bash
   php /var/www/html/elyon-health.php | jq .          # CLI mode → full JSON
   /usr/local/bin/elyon-pbx-health.sh                 # push one snapshot now
   # then open the CRM VOIP Health page → Server tab should show a fresh snapshot.
   ```
   Live pull (signed) check from the CRM side: open `/voip-health` as superadmin — the
   Overview cards populate within ~20s (the page auto-refreshes).

## Thresholds → alert banner / incidents

Computed server-side in `GET /api/voip/health` (`supabase/functions/api/index.ts`):

| Code | Condition | Level |
|---|---|---|
| `pbx_unreachable` | health endpoint down | critical |
| `trunk_down` | A1 SBC not reachable | critical |
| `asterisk_down` | Asterisk not running | critical |
| `disk_high` | disk ≥ 85% (≥ 92% critical) | warn/crit |
| `mem_high` | memory ≥ 92% | warning |
| `recordings_stalled` | no new recording in 3h during 09:00–19:00 | warning |
| `attacks` | ≥ 10 IPs banned by fail2ban | warning |
| `low_coverage` | < 80% of ≥10 answered calls recorded today | warning |
| `one_way_audio` | any one-way-audio call today | warning |

Tune in one place (the `incidents.push(...)` block).

## "Calls with no recording" — how to read it

The **Recordings** tab lists every answered call with no matched recording, tagged with a
reason. Recordings live only on the PBX (`/var/spool/asterisk/monitor`) and are matched to
calls by last-8 phone digits within ±20 min, so a gap means one of:
- `no_recording_on_pbx` — MixMonitor didn't produce a file (or it was < 2 KB / disk was full);
- `outside_time_window` — a recording for that number exists but not near this call (clock drift — check NTP);
- `unmatchable_phone` — the stored phone couldn't be normalised.

When coverage drops, SSH in and check the day's dir + disk + `asterisk -rx 'core show channels'`.

## A1 minutes — what to request

The Minutes tab counts our **own** outbound minutes from `call_logs`. For the billed/authoritative
figure, ask A1 for:
- **Self-care / customer portal** login for the SIP trunk (online CDR + monthly minute usage);
- a **monthly CDR export / itemized statement** for the trunk;
- whether they offer an **API or scheduled CDR feed** we can pull automatically;
- the **included-minutes / bundle** terms so we can show "used vs included".

(Asterisk's own CDR is currently not logging — ODBC modules were never compiled — so `call_logs`
is our source of truth. Fixing Asterisk CDR is optional and out of scope here.)
