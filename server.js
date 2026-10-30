// GJB demo server.
// Flow: caller dials a demo number -> carrier SIP trunk -> xAI (sip.voice.x.ai)
// -> xAI POSTs realtime.call.incoming to /webhooks/xai -> we verify the signature,
// pick the trade from the dialed number, join the call over WebSocket and send
// the agent's instructions. Audio stays between the carrier and xAI; this server
// only steers the session.
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const LINES = require("./lines");

const XAI_API_KEY = process.env.XAI_API_KEY;
const WEBHOOK_SECRETS = (process.env.XAI_WEBHOOK_SECRETS || process.env.XAI_WEBHOOK_SECRET || "")
  .split(",").map(s => s.trim()).filter(Boolean); // one secret per registered number is fine
const VOICE = process.env.XAI_VOICE || "eve";
const PORT = process.env.PORT || 3000;
const TOLERANCE_SECONDS = 300;

if (!XAI_API_KEY) console.warn("[warn] XAI_API_KEY is not set");
if (!WEBHOOK_SECRETS.length) console.warn("[warn] XAI_WEBHOOK_SECRET(S) not set: webhooks will be rejected");

const SHARED = fs.readFileSync(path.join(__dirname, "kb", "shared.md"), "utf8");
const kbFor = trade => fs.readFileSync(path.join(__dirname, "kb", `${trade}.md`), "utf8");

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

function joinCall(callId, line, { Socket = WebSocket, request = fetch, timeoutMs = 10000, log = console } = {}) {
  let ws, ready = false, failed = false;
  const fail = async () => {
    if (failed) return;
    failed = true;
    clearTimeout(timer);
    log.error("[call] WebSocket join/session failed; ending SIP call");
    try { ws?.terminate(); } catch {}
    try {
      const r = await request(`https://api.x.ai/v1/realtime/calls/${encodeURIComponent(callId)}/hangup`, { method: "POST", headers: { Authorization: `Bearer ${XAI_API_KEY}` }, signal: AbortSignal.timeout(5000) });
      if (!r.ok) log.error(`[call] hangup failed (${r.status})`);
    } catch { log.error("[call] hangup unavailable; carrier timeout must clear call"); }
  };
  const timer = setTimeout(fail, timeoutMs);
  timer.unref?.();
  const instructions = SHARED
    .replaceAll("[BUSINESS NAME]", line.business)
    .replaceAll("[TRADE]", line.trade) + "\n\n" + kbFor(line.trade);
  try { ws = new Socket(`wss://api.x.ai/v1/realtime?call_id=${encodeURIComponent(callId)}`, {
    headers: { Authorization: `Bearer ${XAI_API_KEY}` }
  });
  } catch { void fail(); return null; }
  ws.on("open", () => {
    if (failed) return;
    try {
    ws.send(JSON.stringify({
      type: "session.update",
      session: { voice: VOICE, instructions, turn_detection: { type: "server_vad" } }
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
      if (ev.type === "error") void fail();
      else if (/^(session\.|response\.done|conversation\.item\.created)/.test(ev.type)) console.log(`[call ${callId}] ${ev.type}`);
    } catch { /* ignore non-JSON */ }
  });
  ws.on("close", () => { clearTimeout(timer); if (!ready) void fail(); });
  ws.on("error", () => { void fail(); });
  return ws;
}

const app = express();
app.get("/health", (_req, res) => res.json({ ok: true, lines: Object.keys(LINES).length }));

app.post("/webhooks/xai", express.raw({ type: "*/*", limit: "1mb" }), (req, res) => {
  const raw = req.body.toString("utf8");
  if (!verifySignature(raw, req.headers, WEBHOOK_SECRETS)) {
    console.warn("[webhook] rejected: bad or missing signature");
    return res.status(401).send("bad signature");
  }
  let evt; try { evt = JSON.parse(raw); } catch { return res.status(400).send("bad json"); }
  res.status(200).send("ok"); // ack fast, then join
  if (evt.type !== "realtime.call.incoming") return console.log(`[webhook] ignored ${evt.type}`);
  const callId = evt.data && evt.data.call_id;
  const num = dialedNumber(evt.data && evt.data.sip_headers);
  const line = LINES[num];
  if (!callId || !line) return console.warn(`[webhook] no line for ${num} (call ${callId})`);
  joinCall(callId, line);
});

if (require.main === module) app.listen(PORT, () => console.log(`GJB demo server on :${PORT}`));
module.exports = { verifySignature, dialedNumber, joinCall };

