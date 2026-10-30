# New customer setup — Get Jobs Booked

One customer = one GJB phone number we buy, pointed at xAI, plus one file in `customers/`.
Who does what this week: Claude-A / Rod own Telnyx, Twilio, xAI, Render and Stripe. Nothing here needs a key pasted into chat.

Time: about 30–45 minutes once the intake answers are in hand.

## 0. Before you start
- [ ] Owner has agreed to the founding-seat terms (see `FOUNDING-ONBOARDING-SOP.md`): no setup fee, two-week trial on their own line, monthly price stated, **no billing until they say OK**.
- [ ] Intake answers collected (the form's fields): services, hours, service area, emergency policy, what to say about scheduling, callback promises, optional prices. Only facts the owner confirmed. If they won't give prices, leave prices blank and the receptionist gives none.

## 1. Buy the number (Telnyx)
- [ ] Buy a local number in the customer's area code (Numbers → Search & Buy).
- [ ] Assign it to the existing FQDN connection **"GJB xAI"** (→ `sip.voice.x.ai:5060`, +E.164, US region). Same connection as Copperline; no new connection needed.
- [ ] Make sure the number has no call forwarding or "Forward Only" profile on it (Copperline's old one had to be removed before xAI answered).
- [ ] Note the number in E.164: `+1NXXNXXXXXX`.

## 2. Create the customer file
- [ ] Open `https://gjb-demo-server.onrender.com/admin/intake` (browser asks for a password: the `ADMIN_TOKEN` from Render; any username).
- [ ] Fill the form and submit. It checks everything and shows errors in plain words.
- [ ] If the server has no `CUSTOMERS_DIR` (current setup): copy the JSON it shows into `customers/<id>.json`, open a PR, merge. Render deploys it.
  If `CUSTOMERS_DIR` is set on a persistent disk: it's saved and live immediately.
- [ ] Check `/health`: the `customers` count went up by one.

## 3. Register the number with xAI
- [ ] Render → gjb-demo-server → Shell: `node scripts/reg.js <customer-id>` (the id shown on the form result).
- [ ] Copy the signing secret between the arrows and **append** it to `XAI_WEBHOOK_SECRETS` in Render → Environment, comma-separated. Don't replace the existing secrets or the demo lines stop answering. xAI shows each secret once.
- [ ] Save; Render restarts the service.

## 4. Test call (before the customer forwards anything)
Call the new GJB number from your cell and run these four:
- [ ] **Routine job:** "My kitchen sink is clogged." Agent collects name, number (reads it back), address, problem, urgency, time window.
- [ ] **Emergency:** trade-specific (burst pipe / gas smell / sparking panel / water through ceiling). Safety instruction comes first.
- [ ] **"Are you a real person?"** It says it's an AI receptionist.
- [ ] **"How much will it cost?"** Only the owner's service-call fee / starting-at ranges, or none if blank. Never a firm price, never a promised appointment time.
- [ ] Job-summary email arrives at the owner's email (or `SUMMARY_TO` while testing). Check spam.
- [ ] Render logs show `[call …] ended … job captured: true`.

## 5. Customer forwards their line
Recommend **forward on no answer / busy** so their office still picks up first, and GJB catches the rest. Codes vary by carrier and plan; confirm with the customer's carrier. Common US mobile codes (replace N with the 10-digit GJB number):

| Carrier | No answer | Busy | All calls | Cancel |
|---|---|---|---|---|
| Verizon | `*71N` (busy + no answer) | (same) | `*72N` | `*73` |
| AT&T | `**61*N#` | `**67*N#` | `**21*N#` | `##61#`, `##67#`, `##21#` |
| T-Mobile | `**61*1N#` | `**67*1N#` | `**21*1N#` | `##004#` (all) |

Landlines and business VoIP (RingCentral, Google Voice, Ooma, etc.): set it in their provider's portal.
- [ ] After they forward: call their **own** business number, let it ring out, confirm GJB answers with their business name.

## 6. Go-live record
- [ ] Customer file shows `status: "trial"` and `trialEndsAt` (14 days after go-live).
- [ ] Add a dated line to your Business HQ log: customer id, number, go-live date, trial end.
- [ ] Calendar reminder 3 days before `trialEndsAt` for the billing-OK conversation (see the SOP).

## Pausing or cancelling
- Pause: set `"status": "paused"` in their file (PR, merge). Calls to the GJB number are hung up, so tell the owner to **cancel forwarding first** or their callers get dropped.
- Cancel: owner removes forwarding → set paused → after 30 days, release the Telnyx number and remove the file (and its secret from `XAI_WEBHOOK_SECRETS`).
