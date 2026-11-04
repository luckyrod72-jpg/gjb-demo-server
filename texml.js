// Telnyx TeXML call flow for the inbound lines: ring Rod's cell, then the receptionist.
// The cell leg must press 1 before it's bridged, so a carrier voicemail that picks up
// can never swallow the call (Rod: never goes to voicemail). Set INBOUND_FORWARD_TO to
// Rod's cell; until it's set, calls go straight to the receptionist.
// Telnyx documents no request signature for TeXML fetches, so the URL carries a secret
// token (INBOUND_TEXML_TOKEN). With no token set these routes don't exist.
const express = require("express");
const crypto = require("crypto");

const E164 = /^\+[1-9]\d{7,14}$/;
const SPOKEN = { trs: "Trade Ready Sites", gjb: "Get Jobs Booked" };
const xml = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
const doc = body => `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${body}</Response>`;
const HANGUP = doc("<Hangup/>");
const toReceptionist = number => doc(`<Dial><Sip>sip:${xml(number)}@sip.voice.x.ai;transport=tls</Sip></Dial>`);

function texmlRouter({ store, env = process.env, log = console, acceptedTtlMs = 2 * 60 * 60 * 1000 }) {
  const router = express.Router();
  const token = env.INBOUND_TEXML_TOKEN;
  if (!token) return router;
  const accepted = new Map(); // call id -> time Rod pressed 1
  const base = () => `${(env.RENDER_EXTERNAL_URL || "https://gjb-demo-server.onrender.com").replace(/\/$/, "")}/telnyx/${encodeURIComponent(token)}`;
  const lineById = id => { const l = store.byId(String(id || "")); return l?.inbound ? l : null; };
  const send = (res, body) => res.type("application/xml").send(body);

  router.use("/:token", express.urlencoded({ extended: false }), (req, res, next) => {
    const a = Buffer.from(req.params.token), b = Buffer.from(token);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(404).end();
    req.p = { ...req.query, ...req.body };
    next();
  });

  router.all("/:token/inbound", (req, res) => {
    const line = store.byNumber(String(req.p.To || ""));
    if (!line?.inbound) { log.warn?.(`[texml] no inbound line for ${req.p.To}`); return send(res, HANGUP); }
    const cell = (env.INBOUND_FORWARD_TO || "").trim();
    if (!E164.test(cell)) return send(res, toReceptionist(line.phoneNumber));
    const q = `call=${encodeURIComponent(req.p.CallSid || "")}&line=${encodeURIComponent(line.id)}`;
    send(res, doc(`<Dial action="${xml(`${base()}/after-dial?${q}`)}" method="POST" timeout="18" callerId="${xml(line.phoneNumber)}" answerOnBridge="true"><Number url="${xml(`${base()}/screen?${q}`)}" method="POST">${xml(cell)}</Number></Dial>`));
  });

  // Plays only to Rod's cell. No digit (voicemail, or he ignored it) ends that leg.
  router.all("/:token/screen", (req, res) => {
    const line = lineById(req.p.line);
    if (!line) return send(res, HANGUP);
    const q = `call=${encodeURIComponent(req.p.call || "")}&line=${encodeURIComponent(line.id)}`;
    send(res, doc(`<Gather numDigits="1" timeout="6" action="${xml(`${base()}/screen-result?${q}`)}" method="POST"><Say>${xml(SPOKEN[line.inbound])} inbound. Press 1 to answer.</Say></Gather><Hangup/>`));
  });

  router.all("/:token/screen-result", (req, res) => {
    if (String(req.p.Digits) !== "1") return send(res, HANGUP);
    const now = Date.now();
    for (const [k, t] of accepted) if (now - t > acceptedTtlMs) accepted.delete(k);
    accepted.set(String(req.p.call), now);
    send(res, doc("")); // empty document: bridge Rod to the caller
  });

  // The cell leg ended. We go by whether Rod pressed 1, not by the dial status, because a
  // voicemail that answered also looks "completed". Anything else goes to the receptionist.
  router.all("/:token/after-dial", (req, res) => {
    const line = lineById(req.p.line);
    if (!line) return send(res, HANGUP);
    const call = String(req.p.call);
    if (accepted.delete(call)) return send(res, HANGUP);
    send(res, toReceptionist(line.phoneNumber));
  });
  return router;
}

module.exports = { texmlRouter };
