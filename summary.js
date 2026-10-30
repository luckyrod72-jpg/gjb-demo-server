// After-call job summary: the agent fills `save_job_request` during the call;
// when the call ends we email the owner the job details plus a transcript.
// Email goes through Resend (RESEND_API_KEY, SUMMARY_FROM). Recipient is the
// line's ownerEmail, else SUMMARY_TO. Without credentials it only logs.

const SAVE_JOB_TOOL = {
  type: "function",
  name: "save_job_request",
  description:
    "Save the caller's job request so the business owner gets it right after the call. Call this once you have the caller's name, callback number and the problem, and update it (call again) if they add details. Always call it before the call ends, even with partial details.",
  parameters: {
    type: "object",
    properties: {
      caller_name: { type: "string", description: "Caller's full name" },
      callback_number: { type: "string", description: "Best callback number, digits as confirmed with the caller" },
      service_address: { type: "string", description: "Service address with city and ZIP" },
      problem: { type: "string", description: "The problem in the caller's own words" },
      urgency: { type: "string", enum: ["emergency", "soon", "routine"], description: "emergency = safety risk or active damage now" },
      preferred_time: { type: "string", description: "Preferred day and time window" },
      customer_type: { type: "string", description: "Homeowner, renter (landlord aware?) or business" },
      heard_about: { type: "string", description: "How they heard about the business" },
      notes: { type: "string", description: "Anything else the owner should know" },
    },
    required: ["caller_name", "callback_number", "problem", "urgency"],
  },
};

const FIELDS = [
  ["urgency", "Urgency"],
  ["caller_name", "Name"],
  ["callback_number", "Callback number"],
  ["service_address", "Address"],
  ["problem", "Problem"],
  ["preferred_time", "Preferred time"],
  ["customer_type", "Customer type"],
  ["heard_about", "Heard about us"],
  ["notes", "Notes"],
];

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function minutes(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

function buildSummary({ line, job, transcript = [], startedAt, endedAt, callId }) {
  const urgent = job?.urgency === "emergency";
  const who = job?.caller_name || "Unknown caller";
  const subject = job
    ? `${urgent ? "🚨 EMERGENCY — " : ""}New job request: ${who}${job.problem ? ` — ${String(job.problem).slice(0, 60)}` : ""}`
    : `Call with no job details captured (${line.business})`;
  const rows = job
    ? FIELDS.filter(([k]) => job[k]).map(([k, label]) => [label, job[k]])
    : [["Result", "The caller did not leave job details. See the transcript below."]];
  const duration = startedAt != null && endedAt != null ? minutes(endedAt - startedAt) : "unknown";
  const text =
    `${line.business} — call answered by your Get Jobs Booked AI receptionist\n\n` +
    rows.map(([l, v]) => `${l}: ${v}`).join("\n") +
    `\n\nCall length: ${duration}\nCall ID: ${callId || "n/a"}\n\nTranscript:\n` +
    (transcript.length ? transcript.map((t) => `${t.role === "caller" ? "Caller" : "Receptionist"}: ${t.text}`).join("\n") : "(none)");
  const html =
    `<div style="font:15px/1.5 Arial,sans-serif;color:#1c2430;max-width:640px">` +
    `<h2 style="margin:0 0 4px">${urgent ? "🚨 Emergency job request" : "New job request"}</h2>` +
    `<p style="margin:0 0 16px;color:#555">${esc(line.business)} — answered by your Get Jobs Booked AI receptionist</p>` +
    `<table style="border-collapse:collapse;width:100%">${rows
      .map(([l, v]) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555;width:160px">${esc(l)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee"><strong>${esc(v)}</strong></td></tr>`)
      .join("")}</table>` +
    (job?.callback_number ? `<p style="margin:18px 0"><a href="tel:${esc(String(job.callback_number).replace(/[^+0-9]/g, ""))}" style="background:#0b5cad;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Call ${esc(who)} back</a></p>` : "") +
    `<p style="color:#555">Call length: ${esc(duration)}</p>` +
    `<details><summary>Transcript</summary><div style="margin-top:8px">${transcript
      .map((t) => `<p style="margin:4px 0"><strong>${t.role === "caller" ? "Caller" : "Receptionist"}:</strong> ${esc(t.text)}</p>`)
      .join("") || "<p>(none)</p>"}</div></details></div>`;
  return { subject, text, html };
}

async function sendSummary(summary, { to, env = process.env, request = fetch, log = console } = {}) {
  const key = env.RESEND_API_KEY, from = env.SUMMARY_FROM;
  if (!to || !key || !from) {
    log.warn?.(`[summary] not emailed (missing ${!to ? "recipient" : !key ? "RESEND_API_KEY" : "SUMMARY_FROM"}): ${summary.subject}`);
    return { sent: false };
  }
  const r = await request("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: summary.subject, text: summary.text, html: summary.html }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) {
    log.error?.(`[summary] email failed (HTTP ${r.status})`);
    return { sent: false, status: r.status };
  }
  return { sent: true };
}

module.exports = { SAVE_JOB_TOOL, buildSummary, sendSummary };
