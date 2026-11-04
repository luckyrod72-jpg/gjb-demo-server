# Inbound lines setup (TRS + GJB)

TRS Inbound +1 702-268-2097 and GJB Inbound +1 702-237-2415. Ring Roderick's cell for 18 seconds, then the virtual receptionist. Everything is off until the steps below are done; demo lines aren't affected.

## 1. Render environment
- `INBOUND_TEXML_TOKEN`: a long random string (protects the call-flow URLs). Without it the routes don't exist.
- `INBOUND_FORWARD_TO`: Roderick's cell in E.164. Unset = calls go straight to the receptionist, so this can wait.
- `GOOGLE_SERVICE_ACCOUNT_JSON`: the service account key, whole file on one line. Unset = the receptionist takes details and says Roderick will reach out.
- `GOOGLE_CALENDAR_ID`: optional, defaults to rod@leadsweep.co.
- `SUMMARY_TO` must be set; these lines have no ownerEmail.

## 2. Google
Google Cloud: create a project, enable the Calendar API, create a service account and a JSON key. In Google Calendar share the rod@leadsweep.co calendar with the service account's email, "Make changes to events". If sharing outside the organization is blocked, allow it in Workspace admin for this calendar.

## 3. xAI
In the Render shell: `node scripts/reg.js trs` and `node scripts/reg.js gjb`. Add each secret to `XAI_WEBHOOK_SECRETS`. They're shown once.

## 4. Telnyx
Create a TeXML Application with voice URL `https://gjb-demo-server.onrender.com/telnyx/<INBOUND_TEXML_TOKEN>/inbound` (POST) and an outbound voice profile so it can call the cell. Assign both numbers to it. Don't put them on the GJB xAI SIP connection.

## 5. Test before relying on it (not yet proven on a live call)
1. Call with INBOUND_FORWARD_TO unset: the right greeting answers. If it fails at the SIP leg, check xAI's allowed addresses: `reg.js` allows only two Telnyx signaling IPs, and TeXML-originated SIP may leave from others.
2. Set the cell. Answer and press 1: you're connected to the caller.
3. Don't answer: receptionist after 18 seconds. Answer and don't press: receptionist. Phone off: receptionist, not voicemail.
4. Book a callback from an Eastern number: confirm the time read back, the Pacific time on the calendar, the title and the summary email.
5. Friday test: Saturday is offered alongside Monday.

Holidays aren't built in. Block them on the calendar and those slots disappear.

## 6. Launch decisions and accepted limits (Rod, PR #17)

- Keep the 14-day booking horizon. Slots beyond 14 days are not offered or booked.
- Keep the GJB setup-fee and guarantee wording as written in `kb/sales-gjb.md`. Questions about setup fees or guarantees go to Roderick on a callback; the receptionist must not invent additional terms.
- Rod accepts the following limits for launch. No database or other durable storage is being added:
  - **Booking coordination is local to one process.** Two processes, including overlapping deploys, can both pass the free/busy check and book the same slot. The check and calendar write are not an atomic reservation; an external calendar edit between them can also create an overlap. Restarting loses the in-memory queue, and uncertain writes require calendar verification before rebooking.
  - **Press-1 acceptance is lost on restart.** Acceptance lives only in the process that received the digit. If that process restarts, or another process receives the completion callback, an accepted call can be sent to the receptionist. Within the same process, retried after-dial callbacks retain acceptance until the original two-hour TTL expires; reading it does not extend that TTL.
  - **Caller details can be lost if the process dies mid-call.** Caller details and booking state remain in memory until the after-call summary is sent. Abrupt termination can lose those details and the summary, even if a Google event was already created. Waiting for pending tools protects an ordinary hangup, not process death.

These accepted limits do not establish that the live call flow works. The tests in section 5, including SIP ingress, press-1 screening, voicemail/no-answer/phone-off fallback, calendar access and email delivery, still need Rod's approval before execution. Deployment and service-setting changes also require his approval.
