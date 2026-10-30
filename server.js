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
// ASSUMPTION to confirm against xAI docs on first live call: the secret may carry a
// "whsec_" prefix with a base64 key, and the signature header is "v1,<base64>" (space-separated list).
function verifySignature(rawBody, headers, secrets) {
  const id = headers["webhook-id"], ts = headers["webhook-timestamp"], sigHeader = headers["webhook-signature"];
  if (!id || !ts || !sigHeader) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(ts)) > TOLERANCE_SECONDS) return false;
  const signed = `${id}.${ts}.${rawBody}`;
  const provided = sigHeader.split(" ").map(s => s.split(",")[1] || s);
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

function joinCall(callId, line) {
  const instructions = SHARED
    .replaceAll("[BUSINESS NAME]", line.business)
    .replaceAll("[TRADE]", line.trade) + "\n\n" + kbFor(line.trade);
  const ws = new WebSocket(`wss://api.x.ai/v1/realtime?call_id=${encodeURIComponent(callId)}`, {
    headers: { Authorization: `Bearer ${XAI_API_KEY}` }
  });
  ws.on("open", () => {
    ws.send(JSON.stringify({
      type: "session.update",
      session: { voice: VOICE, instructions, turn_detection: { type: "server_vad" } }
    }));
    ws.send(JSON.stringify({ type: "response.create" })); // agent speaks the greeting first
    console.log(`[call ${callId}] joined as ${line.business}`);
  });
  ws.on("message", buf => {
    try {
      const ev = JSON.parse(buf.toString());
      if (ev.type === "error") console.error(`[call ${callId}] error`, JSON.stringify(ev));
      else if (/^(session\.|response\.done|conversation\.item\.created)/.test(ev.type)) console.log(`[call ${callId}] ${ev.type}`);
    } catch { /* ignore non-JSON */ }
  });
  ws.on("close", code => console.log(`[call ${callId}] closed (${code})`));
  ws.on("error", err => console.error(`[call ${callId}] ws error`, err.message));
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
module.exports = { verifySignature, dialedNumber };
