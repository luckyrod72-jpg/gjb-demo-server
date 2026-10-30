// GJB demo server.
// Flow: caller dials a demo number -> carrier SIP trunk -> xAI (sip.voice.x.ai)
// -> xAI POSTs realtime.call.incoming to /webhooks/xai -> we verify the signature,
// pick the trade from the dialed number, join the call over WebSocket and send
// the agent's instructions. Audio stays between the carrier and xAI; this server
// only steers the session.
const express = require("express");
const crypto = require("crypto");
const WebSocket = require("ws");
const { createStore } = require("./customers");
const { buildInstructions } = require("./instructions");
const { adminRouter } = require("./admin");
const { SAVE_JOB_TOOL, buildSummary, sendSummary } = require("./summary");

const XAI_API_KEY = process.env.XAI_API_KEY;
const WEBHOOK_SECRETS = (process.env.XAI_WEBHOOK_SECRETS || process.env.XAI_WEBHOOK_SECRET || "")
  .split(",").map(s => s.trim()).filter(Boolean); // one secret per registered number is fine
const VOICE = process.env.XAI_VOICE || "ara";
const PORT = process.env.PORT || 3000;
const TOLERANCE_SECONDS = 300;

if (!XAI_API_KEY) console.warn("[warn] XAI_API_KEY is not set");
if (!WEBHOOK_SECRETS.length) console.warn("[warn] XAI_WEBHOOK_SECRET(S) not set: webhooks will be rejected");

const customers = createStore();

// Standard Webhooks style verification: HMAC-SHA256 over `${id}.${timestamp}.${body}`.
// Standard Webhooks v1: versioned base64 signatures and a bounded integer timestamp.
function verifySignature(rawBody, headers, secrets) {
  const id = headers["webhook-id"], ts = headers["webhook-timestamp"], sigHeader = headers["webhook-signature"];
  if (![id, ts, sigHeader].every(v => typeof v === "string" && v.length > 0)) return false;
  if (!/^\d+$/.test(ts) || !Number.isSafeInteger(Number(ts))) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(ts)) > TOLERANCE_SECONDS) return false;
  const signed = `${id}.${ts}.${rawBody}`;
  const provided = sigHeader.split(/\s+/).filter(s => s.startsWith("v1,")).map(s => s.slice(3));
  for (const secret of secrets) {
    const keys = [];
    if (secret.startsWith("whsec_")) keys.push(Buffer.from(secret.slice(6), "base64"));
    keys.push(Buffer.from(secret, "utf8"));
    for (const key of keys) {
      const expected = crypto.createHmac("sha256", key).update(signed).digest("base64");
      for (const p of provided) {
        const a = Buffer.from(p), b = Buffer.from(expected);
        if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
      }
    }
  }
  return false;
}

function dialedNumber(sipHeaders = []) {
  const to = (sipHeaders.find(h => (h.name || "").toLowerCase() === "to") || {}).value || "";
  const m = to.match(/\+?1?(\d{10})/);
  return m ? `+1${m[1]}` : null;
}

async function hangup(callId, { request = fetch, log = console } = {}) {
  try {
    const r = await request(`https://api.x.ai/v1/realtime/calls/${encodeURIComponent(callId)}/hangup`, { method: "POST", headers: { Authorization: `Bearer ${XAI_API_KEY}` }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) log.error(`[call] hangup failed (${r.status})`);
  } catch { log.error("[call] hangup unavailable; carrier timeout must clear call"); }
}

function joinCall(callId, line, { Socket = WebSocket, request = fetch, timeoutMs = 10000, log = console, env = process.env, mail = sendSummary } = {}) {
  let ws, ready = false, failed = false, finished = false;
  const startedAt = Date.now();
  let job = null;
  const transcript = [];
  const finish = async () => {
    if (finished || !ready) return;
    finished = true;
    const endedAt = Date.now();
    log.log?.(`[call ${callId}] ended after ${Math.round((endedAt - startedAt) / 1000)}s (${line.business}); job captured: ${!!job}`);
    if (!job && !transcript.some(t => t.role === "caller")) return; // silent/hang-up call: nothing to report
    try {
      const summary = buildSummary({ line, job, transcript, startedAt, endedAt, callId });
      await mail(summary, { to: line.ownerEmail || env.SUMMARY_TO, env, request, log });
    } catch (e) { log.error(`[summary] failed: ${e.message}`); }
  };
  const fail = async () => {
    if (failed) return;
    failed = true;
    clearTimeout(timer);
    log.error("[call] WebSocket join/session failed; ending SIP call");
    try { ws?.terminate(); } catch {}
    await hangup(callId, { request, log });
  };
  const timer = setTimeout(fail, timeoutMs);
  timer.unref?.();
  let instructions;
  try { instructions = buildInstructions(line); }
  catch (e) { log.error(`[call ${callId}] could not build instructions: ${e.message}`); void fail(); return null; }
  try { ws = new Socket(`wss://api.x.ai/v1/realtime?call_id=${encodeURIComponent(callId)}`, {
    headers: { Authorization: `Bearer ${XAI_API_KEY}` }
  });
  } catch { void fail(); return null; }
  ws.on("open", () => {
    if (failed) return;
    try {
    ws.send(JSON.stringify({
      type: "session.update",
      session: { voice: VOICE, instructions, turn_detection: { type: "server_vad" }, tools: [SAVE_JOB_TOOL] }
    }));
    } catch { void fail(); }
  });
  ws.on("message", buf => {
    try {
      const ev = JSON.parse(buf.toString());
      if (ev.type === "session.updated" && !ready && !failed) {
        ready = true; clearTimeout(timer);
        try { ws.send(JSON.stringify({ type: "response.create" })); } catch { void fail(); }
      }
      if (ev.type === "response.function_call_arguments.done" && ev.name === SAVE_JOB_TOOL.name) {
        try { job = { ...(job || {}), ...JSON.parse(ev.arguments || "{}") }; } catch { /* keep previous */ }
        try {
          ws.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: ev.call_id, output: JSON.stringify({ saved: true }) } }));
          ws.send(JSON.stringify({ type: "response.create" }));
        } catch { /* call may be ending */ }
      }
      if (ev.type === "conversation.item.input_audio_transcription.completed" && ev.transcript) transcript.push({ role: "caller", text: String(ev.transcript).trim() });
      if (ev.type === "response.output_audio_transcript.done" && ev.transcript) transcript.push({ role: "agent", text: String(ev.transcript).trim() });
      if (ev.type === "error") { if (!ready) void fail(); else log.error(`[call ${callId}] realtime error: ${ev.error?.message || "unknown"}`); }
      else if (/^(session\.|response\.done|conversation\.item\.created)/.test(ev.type)) console.log(`[call ${callId}] ${ev.type}`);
    } catch { /* ignore non-JSON */ }
  });
  ws.on("close", () => { clearTimeout(timer); if (!ready) void fail(); else void finish(); });
  ws.on("error", () => { void fail(); });
  return ws;
}

// Decides what to do with a verified webhook event. Paused customers are not answered.
function routeCall(evt, store) {
  if (evt.type !== "realtime.call.incoming") return { action: "ignore", reason: `ignored ${evt.type}` };
  const callId = evt.data && evt.data.call_id;
  const num = dialedNumber(evt.data && evt.data.sip_headers);
  const line = num ? store.byNumber(num) : null;
  if (!callId || !line) return { action: "ignore", reason: `no line for ${num} (call ${callId})` };
  if (line.status === "paused") return { action: "hangup", callId, reason: `${line.id} is paused; not answering (call ${callId})` };
  return { action: "join", callId, line };
}

const app = express();
app.use("/admin", adminRouter({ store: customers }));
app.get("/health", (_req, res) => {
  const all = customers.all();
  res.json({ ok: true, lines: all.length, demo: all.filter(c => c.demo).length, customers: all.filter(c => !c.demo).length });
});

app.post("/webhooks/xai", express.raw({ type: "*/*", limit: "1mb" }), (req, res) => {
  const raw = req.body.toString("utf8");
  if (!verifySignature(raw, req.headers, WEBHOOK_SECRETS)) {
    const h = req.headers;
    console.warn(`[webhook] rejected: bad or missing signature (secrets loaded: ${WEBHOOK_SECRETS.length}; headers id/ts/sig present: ${!!h["webhook-id"]}/${!!h["webhook-timestamp"]}/${!!h["webhook-signature"]}; sig format: ${String(h["webhook-signature"] || "").split(",")[0].slice(0, 6)})`);
    return res.status(401).send("bad signature");
  }
  let evt; try { evt = JSON.parse(raw); } catch { return res.status(400).send("bad json"); }
  res.status(200).send("ok"); // ack fast, then join
  const r = routeCall(evt, customers);
  if (r.action === "ignore") return console.log(`[webhook] ${r.reason}`);
  if (r.action === "hangup") { console.warn(`[webhook] ${r.reason}`); return void hangup(r.callId); }
  joinCall(r.callId, r.line);
});

if (require.main === module) app.listen(PORT, () => console.log(`GJB demo server on :${PORT}`));
module.exports = { verifySignature, dialedNumber, joinCall, routeCall, app, customers };

