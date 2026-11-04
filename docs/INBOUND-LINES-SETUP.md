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
