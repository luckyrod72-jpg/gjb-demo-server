# SIP review — 2026-10-30

Sources: https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech/sip and https://docs.x.ai/developers/rest-api-reference/inference/voice (retrieved 2026-10-30).

- PASS (code/doc comparison): WebSocket URL, `voice`, `instructions`, and `turn_detection: {type: "server_vad"}` match the published SIP example. No field-name migration needed.
- PASS (local tests): HMAC-SHA256 signing input `id.timestamp.rawBody` remains Standard Webhooks. Reject malformed timestamps and unknown signature versions; retain existing raw-key compatibility and whsec base64 support. SIP page names the three headers but does not spell out the algorithm; corroborating xAI Standard Webhooks reference: https://docs.x.ai/grok/automations/webhooks. Live SIP signature interoperability remains NOT TESTABLE without a registered number.
- Fixed: bounded join/session acknowledgement timeout; constructor, handshake, socket and session errors attempt one REST hangup with a five-second timeout. No greeting until `session.updated`. No automatic rejoin loops or transcript/error payload logging.
- Registration: `POST https://api.x.ai/v2/phone-numbers`, `origin: byo_trunk`, webhook object and carrier signaling CIDR allowlist. `node scripts/register-number.js` reads XAI_API_KEY, XAI_PHONE_NUMBER, XAI_WEBHOOK_URL, XAI_SIP_ALLOWED_ADDRESSES; optional XAI_NUMBER_NAME. One number per invocation, no retry. Prints only webhook signing secret to stdout. Run interactively into a secure secret manager; never redirect into repository files/CI logs. The docs expose a webhook response object but not its expanded fields; script accepts `webhook.signing_secret` or `webhook.secret`, otherwise fails without dumping the response. Confirm response shape securely before deployment.
- NOT RUN: registration, carrier routing, Render setup, live calls. Rod must configure the scoped key, HTTPS webhook, carrier's actual signaling CIDRs, returned signing secret, existing carrier number routing and Render env. No keys were requested or registrations attempted.

Local validation: `npm test` (six tests before caller changes). All network requests in new tests are injected mocks.
