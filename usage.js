// Plan minutes and Rod's 80% / 100% usage alerts.
// Minutes used = total answered seconds this calendar month (customer's time zone),
// rounded up to the whole minute. Each alert level is emailed once per customer per month.
const { PLANS } = require("./customers");

const LEVELS = [100, 80];
const minutesUsed = seconds => Math.ceil((seconds || 0) / 60);

function alertEmail(customer, month, level, used, included) {
  const subject = `${level >= 100 ? "⚠️ Over plan" : "Usage 80%"}: ${customer.business} at ${used}/${included} min (${month})`;
  const text = `${customer.business} (${customer.id}) has used ${used} of ${included} included minutes for ${month}` +
    ` on the $${customer.plan}/mo plan (${Math.round((used / included) * 100)}%).\n` +
    `Status: ${customer.status}. Owner: ${customer.ownerName} <${customer.ownerEmail}>.\n\n` +
    (level >= 100 ? "Calls are still being answered. Decide whether to contact the owner about an upgrade." : "No action needed yet; heads-up only.");
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
  const to = env.USAGE_ALERT_TO;
  if (!to) { log.warn?.(`[usage] ${customer.id} reached ${sendLevel}% but USAGE_ALERT_TO is not set`); return { level: sendLevel, used, included, sent: false }; }
  const r = await mail(alertEmail(customer, month, sendLevel, used, included), { to, env, log });
  return { level: sendLevel, used, included, sent: !!r?.sent };
}

module.exports = { checkUsage, minutesUsed, alertEmail, LEVELS };
