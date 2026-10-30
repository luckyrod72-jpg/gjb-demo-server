// Time helpers that work in the customer's own time zone (no extra libraries).
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function localParts(date, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short",
  }).formatToParts(date).map(x => [x.type, x.value]));
  return { year: p.year, month: p.month, day: p.day, hhmm: `${p.hour}:${p.minute}`, weekday: p.weekday.slice(0, 3).toLowerCase() };
}

// "2026-11" — the calendar month the call belongs to, in the customer's time zone.
const monthKey = (date, timeZone) => { const p = localParts(date, timeZone); return `${p.year}-${p.month}`; };

// True when the moment falls outside every open range for that local weekday.
function isAfterHours(customer, date) {
  const p = localParts(date, customer.timezone);
  const ranges = customer.businessHours?.[DAYS.includes(p.weekday) ? p.weekday : ""] || [];
  return !ranges.some(r => { const [a, b] = r.split("-"); return p.hhmm >= a && p.hhmm < b; });
}

// Billing periods start on the customer's signup day each month (Rod, 2026-10-30).
// Anchor = local day-of-month of billingAnchor || createdAt; demos/legacy fall back to the 1st.
const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12
const pad = n => String(n).padStart(2, "0");
function anchorDay(customer) {
  const src = customer?.billingAnchor || customer?.createdAt;
  if (!src) return 1;
  const d = new Date(src);
  if (Number.isNaN(d.getTime())) return 1;
  return Number(localParts(d, customer.timezone || "America/Los_Angeles").day);
}
function periodStartFor(y, m, day, a) {
  const cd = Math.min(a, dim(y, m));
  if (day >= cd) return { y, m, d: cd };
  let py = y, pm = m - 1; if (pm === 0) { pm = 12; py -= 1; }
  return { y: py, m: pm, d: Math.min(a, dim(py, pm)) };
}
// "2026-10-15" = the billing period (start date) the moment belongs to, in the customer's time zone.
function periodKey(date, customer) {
  const p = localParts(date, customer.timezone);
  const s = periodStartFor(Number(p.year), Number(p.month), Number(p.day), anchorDay(customer));
  return `${s.y}-${pad(s.m)}-${pad(s.d)}`;
}
function previousPeriod(key, customer) {
  let [y, m] = key.split("-").map(Number);
  m -= 1; if (m === 0) { m = 12; y -= 1; }
  return `${y}-${pad(m)}-${pad(Math.min(anchorDay(customer), dim(y, m)))}`;
}
function nextPeriod(key, customer) {
  let [y, m] = key.split("-").map(Number);
  m += 1; if (m === 13) { m = 1; y += 1; }
  return `${y}-${pad(m)}-${pad(Math.min(anchorDay(customer), dim(y, m)))}`;
}
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "Oct 15 – Nov 14, 2026"
function periodLabel(key, customer) {
  const [y, m, d] = key.split("-").map(Number);
  const [ny, nm, nd] = nextPeriod(key, customer).split("-").map(Number);
  const end = new Date(Date.UTC(ny, nm - 1, nd) - 86400000);
  const ey = end.getUTCFullYear(), em = end.getUTCMonth() + 1, ed = end.getUTCDate();
  return `${MON[m - 1]} ${d}${y !== ey ? `, ${y}` : ""} – ${MON[em - 1]} ${ed}, ${ey}`;
}

module.exports = { localParts, monthKey, isAfterHours, anchorDay, periodKey, previousPeriod, nextPeriod, periodLabel };
