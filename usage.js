// Plan minutes and Rod's 80% / 100% usage alerts.
// Minutes used = total answered seconds this billing period (signup-day cycle, customer's time zone),
// rounded up to the whole minute. Each alert level is emailed once per customer per month.
const { PLANS } = require("./customers");

const LEVELS = [100, 80];
const minutesUsed = seconds => Math.ceil((seconds || 0) / 60);
// Rod, 2026-10-30: calls are always answered; minutes over plan are billed at $0.60/min;
// the owner gets a heads-up at 80%; Rod suggests the next plan after two months over.
const OVERAGE_RATE = 0.6;
const overage = (used, included) => {
  const minutes = Math.max(0, used - included);
  return { minutes, dollars: Math.round(minutes * OVERAGE_RATE * 100) / 100 };
};

function ownerHeadsUp(customer, period, used, included) {
  const subject = `Heads-up: ${customer.business} has used ${used} of ${included} receptionist minutes this period`;
  const text = `Hi ${customer.ownerName},\n\nYour Get Jobs Booked receptionist has used ${used} of the ${included} minutes in your plan for this billing period (${Math.round((used / included) * 100)}%).\n\n` +
    `Nothing changes: every call keeps getting answered. If you go over, extra minutes are $${OVERAGE_RATE.toFixed(2)} each on your next bill. ` +
    `If you're regularly going over, a bigger plan is usually cheaper; just reply and we'll look at it together.\n\n— Get Jobs Booked`;
  return { subject, text, html: `<div style="font:15px/1.5 Arial,sans-serif;color:#1c2430;max-width:600px">${text.split("\n\n").map(p => `<p>${p.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]).replace(/\n/g, "<br>")}</p>`).join("")}</div>` };
}

function alertEmail(customer, month, level, used, included) {
  const subject = `${level >= 100 ? "⚠️ Over plan" : "Usage 80%"}: ${customer.business} at ${used}/${included} min (${month})`;
  const text = `${customer.business} (${customer.id}) has used ${used} of ${included} included minutes for ${month}` +
    ` on the $${customer.plan}/mo plan (${Math.round((used / included) * 100)}%).\n` +
    `Status: ${customer.status}. Owner: ${customer.ownerName} <${customer.ownerEmail}>.\n\n` +
    (level >= 100
      ? `Calls are still being answered. Overage so far: ${overage(used, included).minutes} min × $${OVERAGE_RATE.toFixed(2)} = $${overage(used, included).dollars.toFixed(2)}. If they were over last period too, suggest the next plan.`
      : "The owner was sent a heads-up. No action needed yet.");
  return { subject, text, html: `<pre style="font:14px/1.5 Arial,sans-serif;white-space:pre-wrap">${text.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c])}</pre>` };
}

// Call after each logged call. Sends at most one email (the highest new level reached).
async function checkUsage({ customer, month, callLog, mail, env = process.env, log = console }) {
  const included = PLANS[customer.plan];
  if (customer.demo || !included) return null;
  const used = minutesUsed((await callLog.monthStats(customer.id, month)).seconds);
  const reached = LEVELS.filter(l => used >= (included * l) / 100);
  if (!reached.length) return null;
  let sendLevel = null;
  for (const level of reached) if (await callLog.claimAlert(customer.id, month, level)) sendLevel ??= level;
  if (sendLevel == null) return null;
  if (sendLevel === 80 && customer.ownerEmail) {
    try { await mail(ownerHeadsUp(customer, month, used, included), { to: customer.ownerEmail, env, log }); }
    catch (e) { log.error?.(`[usage] owner heads-up failed: ${e.message}`); }
  }
  const to = env.USAGE_ALERT_TO;
  if (!to) { log.warn?.(`[usage] ${customer.id} reached ${sendLevel}% but USAGE_ALERT_TO is not set`); return { level: sendLevel, used, included, sent: false }; }
  const r = await mail(alertEmail(customer, month, sendLevel, used, included), { to, env, log });
  return { level: sendLevel, used, included, sent: !!r?.sent };
}

module.exports = { checkUsage, minutesUsed, alertEmail, ownerHeadsUp, overage, OVERAGE_RATE, LEVELS };
