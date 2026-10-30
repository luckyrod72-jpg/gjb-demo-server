// Customer store: one JSON file per customer in customers/ (checked into the repo),
// plus an optional extra directory from CUSTOMERS_DIR (e.g. a mounted disk) for
// customers created through the admin intake form. Each customer owns one GJB
// phone number; incoming calls are routed by the dialed number.
const fs = require("fs");
const path = require("path");

const TRADES = ["plumbing", "hvac", "roofing", "electrical"];
const STATUSES = ["trial", "active", "paused"];
const PLANS = { 199: 350, 399: 750, 699: 1400 }; // monthly price -> included minutes
const CARRIERS = ["telnyx", "twilio"];
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const E164 = /^\+[1-9]\d{7,14}$/;
const ID = /^[a-z0-9][a-z0-9-]{1,62}$/;
const RANGE = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-4]):[0-5]\d$/;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

const isStr = v => typeof v === "string" && v.trim().length > 0;
const strList = v => Array.isArray(v) && v.every(isStr);

// Returns a list of human-readable problems; empty list means valid.
function validateCustomer(c) {
  const errs = [];
  if (!c || typeof c !== "object" || Array.isArray(c)) return ["customer must be an object"];
  if (!ID.test(c.id || "")) errs.push("id: lowercase letters, digits and dashes, 2-63 chars");
  if (!isStr(c.business)) errs.push("business: required");
  if (!TRADES.includes(c.trade)) errs.push(`trade: one of ${TRADES.join(", ")}`);
  if (!E164.test(c.phoneNumber || "")) errs.push("phoneNumber: E.164, e.g. +17025550100");
  if (!CARRIERS.includes(c.carrier)) errs.push(`carrier: one of ${CARRIERS.join(", ")}`);
  if (!isStr(c.ownerName)) errs.push("ownerName: required");
  if (c.ownerEmail != null && !EMAIL.test(c.ownerEmail)) errs.push("ownerEmail: not a valid email");
  if (!c.demo && !c.ownerEmail) errs.push("ownerEmail: required for real customers");
  if (!isStr(c.timezone)) errs.push("timezone: IANA name, e.g. America/Phoenix");
  else { try { new Intl.DateTimeFormat("en-US", { timeZone: c.timezone }); } catch { errs.push(`timezone: unknown "${c.timezone}"`); } }
  const h = c.businessHours;
  if (!h || typeof h !== "object") errs.push("businessHours: required");
  else for (const d of DAYS) {
    if (!Array.isArray(h[d]) || !h[d].every(r => RANGE.test(r) && r.split("-")[0] < r.split("-")[1]))
      errs.push(`businessHours.${d}: list of "HH:MM-HH:MM" ranges ([] = closed)`);
  }
  if (!(strList(c.serviceArea) && c.serviceArea.length)) errs.push("serviceArea: list of cities/areas");
  if (!isStr(c.emergencyPolicy)) errs.push("emergencyPolicy: required");
  if (!isStr(c.scheduling)) errs.push("scheduling: required (what to tell callers about scheduling)");
  if (!isStr(c.callbackEmergency)) errs.push('callbackEmergency: e.g. "within 15 minutes"');
  if (!isStr(c.callbackRoutine)) errs.push('callbackRoutine: e.g. "by 9am next business day"');
  if (!STATUSES.includes(c.status)) errs.push(`status: one of ${STATUSES.join(", ")}`);
  if (c.demo != null && typeof c.demo !== "boolean") errs.push("demo: true or false");
  if (c.demo) { if (c.plan != null) errs.push("plan: demo lines have no plan"); }
  else if (!(c.plan in PLANS)) errs.push(`plan: one of ${Object.keys(PLANS).join(", ")}`);
  if (c.status === "trial" && !/^\d{4}-\d{2}-\d{2}$/.test(c.trialEndsAt || "")) errs.push("trialEndsAt: YYYY-MM-DD required while on trial");
  if (!c.demo && !(strList(c.servicesOffered) && c.servicesOffered.length)) errs.push("servicesOffered: required for real customers (the agent only offers what is listed)");
  for (const k of ["servicesOffered", "priceRanges"]) if (c[k] != null && !strList(c[k])) errs.push(`${k}: list of text lines`);
  for (const k of ["serviceCallFee", "gasUtility", "electricUtility", "ownerNotes"]) if (c[k] != null && typeof c[k] !== "string") errs.push(`${k}: text`);
  if (c.faqs != null && !(Array.isArray(c.faqs) && c.faqs.every(f => f && isStr(f.q) && isStr(f.a)))) errs.push("faqs: list of {q, a}");
  return errs;
}

function readDir(dir, log) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort().flatMap(f => {
    const file = path.join(dir, f);
    try {
      const c = JSON.parse(fs.readFileSync(file, "utf8"));
      const errs = validateCustomer(c);
      if (errs.length) { log.error?.(`[customers] skipped ${file}: ${errs.join("; ")}`); return []; }
      return [{ ...c, demo: c.demo === true, _file: file }];
    } catch (e) { log.error?.(`[customers] skipped ${file}: ${e.message}`); return []; }
  });
}

// Loads every valid customer. Never throws: a bad file is logged and skipped so a
// typo can't take the live demo lines down. Duplicate ids/numbers keep the first.
function createStore({ dirs = [path.join(__dirname, "customers"), process.env.CUSTOMERS_DIR], log = console } = {}) {
  let byNumber = new Map(), byId = new Map();
  function reload() {
    const nextNum = new Map(), nextId = new Map();
    for (const c of dirs.filter(Boolean).flatMap(d => readDir(d, log))) {
      if (nextId.has(c.id)) { log.error?.(`[customers] duplicate id ${c.id} in ${c._file}; kept ${nextId.get(c.id)._file}`); continue; }
      if (nextNum.has(c.phoneNumber)) { log.error?.(`[customers] duplicate number ${c.phoneNumber} in ${c._file}; kept ${nextNum.get(c.phoneNumber)._file}`); continue; }
      nextId.set(c.id, c); nextNum.set(c.phoneNumber, c);
    }
    byNumber = nextNum; byId = nextId;
    return byId.size;
  }
  reload();
  return {
    reload,
    byNumber: n => byNumber.get(n) || null,
    byId: id => byId.get(id) || null,
    all: () => [...byId.values()],
  };
}

// For scripts/reg.js: accept a customer id, or a trade name (= that trade's demo line).
function pickForRegistration(arg, customers) {
  const a = String(arg || "").toLowerCase();
  return customers.find(c => c.id === a) || customers.find(c => c.demo && c.trade === a) || null;
}

module.exports = { validateCustomer, createStore, pickForRegistration, TRADES, STATUSES, PLANS, CARRIERS, DAYS };
