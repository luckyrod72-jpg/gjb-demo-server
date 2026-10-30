# Founding-customer onboarding SOP — Get Jobs Booked

For the first 10 founding seats. Terms (decided 2026-10-30): **no setup fee, two-week trial on the customer's own line, monthly price stated up front, and their explicit OK before any billing.** Plans: $199/mo (350 min), $399/mo (750 min), $699/mo (1,400 min).

Ground rules for everything we say and write:
- It **takes job requests**; the owner's team confirms times. Never say it books appointments.
- It identifies as an AI receptionist if asked. It never quotes firm prices or promises appointment times.
- What it tells callers comes only from facts the owner confirmed at intake.

## Day 0 — Offer
1. **Qualify** (2 minutes): roofing, HVAC, plumbing or electrical; misses calls (on jobs, after hours, weekends); has an email they read; can set call forwarding on their business line.
2. **Demo**: have them call the live demo line, (702) 602-8867, as if they were a homeowner. Then show them the job-request email it produced.
3. **Pick a plan to state up front.** Ask roughly how many calls they miss a month. Start most at $199 (350 min); the trial's call log shows real minutes before billing, and the plan can change at the billing-OK step.
4. **Send the offer in writing** and get a reply "yes" before setup:

> Subject: Your Get Jobs Booked founding seat
>
> Hi {first name},
>
> Here's what we agreed:
> - Founding seat: no setup fee.
> - Two-week free trial on your own business line, starting the day your calls forward to us.
> - After the trial, the plan is ${price}/month ({minutes} minutes of answered calls a month).
> - **We won't bill you anything unless you tell us OK at the end of the trial.** If it's not for you, you turn forwarding off and that's it.
>
> What it does: answers your calls in your business name, takes the caller's details and emails you each job request right after the call. Your team calls back to confirm times; it doesn't book appointments or quote firm prices.
>
> Reply "yes" and I'll book a 20-minute setup call.

5. Save their "yes" email (forward it to the Business HQ GJB folder or note it in your log).

## Day 1 — Intake call (20 minutes)
Walk the intake form (`/admin/intake`) together. Every answer becomes something the receptionist may say, so write only what they confirm.
- Business name exactly as they answer the phone; trade; service area (cities).
- Owner name and the email for job requests.
- Office hours by day, and their time zone.
- **Services they want calls for** (it offers only these).
- Service-call fee and any "starting at" prices they're happy to have shared. Blank is fine; then it gives no prices.
- Emergency policy: what counts, whether they do after-hours, any after-hours fee.
- What to say about scheduling, and the callback promises ("within 15 minutes for emergencies", "by 9am next business day").
- Gas and electric utility names (used in safety instructions).
- Common questions and their answers; anything they never do (e.g. no commercial work).
- Their phone carrier, for forwarding.

## Day 1–2 — Setup and go-live
Follow `docs/NEW-CUSTOMER-SETUP.md`: buy the number → point it at sip.voice.x.ai → customer file → register with xAI → four test calls → they forward their line → a test call to their real number.
- The trial starts the day forwarding goes live. Set `trialEndsAt` to go-live + 14 days.
- Send a short "you're live" email: the GJB number, how to turn forwarding off, and who to call with issues.

## Day 3 — First check-in (5 minutes)
- Look at the job-request emails so far. Anything wrong or missing (a service, a price, an answer)? Fix their customer file the same day.
- Confirm emails aren't landing in spam.

## Day 7 — Halfway check-in
- Month-to-date numbers: `/admin/report/<id>?month=YYYY-MM` (preview only, sends nothing). Share calls answered, job requests captured, after-hours calls.
- Note minutes used so far. If they're on pace to exceed the stated plan, say so now, not at billing.

## Day 11–12 — Billing OK (before the trial ends)
- Show the trial numbers and restate the plan and price in writing:

> Your trial ends {date}. In {N} days your receptionist answered {calls} calls and captured {jobs} job requests ({after_hours} after hours), using {minutes} minutes.
> Based on that, the ${price}/month plan ({included} minutes) fits. Do you want to keep it going? Reply OK and we'll send the payment link. If not, no charge: just turn off forwarding.

- **Only after an explicit OK**: Rod / Claude-A sends the Stripe link for that plan. Set `status` to `active` when payment goes through.
- No reply by the end date: send one reminder. Still nothing: ask them to turn off forwarding, then set `status: "paused"` (calls to a paused number are hung up, so forwarding must be off first).

## After conversion
- Monthly report goes out automatically on the 1st once `REPORTS_ENABLED=true`.
- Rod gets an email at 80% and 100% of plan minutes. At 100%, talk to the owner about the next plan; calls keep being answered meanwhile.
- Ask happy customers for a short testimonial or case study (the Master Index wants three trade case studies before the $1,500+ setup tier).

## Open questions for Rod (not decided anywhere yet)
- What happens past the plan's minutes: overage rate, automatic upgrade, or a conversation each time?
- Is billing a calendar month or the customer's signup date? (The code counts calendar months in the customer's time zone.)
- Minimum term or cancel anytime?
- Should real customers' greeting keep "this is the Get Jobs Booked AI receptionist", or say "{Business}'s AI receptionist"? (Today all lines use the Get Jobs Booked wording from `kb/shared.md`.)
