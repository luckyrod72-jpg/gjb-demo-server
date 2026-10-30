# GJB demo server

Steers the Grok voice agent for the four Get Jobs Booked demo lines. Audio flows carrier → xAI directly; this server only receives the incoming-call webhook and sends each call its instructions.

## Deploy on Render
1. New → Web Service → connect this repo. Build: `npm install`. Start: `npm start`. Instance type: **Starter** (always on; the free tier sleeps and misses calls).
2. Environment (Rod pastes these in Render; never in chat):
   - `XAI_API_KEY`
   - `XAI_WEBHOOK_SECRETS`: comma-separated, one webhook signing secret per registered number. xAI shows each secret ONCE, at registration.
   - optional `XAI_VOICE` (default `ara`)
   - Call log: `DATABASE_URL` (Neon connection string). Usage alerts: `USAGE_ALERT_TO` (Rod's email). Admin: `ADMIN_TOKEN`, optional `CUSTOMERS_DIR`.
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
- New customer: `/admin/intake` (Basic auth; password = `ADMIN_TOKEN` env, any username; admin is off when unset). `/admin/customers` lists them. Step-by-step: `docs/NEW-CUSTOMER-SETUP.md`.

## Call log and plan minutes
- Every answered call is recorded (customer, start, end, duration, job captured, urgency, after-hours) in Postgres via `DATABASE_URL`. Tables are created automatically on start.
- Storage choice: a **free Neon project** (separate from TRS's). Free plan: 1 GB per project, 100 compute-hours per project per month, scales to zero after 5 minutes idle, no card, no time limit (neon.com/pricing, checked 2026-10-30). A call row is ~200 bytes, so 1 GB is millions of calls. Cost: $0 at our volume; Neon's pay-as-you-go plan if we ever outgrow it.
- Not chosen: a Render persistent disk. It works, but attaching one turns off zero-downtime deploys (each deploy drops the service for a few seconds, i.e. live calls) and adds a disk charge.
- Without `DATABASE_URL` the log is kept in memory and lost on restart (a warning is logged). Fine for the demo, not for customers.
- Minutes used = answered seconds this calendar month in the customer's time zone, rounded up to the whole minute. `USAGE_ALERT_TO` gets one email when a customer passes 80% and one at 100% of plan minutes (demo lines excluded). Calls keep being answered over the limit.
- Run the Postgres test locally: `TEST_DATABASE_URL=postgres://... npm test`.

## Open items to verify on the first live call
- Webhook signature scheme (implemented as Standard Webhooks HMAC-SHA256 `id.timestamp.body`; test in `test/`).
- Field names inside `session.update` (voice, instructions, turn_detection per xAI docs).
- Then run the 6-call test script from the knowledge-base doc on each line.

Knowledge bases: `kb/` (shared instructions + one file per trade). Prices and businesses are fictional demo values.
