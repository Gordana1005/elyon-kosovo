# Calls — how the calling system works

> The Calls page is the agent's primary workspace. The **audio is real** — browser WebRTC over the
> live A1 SIP trunk via `src/lib/voip/RealVoipEngine.ts` (sip.js). Everything around it (queue,
> customer dossier, outcome capture, telemetry, status flips, history, recordings) is production‑wired.
> The go‑live record is [CALLING_PLAN_SIP.md](CALLING_PLAN_SIP.md). This doc is the **current** behaviour.

---

## 1. The pieces

| Piece | File | Role |
|---|---|---|
| Calls page | [../src/pages/CallsPage.tsx](../src/pages/CallsPage.tsx) | Orchestrates queue, customer, dial, outcomes |
| Call engine | [../src/contexts/VoipContext.tsx](../src/contexts/VoipContext.tsx) | `useVoip()` — `startCall/hangup/endCall/confirmCall`, call state, telemetry. Also publishes every state transition to the call‑state bus for presence reporting. **Live (RealVoipEngine).** |
| Softphone engine | [../src/lib/voip/RealVoipEngine.ts](../src/lib/voip/RealVoipEngine.ts), [../src/lib/voip/pbxConfig.ts](../src/lib/voip/pbxConfig.ts) | sip.js WebRTC client over WSS to the Sofia PBX |
| Call‑state bus | [../src/lib/voip/callStateBus.ts](../src/lib/voip/callStateBus.ts) | Dependency‑free module store broadcasting softphone state transitions; `AuthContext` relays them to `POST /presence/heartbeat` as `voip_state` (see §3b) |
| Queue | [../src/components/calls/useMyQueue.ts](../src/components/calls/useMyQueue.ts) | The agent's assigned segment lists + members |
| Customer strip | [../src/components/calls/ClientProfileCard.tsx](../src/components/calls/ClientProfileCard.tsx) | Info · 4 metrics + quality badge · persistent note · toolbar · Orders/Calls dossier |
| Active call widget | [../src/components/calls/ActiveCallWidget.tsx](../src/components/calls/ActiveCallWidget.tsx) | Live status pill, duration, mute/hangup |
| Outcome picker | [../src/components/calls/ChooseAnswerButton.tsx](../src/components/calls/ChooseAnswerButton.tsx) | Two‑level Answered/Not‑answered → reason |
| Notes | [../src/components/calls/CallNotesEditor.tsx](../src/components/calls/CallNotesEditor.tsx), [CustomerNotesPanel.tsx](../src/components/calls/CustomerNotesPanel.tsx) | Per‑call note vs persistent customer note |
| TAKE lock | [../src/hooks/useActiveCallView.ts](../src/hooks/useActiveCallView.ts) | Heartbeat soft‑lock |
| Server | `POST /call-logs`, `applyOutcomeToOrder()` | Logs the call, flips order status |

---

## 2. The agent's flow

```
1. Land on /calls → queue auto-picks the first non-empty assigned segment list (no count shown to agents)
2. ClientProfileCard loads the customer: name, 4 metrics (orders / lifetime value / last contact / quality),
   persistent "About this customer" note, Orders + Calls dossier tabs
   └ useActiveCallView heartbeats → customer's pending orders flip to TAKE (soft lock for other agents)
3. Agent clicks "Dial <phone>" → useVoip().startCall(phone, linkedContext)
   └ linkedContext = the customer's most relevant order, so the call attaches to it
4. ActiveCallWidget shows: dialing → in_call (duration ticks)
5. Agent talks. Two ways to finish:
   • "Confirm Order" → opens CreateOrderModal (status forced 'confirmed'), call stays live so the agent
     can read back address/price; saving the order logs the call as 'interested' and advances the queue
   • "Choose Answer" (ChooseAnswerButton):
        Answered → Confirmed / Cancelled (reason) / Trash (reason: wrong number / wrong person /
                   Unreachable / rude / uncooperative / other)
        Not answered → Didn't answer (paced retry — see §5b)
6. End → hangup() freezes the duration + snapshots ended_at → outcome picker → finalize() → POST /call-logs
7. Screen STAYS on the customer with a "Next customer" button (so the agent can still create an order /
   edit notes post-call). Clicking it advances to the next queue member.
```

### Why the screen doesn't auto‑advance
Deliberate: a customer often verbally confirms without the agent clicking "Confirm" mid‑call. Staying put
lets the agent create the order or fix notes afterward. Auto‑advance would lose that window.

### Why no queue count for agents
Showing "37 left to call" creates pacing/rushing psychology. Plain agents get **silent auto‑pick**;
admin/manager get a visible Queue dropdown (`list — N to call (M total)`) for oversight.

---

## 3. Call telemetry (real)

The **call record is fully structured** and analytics run off it. `VoipContext` tracks:

- `dial_started_at` — when the agent pressed Dial.
- `connected_at` — the SIP answer time. `null` = never connected.
- `ended_at` — snapshotted the instant the agent presses End (= SIP BYE), so post‑call paperwork time
  doesn't inflate the duration.
- `connection_state` — the real SIP outcome (`answered` / `no_answer` / `busy` / `failed` / `voicemail`).

`finalize()` posts to **`POST /call-logs`** with `started_at` / `connected_at` / `ended_at` /
`connection_state` / `customer_phone` / `outcome` / `notes` (+ structured `cancellation_reason` when
cancelling). The DB columns `ring_seconds` / `talk_seconds` / `total_seconds` exist for richer telemetry.

### 3b. Live call presence (who's on a call right now)

Separate from telemetry: a **live** "is this agent on a call?" signal, used for supervision.

- The softphone has five states — `idle · dialing · in_call · wrapping · ending`. `VoipContext` writes each
  transition to [../src/lib/voip/callStateBus.ts](../src/lib/voip/callStateBus.ts) **and** immediately fires
  `POST /presence/heartbeat` with `{voip_state}` so the change lands within a second, not on the next beat.
- `AuthContext`'s regular **45 s presence beat** reads the bus and includes `voip_state` **only while
  non‑idle**. While a call is live the beat keeps running even if the tab is hidden.
- Server side: `profiles.voip_state` + `voip_state_at` (migration `20260908000000`). `GET /agents/online`
  and `GET /operations-center` compute **`in_call` = `is_online` AND `voip_state ∈ {dialing, in_call}` AND
  `voip_state_at` younger than 3 min** — the staleness guard, so a browser that dies mid‑call doesn't
  freeze the agent as permanently busy.
- **Multi‑tab safety:** `idle` is only ever written by the tab that actually ends the call, and
  `VoipContext` skips its report on initial mount. A second, idle tab therefore can't clobber a live call.
- **Where it surfaces:** the Assigner agent card's **Status tile** (In call / Available / Offline — it
  replaced the old "Open orders" tile) and the **"In call" badge** on Ops‑Center online rows.
- **Caveat — this is browser‑self‑reported, not PBX‑derived.** An agent sitting on a tab loaded before the
  deploy shows "Available" until they refresh. Have them refresh **between** calls: reloading mid‑call kills
  the WebRTC session.

---

## 4. What happens server‑side on a logged call

`POST /call-logs` ([BACKEND_API.md](BACKEND_API.md) §6):

1. **If `context_type='order'`** → `applyOutcomeToOrder()` flips the order status first (confirmed /
   cancelled / call_again / trashed), recording reason + `cancelled_by`/`confirmed_by`. If the flip is
   illegal (e.g. cancelling a shipped order) it returns **409 before** writing the log — no orphan log.
2. Inserts the `call_logs` row with all telemetry.
3. **If `context_type='prediction_lead'`** → maps the outcome to `prediction_leads.status`
   (`no_answer`/`interested`/`not_interested`/`not_contacted`) and locks the lead to the agent on
   interested/call_again.

The order's status change fires the **segment trigger**, so a paid/cancelled/returned outcome re‑classifies
the customer into the right prediction list automatically.

---

## 5. Outcomes (UI → DB)

The agent sees a friendly two‑level picker; the DB stores leaf values:

| Agent picks | Logged outcome | Order effect |
|---|---|---|
| Answered → Confirmed | (order created `confirmed` via modal) | pending→confirmed |
| Answered → Cancelled (+reason) | `cancelled` | →cancelled (records a cancelled order with the customer's last real product) |
| Answered → Trash | `trash` | →trashed |
| Not answered → Didn't answer | `didnt_answer` (queue) / `no_answer` (log) | paced retry, then auto‑trash — see §5b |
| (lead context) Interested / Not interested | `interested` / `not_interested` | updates `prediction_leads.status` |

---

## 5b. No‑answer → paced retries → auto‑trash "Unreachable"

All no‑answer logic is server‑side in `POST /api/call-logs` (supabase/functions/api/index.ts) — event‑driven, no cron. On every logged no‑answer for a phone (matched by last‑8 digits):

- The **trailing consecutive no‑answer streak** is counted from `call_logs`.
- **Streak ≥ 9 → auto‑trash** the customer: `status='trashed'`, `trash_reason='not_reachable'` (shown as **Unreachable**), unassigned, dropped from every calling queue, and parked in the **Trash List** (/segments). This is the same reason an agent can now pick by hand.
- **Streak < 9 → paced retry** (humane, so we don't anger the customer):
  - **Max 2 calls per client per Europe/Sofia day.**
  - After the **1st** no‑answer today → resurfaces to the **same agent** in **~3.5 h** (`next_call_after` / `in_call_again_until`).
  - After the **2nd** no‑answer today → does **not** reappear today; resurfaces at **~09:00 Sofia the next morning**.
  - Repeats across days → ~4–5 calling days ≈ **8–9 attempts** → the 9th triggers the trash above.
- The client stays on the **same agent** the whole time (assignment is only cleared on trash). Constants (`UNREACHABLE_TRASH_STREAK=9`, `MAX_CALLS_PER_DAY=2`, `INTRA_DAY_COOLDOWN_MS≈3.5h`, `NEXT_DAY_RESUME_HOUR=9`) are hardcoded in the no‑answer block for now.
- The Call‑Again window (`call_again_since`, lazy `expire_call_again_window()`) was extended **3d → 6d** so it never cuts a schedule short before the 9‑attempt trash.

---

## 6. Notes: two distinct boards

- **Call note** (`CallNotesEditor`) — attached to *this call*, saved into `call_logs.notes`. Visible only during a call.
- **Customer note** (`CustomerNotesPanel`) — persistent "About this customer" on `customer_profiles.notes`,
  autosaves on blur via `POST /customer-profile/notes`. Survives across calls.

---

## 7. Recordings (real)

[../src/pages/RecordingsPage.tsx](../src/pages/RecordingsPage.tsx) lists **real call recordings**
(Asterisk MixMonitor WAVs) via `apiGetRecordings`, with playback through signed URLs from
`apiGetRecordingAudioUrl`. Each row matches a recording to its `call_logs` row (agent, customer,
dialed number, time); empty/failed files (~44 B) are hidden. Agents see their own; admin/manager see
all. PBX-side matching is handled by `elyon-rec.php` (see `docs/telephony/`).

---

## 8. The one rule

The `VoipContext` consumer surface (`startCall`, `hangup`, `endCall`, `confirmCall`, `state`, `call`,
`lastFinished`) is the stable contract between the Calls page and the softphone engine. It now has **two**
consumers: the Calls page UI, and `AuthContext` via `callStateBus` (§3b) — so changing the `state` machine
also changes the Assigner status tile and the Ops‑Center badge. Keep engine changes behind
`RealVoipEngine` and don't entangle them with Calls-page/queue/outcome refactors — keep diffs focused.
