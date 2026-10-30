# Get Jobs Booked off-hours caller (draft, offline validated only)

No calls have been placed. Dry-run is the default (the explicit `--dry-run` flag is also accepted); calling code is unreachable unless `--execute` plus all three validation gates are configured. Do not set those gates from this PR alone.

## Run without dialing

From the repository root:

```sh
node caller/index.js caller/example.csv --dry-run --days=7 --calls-per-hour=4
node --test caller/*.test.js
npm test # existing demo-server tests
(cd caller && npm test) # caller suite
```

CSV columns: `business,phone,time_zone,posted_hours`. Phone is E.164, zone is an explicit IANA name. Hours are `24/7`, blank, or JSON such as `{"mon":["08:00-19:00"],"tue":["08:00-17:00"],"sun":[]}`. Quote JSON per normal CSV escaping; see example.csv. Multiple intervals and overnight intervals work. Omitted weekdays in a supplied schedule mean closed. CSV posted_hours remains the strict caller format. For Google Maps / Apify imports, use the normalizer described below; unparseable source hours become the blank-hours default.

Local calling window is [08:00,21:00), including weekends, intersected with closed hours. A 19:00 close becomes eligible at exactly 19:00. Blank hours use the approved default: weekends only within the calling window (never weekday evenings). 24/7 listings get one attempt within the window. Phoenix uses its IANA fixed offset. DST zones use actual local wall-clock time.

The scheduler spaces attempts at least 60/calls-per-hour minutes apart and distributes them over the least loaded days within the next seven days. Default 4/hour, configurable 1–60. Ineligible businesses are reported as unscheduled. Execution rechecks eligibility at dial time; missed windows are skipped, never caught up outside a permitted window.

## Service / adapter

Implemented carrier: **Twilio**, selected by `CALLER_CARRIER=twilio`; other values fail. Uses asynchronous carrier `Enable` AMD so the machine decision arrives at `machine_start`, rather than waiting for the greeting to end. Initial TwiML contains only Pause 20 seconds and Hangup, with no transcription. Only the first machine AMD decision starts inbound-only live transcription through the Calls Transcriptions REST subresource. Human, fax, unknown and unexpected results hang up without ever requesting transcription; repeated/late AMD callbacks cannot reverse that decision or start another stream. Transcription startup errors hang up without retry. REST `TimeLimit=20` independently caps connected call time; ringing timeout is 20 seconds. There is no Say, Play, Record, Gather, agent audio or message. No recording is requested. Person/fax/unknown AMD triggers REST hangup immediately upon detection; any recognized voicemail/AI classification also hangs up after dropping all transcript references. Callback text fields are removed before classification, and parsed text references are cleared immediately afterward, before any asynchronous hangup. No transcript is retained in active state, files or logs. No IntelligenceService persistence or raw provider-data callback is requested. Provider detection/HTTP latency means this is not literally instantaneous at answer.

Required env for a separately approved controlled test: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, CALLER_ID (a real account-authorized callback number), CALLER_WEBHOOK_URL (public HTTPS base path), CALLER_STATE_DIR (durable directory), CALLER_PORT (default 3001), CALLER_CALLS_PER_HOUR (default 4). Service binds loopback; a separately configured TLS reverse proxy must forward the public webhook path. It verifies Twilio's request signature using the configured external origin, not untrusted forwarded headers. No account settings are changed by starting the service. The service must stay running while callbacks arrive; SIGTERM stops scheduling and attempts to hang up active calls.

Execution additionally requires CALLER_ENABLE_LIVE=true, CALLER_PROVIDER_RETENTION_VERIFIED=true and CALLER_CLASSIFICATION_VALIDATED=true. **These were not set.** Provider call/transcription logging and retention must be verified in the carrier account before enabling, because this code cannot guarantee the carrier's internal retention configuration. No secret values belong in files or logs.

## Persistence and one-attempt guarantee

Normalized-business-name SHA-256 identity deduplicates the same business across alternate numbers and reruns; the planner also deduplicates repeated phone numbers. Use consistent business names across imports. An atomic empty .claim file is written before the carrier request. All instances must share one durable directory; do not delete claims to retry. A network timeout may mean a submitted call: keep the claim, never auto-redial. This implements at most one attempt even across crashes, favoring a skipped business over duplicate dialing. Callback call IDs, business names, transient speech and active classification stay in RAM. Carrier SID mismatches are rejected.

The final .json file has only `outcome`, `duration` (seconds from carrier CallDuration), `timestamp` (UTC finalization). File creation is exclusive and callbacks are idempotent. Accepted values are exactly:

- Person answered
- AI or answering service answered
- Generic voicemail
- Custom voicemail
- Voicemail full
- No answer

No transcript, audio, webhook payload, business name or phone is written to results. Dry-run outputs the proposed schedule to stdout only; it creates no state and instantiates no carrier. Treat the input CSV and any redirected schedule as operational personal data.

## Material gaps: not ready for live calling

1. Carrier AMD is probabilistic and has no reliable “another AI” or “generic vs custom” result. In-memory phrase classification is a baseline heuristic, not validated accuracy. A machine greeting without recognized text stays unresolved rather than guessing generic/custom. A generic greeting such as “How can I help” is not treated as proof of AI. This needs a controlled, consented test matrix and a stronger validated classifier before lifting the gate.
2. `unknown` AMD, or a machine result without usable greeting text, on an answered call cannot truthfully map to one of the six approved outcomes. The service hangs up and retains the claim for review without fabricating a result. Thus the strict **exactly one outcome for every attempted call is not yet satisfied** for unknown/ambiguous cases. No answer is used only for carrier busy/no-answer/failed/canceled status. The six-label policy needs an explicit uncertain-case rule or improved classifier; Rod's asleep, so none was invented.
3. A process restart loses active in-memory classification and SID state. Durable claims still prevent a second call, but callback reconciliation/results for interrupted calls require a recovery design that preserves the minimal-storage rule. Network submission ambiguity likewise may leave a claim without an outcome. No silent automatic retries.
4. No Telnyx adapter is implemented. Twilio meets the requested either-carrier choice; selecting Telnyx fails explicitly.
5. Hard hangup is carrier-enforced at 20 connected seconds. Live validation must confirm Twilio account supports the configured features and does not add announcements or retain recordings/transcripts. This has not been tested against an account.

These gaps are why the service is a draft with live gates off, not a claim of completed live acceptance. Schedules, dry run, silent request construction, six known outcomes, deduplication and local state handling are tested without network calls.

References checked 2026-10-30:
- https://www.twilio.com/docs/voice/answering-machine-detection
- https://www.twilio.com/docs/voice/answering-machine-detection-faq-best-practices
- https://www.twilio.com/docs/voice/twiml/transcription
- https://www.twilio.com/docs/voice/api/call-resource

## Validation completed

2026-10-30: 29 caller tests passed; existing root npm test passed. Fictional three-business dry run scheduled three calls across the horizon, zero unscheduled, without initializing a carrier or writing state. All carrier requests in tests were injected mocks.

## Google Maps / Apify hours normalization

`require('./caller/normalize-hours').normalizeHours(openingHours)` returns the caller's JSON weekday-interval string, `24/7`, or an empty string. Supported inputs include:

- Google strings: `["Monday: 7 AM to 6 PM", "Sunday: Closed"]`, including Unicode dash/space variants.
- Apify objects: `[{"day":"Monday","hours":"7 AM to 6 PM"},{"day":"Sunday","hours":"Closed"}]`.
- Google wrappers `weekdayDescriptions` / `weekday_text`, an `openingHours` wrapper, day-to-hours maps, newline-separated weekday strings, or JSON-serialized versions.
- Split shifts, overnight ranges, 12-hour AM/PM, unambiguous 24-hour HH:MM, noon and midnight. A per-day Open 24 hours remains a day-specific open interval; only seven such days become the special 24/7 exception.

Missing/malformed/ambiguous entries or duplicate weekdays discard the entire source schedule to blank hours (weekends only), never a partial parse. Do not infer AM/PM from an ambiguous range. Omitted weekdays in an otherwise valid supplied schedule retain the caller's existing meaning: closed. A standalone Closed without a weekday cannot establish a schedule and falls back to blank hours.

To normalize and schedule an array of imports in one dry run:

```sh
node caller/index.js input.json --opening-hours-json
```

Each JSON row needs `business`, E.164 `phone`, `time_zone`, and `openingHours`. No `--execute` means dry-run even when live-gate environment variables are present; contradictory `--dry-run --execute` is rejected. The command creates no state and does not initialize the carrier. Normalized source hours are included in the proposed schedule on stdout only.

REST transcription source checked 2026-10-30: https://www.twilio.com/docs/voice/api/realtime-transcription-resource . No live transcription or call was started for this update. Existing uncertain-classification and restart-recovery gaps remain open.
