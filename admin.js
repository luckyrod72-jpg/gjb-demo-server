// Admin pages: new-customer intake form and customer list.
// Protected by HTTP Basic auth with ADMIN_TOKEN as the password (any username).
// With ADMIN_TOKEN unset, every /admin route answers 503, so nothing is exposed by default.
//
// Where the new customer file goes:
//   - CUSTOMERS_DIR set (a persistent disk): written there and loaded immediately.
//   - otherwise: shown on screen to save as customers/<id>.json and commit in a PR.
//     Render's normal filesystem is wiped on every deploy, so the form never writes
//     into the app folder.
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { validateCustomer, TRADES, CARRIERS, STATUSES, PLANS, DAYS } = require("./customers");
const { buildReport, previousMonth } = require("./report");
const { localParts } = require("./hours");

const TIMEZONES = ["America/Los_Angeles", "America/Phoenix", "America/Denver", "America/Chicago", "America/New_York", "America/Anchorage", "Pacific/Honolulu"];
const DAY_NAMES = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function authorized(req, token) {
  const m = /^Basic\s+(.+)$/i.exec(req.headers.authorization || "");
  if (!m) return false;
  const decoded = Buffer.from(m[1], "base64").toString("utf8");
  const pass = decoded.slice(decoded.indexOf(":") + 1);
  const a = crypto.createHash("sha256").update(pass).digest(), b = crypto.createHash("sha256").update(token).digest();
  return crypto.timingSafeEqual(a, b);
}

function toE164(raw) {
  const d = String(raw || "").replace(/[^\d+]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(d)) return d;
  const digits = d.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return String(raw || "").trim();
}
const slug = s => String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63);
const lines = s => String(s || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
const list = s => String(s || "").split(/[,\n]/).map(x => x.trim()).filter(Boolean);
const opt = s => (String(s || "").trim() || undefined);
function addDays(days, now = new Date()) { const d = new Date(now); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }

// Form fields -> customer object (validated separately).
function customerFromForm(f, now = new Date()) {
  const hours = Object.fromEntries(DAYS.map(d => [d, list(f[`hours_${d}`]).map(r => r.replace(/\s+/g, ""))]));
  const faqs = lines(f.faqs).map(l => { const i = l.indexOf("|"); return i < 0 ? null : { q: l.slice(0, i).trim(), a: l.slice(i + 1).trim() }; });
  const status = f.status || "trial";
  const c = {
    id: slug(f.id || f.business), business: String(f.business || "").trim(), trade: f.trade, phoneNumber: toE164(f.phoneNumber), carrier: f.carrier,
    demo: false, status, plan: Number(f.plan) || null, trialEndsAt: status === "trial" ? (opt(f.trialEndsAt) || addDays(14, now)) : (opt(f.trialEndsAt) || null),
    ownerName: String(f.ownerName || "").trim(), ownerEmail: opt(f.ownerEmail) || null, timezone: f.timezone, businessHours: hours,
    serviceArea: list(f.serviceArea), servicesOffered: lines(f.servicesOffered), serviceCallFee: opt(f.serviceCallFee), priceRanges: lines(f.priceRanges),
    emergencyPolicy: String(f.emergencyPolicy || "").trim(), scheduling: String(f.scheduling || "").trim(),
    callbackEmergency: String(f.callbackEmergency || "").trim(), callbackRoutine: String(f.callbackRoutine || "").trim(),
    gasUtility: opt(f.gasUtility), electricUtility: opt(f.electricUtility), ownerNotes: opt(f.ownerNotes),
    faqs: faqs.every(Boolean) ? faqs : [{ q: "", a: "" }], // a line without "|" fails validation visibly
    createdAt: now.toISOString(),
  };
  if (!c.priceRanges.length) delete c.priceRanges;
  if (!c.faqs.length) delete c.faqs;
  for (const k of Object.keys(c)) if (c[k] === undefined) delete c[k];
  return c;
}

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:15px/1.45 system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#1c2430;background:#fff}label{display:block;margin:12px 0 4px;font-weight:600}
input,select,textarea{width:100%;box-sizing:border-box;padding:8px;font:inherit;border:1px solid #bbb;border-radius:6px}textarea{min-height:70px}fieldset{border:1px solid #ddd;border-radius:8px;margin:18px 0;padding:8px 14px 14px}
.hint{color:#666;font-weight:400;font-size:13px}.err{background:#fde8e8;border:1px solid #e0a0a0;padding:10px 14px;border-radius:6px}.ok{background:#e6f4ea;border:1px solid #9cc9a8;padding:10px 14px;border-radius:6px}
pre{background:#f5f5f5;padding:12px;overflow:auto;border-radius:6px}button{margin-top:18px;padding:10px 18px;font:inherit;background:#0b5cad;color:#fff;border:0;border-radius:6px}
table{border-collapse:collapse;width:100%}td,th{padding:6px 8px;border-bottom:1px solid #eee;text-align:left}.grid{display:grid;grid-template-columns:120px 1fr;gap:6px 10px;align-items:center}</style></head><body>${body}</body></html>`;

function field(name, label, f, { hint = "", type = "text", area = false, required = false } = {}) {
  const v = esc(f[name]);
  const input = area ? `<textarea name="${name}" id="${name}"${required ? " required" : ""}>${v}</textarea>` : `<input type="${type}" name="${name}" id="${name}" value="${v}"${required ? " required" : ""}>`;
  return `<label for="${name}">${esc(label)} ${hint ? `<span class="hint">${esc(hint)}</span>` : ""}</label>${input}`;
}
function select(name, label, options, f) {
  return `<label for="${name}">${esc(label)}</label><select name="${name}" id="${name}">${options.map(([v, t]) => `<option value="${esc(v)}"${String(f[name] ?? "") === String(v) ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
}

function intakeForm(f = {}, errors = []) {
  const d = { status: "trial", plan: "199", carrier: "telnyx", timezone: "America/Los_Angeles", hours_mon: "07:00-17:00", hours_tue: "07:00-17:00", hours_wed: "07:00-17:00", hours_thu: "07:00-17:00", hours_fri: "07:00-17:00", ...f };
  return page("GJB — new customer", `<h1>New customer</h1><p class="hint">Creates the customer's file. Every answer becomes something the receptionist may tell callers, so write only what the owner confirmed.</p>
${errors.length ? `<div class="err"><strong>Fix these:</strong><ul>${errors.map(e => `<li>${esc(e)}</li>`).join("")}</ul></div>` : ""}
<form method="post" action="/admin/customers">
<fieldset><legend>Business</legend>${field("business", "Business name", d, { required: true })}
${select("trade", "Trade", TRADES.map(t => [t, t]), d)}${field("serviceArea", "Service area", d, { hint: "cities or areas, comma-separated", required: true })}
${field("ownerName", "Owner name", d, { required: true })}${field("ownerEmail", "Owner email", d, { type: "email", hint: "job summaries and the monthly report go here", required: true })}</fieldset>
<fieldset><legend>GJB phone line</legend>${field("phoneNumber", "GJB phone number", d, { hint: "the number we bought for them, not their own line", required: true })}
${select("carrier", "Carrier", CARRIERS.map(c => [c, c]), d)}</fieldset>
<fieldset><legend>Hours</legend>${select("timezone", "Time zone", TIMEZONES.map(t => [t, t]), d)}
<p class="hint">24-hour time, e.g. 07:00-17:00. Two shifts: 08:00-12:00, 13:00-17:00. Blank = closed.</p><div class="grid">${DAYS.map(x => `<label for="hours_${x}" style="margin:0">${DAY_NAMES[x]}</label><input name="hours_${x}" id="hours_${x}" value="${esc(d[`hours_${x}`])}">`).join("")}</div></fieldset>
<fieldset><legend>What the receptionist may say</legend>${field("servicesOffered", "Services offered", d, { area: true, hint: "one per line; the receptionist offers only these", required: true })}
${field("serviceCallFee", "Service-call fee", d, { hint: 'optional, e.g. "$89, credited toward the repair"' })}${field("priceRanges", "Starting-at price ranges", d, { area: true, hint: "optional, one per line. Leave blank and the receptionist gives no prices." })}
${field("emergencyPolicy", "Emergency policy", d, { area: true, hint: "what counts, hours, after-hours fee", required: true })}${field("scheduling", "What to say about scheduling", d, { area: true, hint: "the team confirms times; never promise one", required: true })}
${field("callbackEmergency", "Emergency callback promise", d, { hint: 'e.g. "within 15 minutes"', required: true })}${field("callbackRoutine", "Routine callback promise", d, { hint: 'e.g. "by 9am next business day"', required: true })}
${field("gasUtility", "Gas utility", d, { hint: "optional; used in gas-smell safety lines" })}${field("electricUtility", "Electric utility", d, { hint: "optional; used in power-line safety lines" })}
${field("faqs", "FAQs", d, { area: true, hint: "optional, one per line: question | answer" })}${field("ownerNotes", "Other owner notes", d, { area: true, hint: "optional; cannot override the AI disclosure, safety or pricing rules" })}</fieldset>
<fieldset><legend>Plan</legend>${select("plan", "Plan", Object.entries(PLANS).map(([p, m]) => [p, `$${p}/mo — ${m} minutes`]), d)}
${select("status", "Status", STATUSES.map(s => [s, s]), d)}${field("trialEndsAt", "Trial ends", d, { type: "date", hint: "blank = 14 days from today" })}</fieldset>
<button type="submit">Create customer</button></form>`);
}

function adminRouter({ store, callLog = null, env = process.env, now = () => new Date() } = {}) {
  const r = express.Router();
  r.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!env.ADMIN_TOKEN) return res.status(503).send("Admin is disabled (ADMIN_TOKEN not set).");
    if (!authorized(req, env.ADMIN_TOKEN)) return res.set("WWW-Authenticate", 'Basic realm="GJB admin"').status(401).send("Login required.");
    if (req.method === "POST") { // browsers resend Basic auth automatically, so block cross-site posts
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return res.status(403).send("Cross-site request blocked.");
    }
    next();
  });
  r.get("/intake", (_req, res) => res.send(intakeForm()));
  r.get("/customers", (_req, res) => res.send(page("GJB — customers", `<h1>Customers</h1><p><a href="/admin/intake">+ New customer</a></p><table><tr><th>ID</th><th>Business</th><th>Number</th><th>Status</th><th>Plan</th><th>Trial ends</th></tr>${store.all().map(c =>
    `<tr><td>${esc(c.id)}</td><td>${esc(c.business)}${c.demo ? " (demo)" : ""}</td><td>${esc(c.phoneNumber)}</td><td>${esc(c.status)}</td><td>${c.plan ? `$${esc(c.plan)}` : "—"}</td><td>${esc(c.trialEndsAt || "—")}</td></tr>`).join("")}</table>`)));
  // Preview a customer's monthly report: /admin/report/<id>?month=YYYY-MM (default: last month). Sends nothing.
  r.get("/report/:id", async (req, res) => {
    const c = store.byId(req.params.id);
    if (!c || !callLog) return res.status(404).send("No such customer (or no call log).");
    const p = localParts(now(), c.timezone);
    const month = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : previousMonth(`${p.year}-${p.month}`);
    const rep = buildReport(c, month, await callLog.monthStats(c.id, month));
    res.send(page(rep.subject, `<p class="hint">Preview only. To: ${esc(c.ownerEmail || "(no owner email)")} · Subject: ${esc(rep.subject)}</p>${rep.html}`));
  });
  r.post("/customers", express.urlencoded({ extended: false, limit: "64kb" }), (req, res) => {
    const f = req.body || {};
    const c = customerFromForm(f, now());
    const errors = validateCustomer(c);
    if (store.byId(c.id)) errors.push(`id: "${c.id}" already exists`);
    const taken = store.byNumber(c.phoneNumber);
    if (taken) errors.push(`phoneNumber: already used by ${taken.id}`);
    if (errors.length) return res.status(400).send(intakeForm(f, errors));
    const json = JSON.stringify(c, null, 2) + "\n";
    const next = `<h2>Next steps</h2><ol><li>Register the number with xAI: <code>node scripts/reg.js ${esc(c.id)}</code> and save the signing secret in Render.</li><li>Make a test call to ${esc(c.phoneNumber)}.</li><li>Have the owner forward their line. Full list: docs/NEW-CUSTOMER-SETUP.md</li></ol>`;
    if (env.CUSTOMERS_DIR) {
      const file = path.join(env.CUSTOMERS_DIR, `${c.id}.json`);
      try { fs.mkdirSync(env.CUSTOMERS_DIR, { recursive: true }); fs.writeFileSync(file, json, { flag: "wx" }); }
      catch (e) { return res.status(500).send(page("Error", `<div class="err">Could not save: ${esc(e.code || e.message)}</div>`)); }
      store.reload();
      return res.status(201).send(page("Customer created", `<div class="ok">Saved and live: <strong>${esc(c.business)}</strong> (${esc(c.id)}).</div>${next}<pre>${esc(json)}</pre>`));
    }
    res.status(200).send(page("Customer file ready", `<div class="ok">Valid. Not saved on the server (no CUSTOMERS_DIR): save the text below as <code>customers/${esc(c.id)}.json</code> and open a PR. It goes live when merged.</div>${next}<pre>${esc(json)}</pre>`));
  });
  return r;
}

module.exports = { adminRouter, customerFromForm, toE164, slug };
