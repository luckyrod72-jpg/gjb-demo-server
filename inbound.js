// Tools and after-call email for Roderick's inbound lines (TRS, GJB). The voice agent
// never does time-zone math or decides what's free: the server does, from the calendar.
const { ZONES, say, PT } = require("./calendar");

const OFFER = { trs: "TRS", gjb: "GJB" };
const zoneProp = { type: "string", enum: Object.keys(ZONES), description: "The caller's time zone, from their city and state" };
const detailProps = {
  caller_name: { type: "string", description: "Caller's name" },
  business_name: { type: "string", description: "Their business" },
  trade: { type: "string", description: "Their trade" },
  city: { type: "string" },
  state: { type: "string" },
  callback_number: { type: "string", description: "Best callback number, digits as confirmed with the caller" },
  topic: { type: "string", description: "What they want to talk about" },
  flag: { type: "string", enum: ["none", "do_not_contact", "customer_urgent", "spam"], description: "do_not_contact = asked to be removed; customer_urgent = existing customer with a problem; spam = sales pitch" },
};
const SAVE_DETAILS_TOOL = { type: "function", name: "save_caller_details", description: "Save what you know about the caller so Roderick gets it right after the call. Call it once you have a name and number, and again if you learn more. Always call it before the call ends, even with partial details.", parameters: { type: "object", properties: detailProps, required: [] } };
const CHECK_TIMES_TOOL = { type: "function", name: "check_callback_times", description: "Get the callback times Roderick has free, worded for the caller's time zone. Without a date it returns the next few open days.", parameters: { type: "object", properties: { caller_time_zone: zoneProp, date: { type: "string", description: "Optional day to check, YYYY-MM-DD" } }, required: ["caller_time_zone"] } };
const BOOK_TOOL = { type: "function", name: "book_callback", description: "Book a callback at a time returned by check_callback_times. If you already booked on this call, this moves the booking.", parameters: { type: "object", properties: { start: { type: "string", description: "The exact start value from check_callback_times" }, caller_time_zone: zoneProp, ...detailProps }, required: ["start", "caller_time_zone", "caller_name", "callback_number"] } };
const INBOUND_TOOLS = [SAVE_DETAILS_TOOL, CHECK_TIMES_TOOL, BOOK_TOOL];
const UNAVAILABLE = { available: false, instruction: "Booking is unavailable right now. Save their details and say Roderick will reach out to set a time." };

const describe = (d = {}) => [
  ["Name", d.caller_name], ["Business", d.business_name], ["Trade", d.trade], ["City/state", [d.city, d.state].filter(Boolean).join(", ")],
  ["Callback number", d.callback_number], ["Topic", d.topic], d.flag && d.flag !== "none" ? ["Flag", d.flag] : null,
].filter(r => r && r[1]);

function createInboundSession(line, { calendar, log = console }) {
  const offer = OFFER[line.inbound];
  const state = { details: null, booking: null, bookingFailed: false };
  const keep = a => { const { start, caller_time_zone, ...d } = a; state.details = { ...(state.details || {}), ...d }; };
  const handlers = {
    save_caller_details: async a => { keep(a); return { saved: true }; },
    check_callback_times: async a => {
      if (!calendar.configured()) { state.bookingFailed = true; return UNAVAILABLE; }
      try {
        const days = await calendar.availability({ date: a.date, zone: a.caller_time_zone });
        return days.length ? { available: true, days } : { available: true, days: [], instruction: "Nothing free then. Try another day, or save their details and say Roderick will reach out." };
      } catch (e) { log.error("[calendar] operation failed; check calendar configuration and provider availability"); state.bookingFailed = true; return UNAVAILABLE; }
    },
    book_callback: async a => {
      keep(a);
      if (!calendar.configured()) { state.bookingFailed = true; return { booked: false, ...UNAVAILABLE }; }
      if (state.booking?.start === a.start) return { booked: true, say: state.booking.say, note: "already booked" };
      const biz = state.details.business_name || state.details.caller_name || "Unknown";
      try {
        const r = await calendar.book({ start: a.start, zone: a.caller_time_zone, title: `${offer} callback — ${biz}`, description: describe(state.details).map(([l, v]) => `${l}: ${v}`).join("\n"), replaceEventId: state.booking?.eventId });
        if (!r.booked) return { booked: false, reason: r.reason, instruction: "Offer another time from check_callback_times." };
        state.booking = r; state.bookingFailed = false;
        return { booked: true, say: r.say };
      } catch (e) { log.error("[calendar] operation failed; check calendar configuration and provider availability"); state.bookingFailed = true; return { booked: false, ...UNAVAILABLE }; }
    },
  };
  return { handlers, state };
}

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function buildCallbackSummary({ line, state, transcript = [], callId }) {
  const offer = OFFER[line.inbound], d = state.details || {};
  const who = d.business_name || d.caller_name || "Unknown caller";
  const when = state.booking ? say(state.booking.start, PT) : null;
  const tag = d.flag === "do_not_contact" ? "DO NOT CONTACT — " : d.flag === "customer_urgent" ? "CUSTOMER — urgent — " : d.flag === "spam" ? "Spam — " : "";
  const subject = `${tag}${offer} ${when ? `callback booked: ${who} — ${when}` : `inbound call: ${who} — no callback booked`}`;
  const rows = [["Callback", when || (state.bookingFailed ? "NOT BOOKED: calendar problem, reach out to set a time" : "Not booked")],
    ...(when && state.bookingFailed ? [["Calendar problem", "A later calendar operation failed; verify the existing booking and requested changes"]] : []), ...describe(d)];
  const script = transcript.map(t => [t.role === "caller" ? "Caller" : "Receptionist", t.text]);
  return {
    subject,
    text: `${rows.map(([l, v]) => `${l}: ${v}`).join("\n")}\n\nCall ID: ${callId || "n/a"}\n\nTranscript:\n${script.map(([r, t]) => `${r}: ${t}`).join("\n") || "(none)"}`,
    html: `<div style="font:15px/1.5 Arial,sans-serif;color:#1c2430;max-width:640px"><h2 style="margin:0 0 12px">${esc(subject)}</h2><table style="border-collapse:collapse;width:100%">${rows.map(([l, v]) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;color:#555;width:160px">${esc(l)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee"><strong>${esc(v)}</strong></td></tr>`).join("")}</table><details style="margin-top:16px"><summary>Transcript</summary>${script.map(([r, t]) => `<p style="margin:4px 0"><strong>${r}:</strong> ${esc(t)}</p>`).join("") || "<p>(none)</p>"}</details></div>`,
  };
}

module.exports = { INBOUND_TOOLS, createInboundSession, buildCallbackSummary };
