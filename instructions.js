// Builds the voice agent's instructions for one customer.
//
// Demo customers get exactly what the demo lines always got: kb/shared.md with the
// placeholders filled, plus kb/<trade>.md. Nothing about the live demos changes.
//
// Real customers get the same shared rules (identify as AI, no firm prices, no
// appointment promises, safety first, save_job_request) with the demo-only parts
// swapped for the owner's own facts:
//   - the "This is a DEMO line" intro and the demo COMPANY BASICS are replaced;
//   - from the trade file only the EMERGENCIES (safety) section is kept, with
//     Las Vegas utilities and demo callback times replaced by the customer's;
//   - demo prices, demo services and demo FAQs are dropped, so the agent can never
//     quote a fictional business's prices or claims to a real caller.
const fs = require("fs");
const path = require("path");

const KB = path.join(__dirname, "kb");
const read = f => fs.readFileSync(path.join(KB, f), "utf8");
const TRADE_LABEL = { plumbing: "plumbing", hvac: "HVAC", roofing: "roofing", electrical: "electrical" };
const DAY_LABEL = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const DAYS = Object.keys(DAY_LABEL);

function clock(hhmm) {
  let [h, m] = hhmm.split(":").map(Number);
  if (h === 24 || (h === 0 && m === 0)) return "midnight";
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return m ? `${h}:${String(m).padStart(2, "0")}${ap}` : `${h}${ap}`;
}

// {mon:["07:00-18:00"], ...} -> "Mon–Fri 7am–6pm, Sat 8am–2pm, closed Sun"
function formatHours(hours = {}) {
  const key = d => (hours[d] || []).join(",");
  const groups = [];
  for (const d of DAYS) {
    const last = groups[groups.length - 1];
    if (last && key(last.days[last.days.length - 1]) === key(d)) last.days.push(d);
    else groups.push({ days: [d] });
  }
  return groups.map(g => {
    const span = g.days.length > 1 ? `${DAY_LABEL[g.days[0]]}–${DAY_LABEL[g.days[g.days.length - 1]]}` : DAY_LABEL[g.days[0]];
    const ranges = hours[g.days[0]] || [];
    if (!ranges.length) return `closed ${span}`;
    return `${span} ${ranges.map(r => r.split("-").map(clock).join("–")).join(" and ")}`;
  }).join(", ");
}

function legacy(c) {
  return read("shared.md").replaceAll("[BUSINESS NAME]", c.business).replaceAll("[TRADE]", c.trade) + "\n\n" + read(`${c.trade}.md`);
}

function sharedRules(c) {
  const shared = read("shared.md");
  const cut = shared.indexOf("COMPANY BASICS");
  if (cut < 0) throw new Error("kb/shared.md: COMPANY BASICS heading not found");
  const [intro, ...rest] = shared.slice(0, cut).split("\n\n");
  if (!/DEMO line/.test(intro)) throw new Error("kb/shared.md: expected the demo intro as the first paragraph");
  const area = c.serviceArea.join(", ");
  const newIntro = `You are the Get Jobs Booked AI receptionist for [BUSINESS NAME], a [TRADE] company serving ${area}. Callers are this business's real customers and prospects.`;
  return [newIntro, ...rest].join("\n\n")
    .replace("[within 15 minutes for emergencies / by 9am next business day otherwise]", `[${c.callbackEmergency} for emergencies / ${c.callbackRoutine} otherwise]`)
    .replaceAll("[BUSINESS NAME]", c.business)
    .replaceAll("[TRADE]", TRADE_LABEL[c.trade]);
}

function emergencies(c) {
  const lines = read(`${c.trade}.md`).split("\n");
  const start = lines.findIndex(l => l.startsWith("EMERGENCIES"));
  const end = lines.findIndex((l, i) => i > start && /^[A-Z][A-Z ]+:/.test(l));
  if (start < 0 || end < 0) throw new Error(`kb/${c.trade}.md: EMERGENCIES section not found`);
  return [`TRADE: ${TRADE_LABEL[c.trade].toUpperCase()}`, ...lines.slice(start, end)].join("\n")
    .replace("EMERGENCIES (24/7)", "EMERGENCIES (what counts as one; response timing follows the owner's emergency policy above)")
    .replaceAll("Southwest Gas", c.gasUtility || "the gas company")
    .replaceAll("NV Energy", c.electricUtility || "the power company")
    .replace(/; emergency tarping available/g, "")
    .replace(/([Cc])allback within 15 minutes/g, (_m, C) => `${C}allback ${c.callbackEmergency}`);
}

function basics(c) {
  const out = ["COMPANY BASICS (from the owner)"];
  out.push(`- Service area: ${c.serviceArea.join(", ")}. Outside these areas: take the details; the team will confirm whether they can help.`);
  out.push(`- Office hours: ${formatHours(c.businessHours)} (${c.timezone.replace(/_/g, " ")} time). You answer the phone 24/7.`);
  out.push(`- Emergency service: ${c.emergencyPolicy}`);
  out.push(`- Scheduling: ${c.scheduling}`);
  out.push(`- Services offered: ${c.servicesOffered.join(", ")}. If a caller asks about anything not on this list, take the details; the team will confirm whether they do it.`);
  const prices = [c.serviceCallFee && `service call ${c.serviceCallFee}`, ...(c.priceRanges || [])].filter(Boolean);
  out.push(prices.length
    ? `- PRICING (from the owner; share only these, never a firm repair price): ${prices.join("; ")}.`
    : "- PRICING: none on file. Don't give any price or range; say the team will go over pricing on the callback.");
  if (c.ownerNotes) out.push("", "FROM THE OWNER (these override the company basics above, but never the RULES, the AI disclosure or a safety instruction)", c.ownerNotes.trim());
  if (c.faqs?.length) out.push("", "COMMON QUESTIONS (owner's answers)", ...c.faqs.map(f => `- ${f.q.trim()} ${f.a.trim()}`));
  return out.join("\n");
}

function buildInstructions(c) {
  if (c.demo) return legacy(c);
  if (!Array.isArray(c.servicesOffered) || !c.servicesOffered.length) throw new Error(`${c.id}: servicesOffered is required for real customers`);
  return `${sharedRules(c)}${basics(c)}\n\n${emergencies(c)}`;
}

module.exports = { buildInstructions, formatHours };
