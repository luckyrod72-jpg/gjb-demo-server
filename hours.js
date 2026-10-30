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

module.exports = { localParts, monthKey, isAfterHours };
