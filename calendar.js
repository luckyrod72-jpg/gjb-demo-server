// Callback booking for Roderick's inbound lines. Google Calendar via a service account
// (no extra libraries). Everything is computed in Pacific time; the calendar's own time
// zone setting doesn't matter because each event states America/Los_Angeles explicitly.
// Rules (Rod, 2026-10-30/31): 15-minute slots; Mon-Fri 8:00-16:00, Sat 8:00-12:00 PT;
// earliest slot is the next day we're open; Saturday is offered as a choice.
const crypto = require("crypto");

const PT = "America/Los_Angeles";
const SLOT_MIN = 15;
const HOURS = { 1: [8, 16], 2: [8, 16], 3: [8, 16], 4: [8, 16], 5: [8, 16], 6: [8, 12] }; // weekday (0=Sun) -> [open, close]
const HORIZON_DAYS = 14;
const ZONES = {
  "America/New_York": "Eastern", "America/Chicago": "Central", "America/Denver": "Mountain", "America/Phoenix": "Arizona",
  "America/Los_Angeles": "Pacific", "America/Anchorage": "Alaska", "Pacific/Honolulu": "Hawaii",
};
const pad = n => String(n).padStart(2, "0");

function ptParts(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: PT, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(date).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}:${p.minute}` };
}
const weekdayOf = ymd => new Date(`${ymd}T12:00:00Z`).getUTCDay();
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// "2026-11-05T08:00" Pacific -> Date. Handles daylight saving by correcting against Intl.
function ptToDate(local) {
  const guess = new Date(`${local}:00Z`);
  const p = ptParts(guess);
  const shown = Date.parse(`${p.date}T${p.hhmm}:00Z`);
  const first = new Date(guess.getTime() + (guess.getTime() - shown));
  const q = ptParts(first);
  return new Date(first.getTime() + (guess.getTime() - Date.parse(`${q.date}T${q.hhmm}:00Z`)));
}

function daySlots(ymd) {
  const h = HOURS[weekdayOf(ymd)];
  if (!h) return [];
  const out = [];
  for (let m = h[0] * 60; m + SLOT_MIN <= h[1] * 60; m += SLOT_MIN) out.push(`${ymd}T${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  return out;
}

function earliestDay(now) {
  let d = addDays(ptParts(now).date, 1);
  while (!HOURS[weekdayOf(d)]) d = addDays(d, 1);
  return d;
}

// Returns null when the slot is fine, or the reason it isn't.
function slotProblem(local, now) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local || "")) return "not a valid time";
  const day = local.slice(0, 10);
  if (!daySlots(day).includes(local)) return "outside Roderick's callback hours";
  if (day < earliestDay(now)) return "the earliest callback is the next day he's open";
  if (day > addDays(ptParts(now).date, HORIZON_DAYS)) return "too far ahead to book";
  return null;
}

function say(local, zone) {
  const z = ZONES[zone] ? zone : PT;
  const f = new Intl.DateTimeFormat("en-US", { timeZone: z, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `${f.format(ptToDate(local)).replace(" at ", ", ")} ${ZONES[z]}`;
}

function createCalendar({ env = process.env, request = fetch, now = () => new Date(), log = console } = {}) {
  const calendarId = env.GOOGLE_CALENDAR_ID || "rod@leadsweep.co";
  let token = null, tokenExp = 0, queue = Promise.resolve();
  const configured = () => !!env.GOOGLE_SERVICE_ACCOUNT_JSON;

  async function accessToken() {
    if (token && Date.now() < tokenExp - 60000) return token;
    const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const iat = Math.floor(Date.now() / 1000);
    const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/calendar", aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 })}`;
    const sig = crypto.sign("RSA-SHA256", Buffer.from(unsigned), sa.private_key).toString("base64url");
    const r = await request("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }).toString(), signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`Google token failed: HTTP ${r.status}`);
    const j = await r.json();
    token = j.access_token; tokenExp = Date.now() + (j.expires_in || 3600) * 1000;
    return token;
  }
  async function api(method, path, body) {
    const r = await request(`https://www.googleapis.com/calendar/v3${path}`, { method, headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`Google Calendar ${method} failed: HTTP ${r.status}`);
    return r.json();
  }
  async function busyBetween(from, to) {
    const j = await api("POST", "/freeBusy", { timeMin: from.toISOString(), timeMax: to.toISOString(), timeZone: PT, items: [{ id: calendarId }] });
    const cal = j.calendars?.[calendarId];
    if (!cal || cal.errors?.length) throw new Error("Google Calendar: no free/busy access to the calendar");
    return (cal.busy || []).map(b => [Date.parse(b.start), Date.parse(b.end)]);
  }
  const freeSlots = (slots, busy) => slots.filter(s => {
    const a = ptToDate(s).getTime(), b = a + SLOT_MIN * 60000;
    return !busy.some(([x, y]) => a < y && x < b);
  });

  // Up to 3 open days (or one asked-for day), a few free times each, worded for the caller's zone.
  async function availability({ date, zone, perDay = 4 } = {}) {
    const t = now();
    let days = [];
    if (date) days = [date];
    else { let d = earliestDay(t); while (days.length < 3) { if (HOURS[weekdayOf(d)]) days.push(d); d = addDays(d, 1); } }
    const slots = days.flatMap(daySlots).filter(s => !slotProblem(s, t));
    if (!slots.length) return [];
    const busy = await busyBetween(ptToDate(slots[0]), new Date(ptToDate(slots.at(-1)).getTime() + SLOT_MIN * 60000));
    const free = freeSlots(slots, busy);
    return days.map(day => ({ date: day, saturday: weekdayOf(day) === 6, times: free.filter(s => s.startsWith(day)).slice(0, perDay).map(s => ({ start: s, say: say(s, zone) })) })).filter(d => d.times.length);
  }

  // Bookings run one at a time so two callers can't both pass the free/busy check for one slot.
  function book({ start, zone, title, description, replaceEventId }) {
    const run = async () => {
      const problem = slotProblem(start, now());
      if (problem) return { booked: false, reason: problem };
      const from = ptToDate(start), to = new Date(from.getTime() + SLOT_MIN * 60000);
      if (!freeSlots([start], await busyBetween(from, to)).length) return { booked: false, reason: "that time was just taken" };
      const body = { summary: title, description, start: { dateTime: `${start}:00`, timeZone: PT }, end: { dateTime: `${ptParts(to).date}T${ptParts(to).hhmm}:00`, timeZone: PT } };
      const cal = encodeURIComponent(calendarId);
      const ev = replaceEventId ? await api("PATCH", `/calendars/${cal}/events/${encodeURIComponent(replaceEventId)}`, body) : await api("POST", `/calendars/${cal}/events`, body);
      return { booked: true, eventId: ev.id, start, say: say(start, zone) };
    };
    const result = queue.then(run, run);
    queue = result.catch(() => {});
    return result;
  }
  return { configured, availability, book };
}

module.exports = { createCalendar, slotProblem, daySlots, earliestDay, ptToDate, ptParts, say, ZONES, PT };
