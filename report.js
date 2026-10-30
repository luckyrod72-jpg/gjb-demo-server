// Monthly usage email to each customer: calls answered, job requests captured,
// emergencies, after-hours calls, minutes used. Sent once per customer per month.
//
// Off unless REPORTS_ENABLED=true. When on, the server checks hourly and sends last
// previous billing period's report on the first day of the new period (signup-day cycle), from 8am in the customer's own time zone. Demo lines and
// paused customers are skipped. `node scripts/monthly-report.js` previews or sends by hand.
const { PLANS } = require("./customers");
const { localParts, periodKey, previousPeriod, periodLabel } = require("./hours");
const { minutesUsed, overage, OVERAGE_RATE } = require("./usage");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const monthName = m => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function previousMonth(ym) {
  let [y, m] = ym.split("-").map(Number);
  m -= 1; if (m === 0) { m = 12; y -= 1; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

function buildReport(customer, month, stats) {
  const used = minutesUsed(stats.seconds), included = PLANS[customer.plan];
  const name = /^\d{4}-\d{2}-\d{2}$/.test(month) ? periodLabel(month, customer) : monthName(month);
  const over = included ? overage(used, included) : { minutes: 0, dollars: 0 };
  const rows = [
    ["Calls answered", stats.calls],
    ["Job requests captured", stats.jobs],
    ["Emergencies flagged", stats.emergencies],
    ["After-hours calls", stats.afterHours],
    ["Job requests captured after hours", stats.afterHoursJobs],
    ["Minutes used", included ? `${used} of ${included}` : used],
    ...(over.minutes ? [["Minutes over plan", `${over.minutes} × $${OVERAGE_RATE.toFixed(2)} = $${over.dollars.toFixed(2)}`]] : []),
  ];
  const lead = stats.calls
    ? `Your Get Jobs Booked receptionist answered ${plural(stats.calls, "call")} for ${customer.business} in ${name} and captured ${plural(stats.jobs, "job request")}` +
      (stats.afterHours ? `, including ${plural(stats.afterHours, "call")} that came in after hours.` : ".")
    : `No calls reached your Get Jobs Booked line in ${name}. If you expected some, check that call forwarding is still on.`;
  const note = "Each job request was emailed to you right after the call. Your team confirms times with the customer; the receptionist doesn't book appointments.";
  const subject = `${customer.business}: your call report (${name})`;
  const text = `Hi ${customer.ownerName},\n\n${lead}\n\n${rows.map(([l, v]) => `${l}: ${v}`).join("\n")}\n\n${note}\n\nQuestions? Just reply to this email.\n— Get Jobs Booked`;
  const html = `<div style="font:15px/1.5 Arial,sans-serif;color:#1c2430;max-width:600px">
<h2 style="margin:0 0 4px">${esc(name)} call report</h2><p style="margin:0 0 16px;color:#555">${esc(customer.business)}</p>
<p>Hi ${esc(customer.ownerName)},</p><p>${esc(lead)}</p>
<table style="border-collapse:collapse;width:100%">${rows.map(([l, v]) => `<tr><td style="padding:8px 10px;border-bottom:1px solid #eee;color:#555">${esc(l)}</td><td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right"><strong>${esc(v)}</strong></td></tr>`).join("")}</table>
<p style="color:#555">${esc(note)}</p><p>Questions? Just reply to this email.<br>— Get Jobs Booked</p></div>`;
  return { subject, text, html };
}

// Sends any reports that are due now. Safe to call repeatedly (each report is claimed once).
async function sendDueReports({ customers, callLog, mail, env = process.env, now = new Date(), log = console, force = false }) {
  if (env.REPORTS_ENABLED !== "true" && !force) return [];
  const out = [];
  for (const c of customers.all()) {
    if (c.demo || c.status === "paused" || !c.ownerEmail) continue;
    const p = localParts(now, c.timezone);
    // Due on the first day of each new billing period (signup-day cycle), from 8am local.
    const today = `${p.year}-${p.month}-${p.day}`;
    const current = periodKey(now, c);
    if (!force && (current !== today || p.hhmm < "08:00")) continue;
    const month = previousPeriod(current, c);
    if (!(await callLog.claimReport(c.id, month))) continue;
    try {
      const r = await mail(buildReport(c, month, await callLog.monthStats(c.id, month)), { to: c.ownerEmail, env, log });
      if (!r?.sent) { await callLog.releaseReport(c.id, month); log.warn?.(`[report] ${c.id} ${month} not sent; will retry next hour`); continue; }
      out.push({ id: c.id, month });
    } catch (e) { await callLog.releaseReport(c.id, month); log.error?.(`[report] ${c.id} ${month} failed: ${e.message}`); }
  }
  return out;
}

module.exports = { buildReport, sendDueReports, previousMonth };
