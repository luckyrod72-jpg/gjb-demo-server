# GJB demo server

Steers the Grok voice agent for the four Get Jobs Booked demo lines. Audio flows carrier → xAI directly; this server only receives the incoming-call webhook and sends each call its instructions.

## Deploy on Render
1. New → Web Service → connect this repo. Build: `npm install`. Start: `npm start`. Instance type: **Starter** (always on; the free tier sleeps and misses calls).
2. Environment (Rod pastes these in Render; never in chat):
   - `XAI_API_KEY`
   - `XAI_WEBHOOK_SECRETS`: comma-separated, one webhook signing secret per registered number. xAI shows each secret ONCE, at registration.
   - optional `XAI_VOICE` (default `eve`)
3. Health check: `GET /health`. Webhook URL to give xAI: `https://<service>.onrender.com/webhooks/xai`

## Wire each number
1. Carrier side: point the number's SIP trunk at `sip:<number>@sip.voice.x.ai;transport=tls`.
   - Telnyx: Voice → SIP Trunking → FQDN connection to `sip.voice.x.ai`, E.164 format, assign the number.
   - Twilio: Voice → Elastic SIP Trunking → origination URI, attach the number.
2. xAI side: register the number as Direct SIP with `origin: "byo_trunk"`, the webhook URL above, and one SIP auth method (digest credentials or allowed_addresses). Save the signing secret into `XAI_WEBHOOK_SECRETS`.
   - TO CONFIRM: the exact registration endpoint and body (the docs list GET /v2/phone-numbers and DELETE /v2/phone-numbers/{id}; create is likely POST /v2/phone-numbers).
3. Numbers → trades live in `lines.js`. Swapping a Twilio number for a Telnyx one is a one-line change.

## Open items to verify on the first live call
- Webhook signature scheme (implemented as Standard Webhooks HMAC-SHA256 `id.timestamp.body`; test in `test/`).
- Field names inside `session.update` (voice, instructions, turn_detection per xAI docs).
- Then run the 6-call test script from the knowledge-base doc on each line.

Knowledge bases: `kb/` (shared instructions + one file per trade). Prices and businesses are fictional demo values.
