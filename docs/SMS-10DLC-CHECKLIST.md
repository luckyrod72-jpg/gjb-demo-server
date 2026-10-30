# SMS (10DLC) registration checklist — Get Jobs Booked

Status: **not a launch blocker.** Job requests go out by email today. This is what it takes to add a text alert to the owner. Researched 2026-10-30; fees change, so re-check the Telnyx portal before paying anything. Nothing here has been submitted or bought.

## What we're registering (keep it narrow)
- **One GJB sending number** texts **business owners who are GJB customers** a short job alert after each call ("New job request: Dana R., water heater leak, 702-555-0199. Details in your email.").
- Not texting homeowners/callers. That's a different consent story (verbal consent on the call, stricter review) and isn't needed for launch.
- This means **one brand, one campaign, one number** for all customers, not one per customer. The per-customer voice numbers don't need SMS.

## Decision Rod has to make first
- [ ] **Which legal entity registers?** The brand needs a legal name and a **9-digit EIN that matches IRS records** exactly. Get Jobs Booked has no entity of its own (Master Index: entities only after revenue). Options:
  1. Register under an existing LLC that has an EIN (e.g. M&R Resellers LLC, TRS's seller of record), with "Get Jobs Booked" as the brand display name. The website and privacy policy must then name that LLC.
  2. Sole-proprietor registration (no EIN): $4 brand fee, $2/month campaign, but limited to one number and low throughput, with OTP identity verification. Workable for owner alerts at founding-seat volume, but it ties the program to Rod personally.
  3. Use a verified **toll-free** number instead of 10DLC. Since Feb 17, 2026 toll-free verification also requires an EIN (sole proprietors need manual ID verification), so it doesn't avoid the entity question.

## Before submitting (website + paperwork)
Reviews reject mismatches between legal name, EIN, website and email domain, and missing consent proof. Have these live first:
- [ ] getjobsbooked.co live (not "under construction"), with the legal business name in the footer.
- [ ] **Privacy Policy** page on getjobsbooked.co, owned by the registering brand, stating that **SMS opt-in data and consent are not shared with third parties** (covering sharing, not only selling).
- [ ] **Terms** page with an SMS section: brand name, what's sent (job alerts), frequency ("one text per call answered"), "Msg & data rates may apply", HELP for help, STOP to opt out, customer-care contact.
- [ ] Contact email **on the getjobsbooked.co domain**, shown on the site (e.g. support@getjobsbooked.co).
- [ ] **Owner opt-in** that's separate from email/phone consent: an **optional, unchecked** checkbox on the onboarding form or signed agreement, e.g.
  "☐ Text me job alerts from Get Jobs Booked at this mobile number. About one text per call answered. Msg & data rates may apply. Reply HELP for help, STOP to cancel. Terms: getjobsbooked.co/terms · Privacy: getjobsbooked.co/privacy"
  Keep a consent log (who, number, timestamp, exact wording). A screenshot of the form goes in the campaign's message-flow field.

## Telnyx steps
1. [ ] **Messaging profile** for the GJB alert number (Messaging → Profiles). Buy or pick one local number and attach it. Don't use a customer's voice number.
2. [ ] **Brand** (Messaging → 10DLC → Brands): entity type, legal name, EIN, display name "Get Jobs Booked", address, phone, email, website, vertical. Brand creation is instant. **$4.50 one-time** ($4 for sole proprietor).
3. [ ] **Vetting** (optional, Aegis "Standard"): about **$41.50**, results in 1–7 business days. Raises throughput; not needed at founding-seat volume. Skip unless a campaign gets throttled.
4. [ ] **Campaign**: use case **Account Notification** (or Customer Care). Low Volume Mixed is cheaper if it's allowed for our message mix.
   - Description (40+ chars): "Get Jobs Booked sends job-request alerts to business owners who use our AI phone receptionist. Each text summarizes a call our receptionist answered for their business."
   - Message flow (40+ chars): where and how the owner opts in (the checkbox above), with the Terms and Privacy URLs.
   - 2–3 sample messages, under 160 chars, brand name in each, opt-out in at least one:
     - "Get Jobs Booked: New job request from Dana R., water heater leak, callback 702-555-0199. Full details in your email. Reply STOP to opt out."
     - "Get Jobs Booked: EMERGENCY call from Al M., gas smell, callback 702-555-0142. Check your email now."
   - Keywords: opt-in START, opt-out STOP, help HELP, with these replies:
     - Opt-in confirmation: "Get Jobs Booked: You're signed up for job alerts. About 1 msg per call answered. Msg & data rates may apply. Reply HELP for help, STOP to cancel."
     - HELP: "Get Jobs Booked job alerts. Help: support@getjobsbooked.co. Reply STOP to cancel."
     - STOP: "Get Jobs Booked: You're unsubscribed and won't get more texts."
   - Fees: **$15** campaign verification, charged when Telnyx sends it to carriers (each resubmission is another $15). Monthly campaign fee about **$10** (standard), **$1.50** (low volume mixed) or **$2** (sole proprietor); often billed 3 months up front. Some sources list a **$50 T-Mobile activation fee** per new campaign; confirm in the portal before submitting.
5. [ ] **Assign the number** to the approved campaign. Usually active within minutes.

## How long
- Brand: instant (vetting, if used: 1–7 business days).
- Campaign: Telnyx review first, then carrier review, typically **~72 business hours** after Telnyx sends it on. Plan on **1–3 weeks** end to end; a rejection restarts the clock and costs another $15.

## Running cost (rough, at founding-seat volume)
One-time ≈ $4.50 + $15 (+ $41.50 if vetted, + $50 if T-Mobile activation applies). Monthly ≈ $1.50–$10 campaign + number rental. Per text ≈ Telnyx's rate (from $0.004/segment) + carrier fees (~$0.0025–$0.004/segment). 10 customers × 100 calls/month = 1,000 texts ≈ under $10/month.

## Code side (after approval; not built yet)
- Add `TELNYX_API_KEY`, `SMS_FROM` env vars; send a ≤160-char alert from `summary.js` alongside the email, only to owners with recorded SMS consent (`ownerMobile` + `smsConsentAt` on the customer file).
- Handle STOP/HELP replies (Telnyx can auto-handle keyword responses at the profile level).

## Sources
- Telnyx 10DLC quickstart: https://developers.telnyx.com/docs/messaging/10dlc/quickstart/index
- Telnyx 10DLC campaign compliance guide (fees $4.50 / $15, ~72 business hours carrier review): https://support.telnyx.com/en/articles/16256133-10dlc-campaign-compliance-guide
- Telnyx toll-free verification changes (EIN required from Feb 17, 2026): https://support.telnyx.com/en/articles/13765655-compliance-catch-up-why-toll-free-verification-now-mirrors-10dlc
- Fee stack, TCR rev. 1/19/26 (vetting, monthly campaign fees, carrier per-message fees, T-Mobile activation): https://a2p.guide/texting/10dlc/fees/
- Rejection reasons and website/opt-in requirements: https://textbolt.com/blog/10dlc-compliance/
