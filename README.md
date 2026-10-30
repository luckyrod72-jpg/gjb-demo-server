# GJB demo server

Steers the Grok voice agent for the four Get Jobs Booked demo lines. Audio flows carrier → xAI directly; this server only receives the incoming-call webhook and sends each call its instructions.

## Deploy on Render
1. New → Web Service → connect this repo. Build: `npm install`. Start: `npm start`. Instance type: **Starter** (always on; the free tier sleeps and misses calls).
2. Environment (Rod pastes these in Render; never in chat):
   - `XAI_API_KEY`
   - `XAI_WEBHOOK_SECRETS`: comma-separated, one webhook signing secret per registered number. xAI shows each secret ONCE, at registration.
   - optional `XAI_VOICE` (default `ara`)
   - Call summaries (email after every call): `RESEND_API_KEY`, `SUMMARY_FROM` (a sender on a Resend-verified domain), `SUMMARY_TO` (fallback recipient; a line's `ownerEmail` in `lines.js` wins)
3. Health check: `GET /health`. Webhook URL to give xAI: `https://<service>.onrender.com/webhooks/xai`

## Wire each number
1. Carrier side: point the number's SIP trunk at `sip:<number>@sip.voice.x.ai;transport=tls`.
   - Telnyx: Voice → SIP Trunking → FQDN connection to `sip.voice.x.ai`, E.164 format, assign the number.
   - Twilio: Voice → Elastic SIP Trunking → origination URI, attach the number.
2. xAI side: register the number as Direct SIP with `origin: "byo_trunk"`, the webhook URL above, and one SIP auth method (digest credentials or allowed_addresses). Save the signing secret into `XAI_WEBHOOK_SECRETS`.
   - TO CONFIRM: the exact registration endpoint and body (the docs list GET /v2/phone-numbers and DELETE /v2/phone-numbers/{id}; create is likely POST /v2/phone-numbers).
3. Numbers live in `customers/*.json` (one file per customer; the four demo lines are customers with `"demo": true`). Swapping a Twilio number for a Telnyx one is a one-line change to `phoneNumber`/`carrier` in that file. `lines.js` is now a read-only compatibility view.

## Customers
- One JSON file per customer in `customers/`. Field reference and a full example: `docs/customer.example.json` (fictional; not loaded). `npm test` validates every file in `customers/`.
- Optional `CUSTOMERS_DIR` env: an extra folder of customer files (for example a mounted disk). Bad files are logged and skipped, never crash the server.
- Instructions: demo customers get `kb/shared.md` + `kb/<trade>.md` exactly as before. Real customers keep the shared rules but get their own service area, hours, services, prices, emergency policy, scheduling, callback times and FAQs; demo prices, demo services and demo FAQs are never included. Only the trade file's EMERGENCIES (safety) section carries over, with the customer's utilities.
- `status: "paused"` stops answering that number (the call is hung up). `trial`/`active` answer normally.
- Register a customer's number: `node scripts/reg.js <customer-id>` (a trade name still means that trade's demo line).

## Open items to verify on the first live call
- Webhook signature scheme (implemented as Standard Webhooks HMAC-SHA256 `id.timestamp.body`; test in `test/`).
- Field names inside `session.update` (voice, instructions, turn_detection per xAI docs).
- Then run the 6-call test script from the knowledge-base doc on each line.

Knowledge bases: `kb/` (shared instructions + one file per trade). Prices and businesses are fictional demo values.
