const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const express = require('express');
const { createCalendar, slotProblem, daySlots, earliestDay, ptToDate, say } = require('../calendar');
const { createStore, validateCustomer, pickForRegistration } = require('../customers');
const { buildInstructions } = require('../instructions');
const { buildCallbackSummary } = require('../inbound');
const { texmlRouter } = require('../texml');
const { joinCall, routeCall } = require('../server');
const path = require('node:path');
const store = createStore({ dirs: [path.join(__dirname, '..', 'customers')], log: { error() {} } });
const trs = store.byId('inbound-trs'), gjb = store.byId('inbound-gjb');
const quiet = { error() {}, warn() {}, log() {} };

// ---- lines
test('both inbound lines load, route by number and stay out of demo and plan logic', () => {
  assert.equal(store.byNumber('+17022682097').id, 'inbound-trs');
  assert.equal(store.byNumber('+17022372415').id, 'inbound-gjb');
  assert.deepEqual(validateCustomer(trs), []);
  assert.equal(trs.demo, false);
  assert.equal(pickForRegistration('trs', store.all()).id, 'inbound-trs');
  assert.equal(pickForRegistration('plumbing', store.all()).id, 'demo-copperline-plumbing');
  assert.equal(routeCall({ type: 'realtime.call.incoming', data: { call_id: 'c', sip_headers: [{ name: 'To', value: '<sip:+17022372415@sip.voice.x.ai>' }] } }, store).line.id, 'inbound-gjb');
});

test('instructions: right greeting and KB, virtual receptionist, never the demo script or the other offer', () => {
  const t = buildInstructions(trs, new Date('2026-11-04T20:00:00Z')), g = buildInstructions(gjb);
  assert.match(t, /Hi, you've reached Roderick Adams with Trade Ready Sites, this is his virtual receptionist/);
  assert.match(g, /Hi, you've reached Roderick Adams with Get Jobs Booked, this is his virtual receptionist/);
  assert.match(t, /Wednesday, November 4, 2026 at 12:00 PM Pacific/);
  assert.match(t, /\$297/); assert.doesNotMatch(t, /\$199/);
  assert.match(g, /\$199/); assert.doesNotMatch(g, /\$297/);
  for (const s of [t, g]) {
    assert.match(s, /I'm a virtual receptionist powered by AI that works for Roderick/);
    assert.match(s, /a 10-minute call/);
    assert.doesNotMatch(s, /save_job_request|DEMO line|\[GREETING\]|\[NOW\]|AI receptionist/);
  }
});

// ---- slot rules (all times Pacific)
test('slots: 15 min, Mon-Fri 8-4, Sat 8-12, closed Sunday', () => {
  const wed = daySlots('2026-11-04'), sat = daySlots('2026-11-07');
  assert.equal(wed[0], '2026-11-04T08:00'); assert.equal(wed.at(-1), '2026-11-04T15:45'); assert.equal(wed.length, 32);
  assert.equal(sat.at(-1), '2026-11-07T11:45'); assert.equal(sat.length, 16);
  assert.deepEqual(daySlots('2026-11-08'), []);
});

test('earliest slot: next open day, and Friday callers can still get Saturday', () => {
  const at = s => new Date(s);
  assert.equal(earliestDay(at('2026-11-04T20:00:00Z')), '2026-11-05'); // Wed -> Thu
  assert.equal(earliestDay(at('2026-11-06T20:00:00Z')), '2026-11-07'); // Fri -> Sat
  assert.equal(earliestDay(at('2026-11-07T20:00:00Z')), '2026-11-09'); // Sat -> Mon
  assert.equal(earliestDay(at('2026-11-08T20:00:00Z')), '2026-11-09'); // Sun -> Mon
  assert.equal(earliestDay(at('2026-11-05T07:30:00Z')), '2026-11-05'); // still Wed night in Pacific, already Thu in UTC
});

test('slotProblem rejects same-day, closed, off-grid and far-future times', () => {
  const now = new Date('2026-11-04T20:00:00Z');
  assert.equal(slotProblem('2026-11-05T09:00', now), null);
  for (const bad of ['2026-11-04T15:00', '2026-11-05T16:00', '2026-11-05T09:10', '2026-11-08T09:00', '2026-12-30T09:00', 'tomorrow', undefined]) assert.ok(slotProblem(bad, now), String(bad));
});

test('Pacific conversion is right on both sides of daylight saving', () => {
  assert.equal(ptToDate('2026-11-05T08:00').toISOString(), '2026-11-05T16:00:00.000Z'); // PST
  assert.equal(ptToDate('2026-10-30T08:00').toISOString(), '2026-10-30T15:00:00.000Z'); // PDT
  assert.equal(ptToDate('2027-03-15T08:00').toISOString(), '2027-03-15T15:00:00.000Z'); // PDT, day after the change
  assert.equal(ptToDate('2026-11-02T08:00').toISOString(), '2026-11-02T16:00:00.000Z'); // PST, day after the change
});

test('times are read back in the caller\'s zone', () => {
  assert.equal(say('2026-11-05T08:00', 'America/New_York'), 'Thursday, November 5, 11:00 AM Eastern');
  assert.equal(say('2026-11-05T08:00', 'America/Phoenix'), 'Thursday, November 5, 9:00 AM Arizona');
  assert.equal(say('2026-11-05T08:00', 'nonsense'), 'Thursday, November 5, 8:00 AM Pacific');
});

// ---- Google calendar, faked at the HTTP layer
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const env = { GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'sa@x.iam.gserviceaccount.com', private_key: privateKey }) };
function fakeGoogle(busy = []) {
  const calls = [];
  const request = async (url, o) => {
    calls.push({ url, method: o.method, body: o.body });
    if (url.includes('oauth2')) return { ok: true, json: async () => ({ access_token: 't', expires_in: 3600 }) };
    if (url.endsWith('/freeBusy')) return { ok: true, json: async () => ({ calendars: { 'rod@leadsweep.co': { busy } } }) };
    const b = JSON.parse(o.body); busy.push({ start: ptToDate(b.start.dateTime.slice(0, 16)).toISOString(), end: ptToDate(b.end.dateTime.slice(0, 16)).toISOString() });
    return { ok: true, json: async () => ({ id: 'ev1' }) };
  };
  return { calls, request, busy };
}
const NOW = () => new Date('2026-11-04T20:00:00Z');

test('availability skips busy times and returns the next 3 open days', async () => {
  const g = fakeGoogle([{ start: '2026-11-05T16:00:00Z', end: '2026-11-05T16:30:00Z' }]); // Thu 8:00-8:30 PT
  const days = await createCalendar({ env, request: g.request, now: NOW }).availability({ zone: 'America/New_York' });
  assert.deepEqual(days.map(d => d.date), ['2026-11-05', '2026-11-06', '2026-11-07']);
  assert.equal(days[0].times[0].start, '2026-11-05T08:30');
  assert.equal(days[0].times[0].say, 'Thursday, November 5, 11:30 AM Eastern');
  assert.equal(days[2].saturday, true);
});

test('booking writes Pacific times explicitly; two callers racing for one slot cannot both win', async () => {
  const g = fakeGoogle();
  const cal = createCalendar({ env, request: g.request, now: NOW });
  const [a, b] = await Promise.all([1, 2].map(n => cal.book({ start: '2026-11-05T09:00', zone: 'America/Chicago', title: `TRS callback — ${n}`, description: 'd' })));
  assert.equal(a.booked, true); assert.equal(b.booked, false); assert.match(b.reason, /taken/);
  const post = JSON.parse(g.calls.find(c => c.method === 'POST' && c.url.endsWith('/events')).body);
  assert.deepEqual(post.start, { dateTime: '2026-11-05T09:00:00', timeZone: 'America/Los_Angeles' });
  assert.deepEqual(post.end, { dateTime: '2026-11-05T09:15:00', timeZone: 'America/Los_Angeles' });
});

test('booking a disallowed time never reaches the calendar', async () => {
  const g = fakeGoogle();
  const r = await createCalendar({ env, request: g.request, now: NOW }).book({ start: '2026-11-08T09:00', title: 't', description: 'd' });
  assert.equal(r.booked, false); assert.equal(g.calls.length, 0);
});

// ---- a whole call
class Socket extends EventEmitter { constructor() { super(); this.sent = []; } send(x) { this.sent.push(JSON.parse(x)); } terminate() {} }
const msg = (ws, o) => {
  ws.emit('message', Buffer.from(JSON.stringify(o)));
  if (o.type === 'response.function_call_arguments.done') ws.emit('message', Buffer.from(JSON.stringify({ type: 'response.done' })));
};
const tick = () => new Promise(r => setTimeout(r, 30));
const output = (ws, id) => JSON.parse(ws.sent.find(e => e.item?.call_id === id).item.output);

test('call: books, titles the event by offer, moves on request, emails Rod and logs the call', async () => {
  const g = fakeGoogle(); const mails = [], ended = [];
  const cal = createCalendar({ env, request: g.request, now: NOW });
  const ws = joinCall('c1', trs, { Socket, log: quiet, cal, env: { SUMMARY_TO: 'rod@example.com' }, mail: async (s, o) => mails.push({ s, o }), onEnd: async x => ended.push(x) });
  ws.emit('open');
  assert.deepEqual(ws.sent[0].session.tools.map(t => t.name), ['save_caller_details', 'check_callback_times', 'book_callback']);
  msg(ws, { type: 'session.updated' });
  msg(ws, { type: 'conversation.item.input_audio_transcription.completed', transcript: 'Call me back' });
  msg(ws, { type: 'response.function_call_arguments.done', name: 'book_callback', call_id: 'f1', arguments: JSON.stringify({ start: '2026-11-05T09:00', caller_time_zone: 'America/Chicago', caller_name: 'Dana', business_name: 'Ruiz Roofing', trade: 'roofing', city: 'Dallas', state: 'TX', callback_number: '2145550100', topic: 'Website', flag: 'none' }) });
  await tick();
  assert.deepEqual(output(ws, 'f1'), { booked: true, say: 'Thursday, November 5, 11:00 AM Central' });
  assert.equal(ws.sent.at(-1).type, 'response.create');
  const post = JSON.parse(g.calls.find(c => c.url.endsWith('/events')).body);
  assert.equal(post.summary, 'TRS callback — Ruiz Roofing');
  assert.match(post.description, /Callback number: 2145550100/); assert.match(post.description, /City\/state: Dallas, TX/);
  msg(ws, { type: 'response.function_call_arguments.done', name: 'book_callback', call_id: 'f2', arguments: JSON.stringify({ start: '2026-11-05T10:00', caller_time_zone: 'America/Chicago', caller_name: 'Dana', callback_number: '2145550100' }) });
  await tick();
  assert.equal(output(ws, 'f2').booked, true);
  assert.ok(g.calls.some(c => c.method === 'PATCH' && c.url.endsWith('/events/ev1')), 'moved, not double-booked');
  ws.emit('close'); await tick();
  assert.equal(mails.length, 1); assert.equal(mails[0].o.to, 'rod@example.com');
  assert.match(mails[0].s.subject, /^TRS callback booked: Ruiz Roofing — Thursday, November 5, 10:00 AM Pacific/);
  assert.equal(ended[0].job.business_name, 'Ruiz Roofing');
});

test('call: no calendar credentials or a Google outage still takes the caller\'s details and tells Rod', async () => {
  const mails = [];
  const down = createCalendar({ env, now: NOW, request: async () => { throw new Error('boom'); } });
  const ws = joinCall('c2', gjb, { Socket, log: quiet, cal: down, env: { SUMMARY_TO: 'r@e.co' }, mail: async s => mails.push(s) });
  ws.emit('open'); msg(ws, { type: 'session.updated' });
  msg(ws, { type: 'response.function_call_arguments.done', name: 'book_callback', call_id: 'f1', arguments: JSON.stringify({ start: '2026-11-05T09:00', caller_time_zone: 'America/Chicago', caller_name: 'Al', callback_number: '1' }) });
  await tick();
  assert.equal(output(ws, 'f1').booked, false); assert.match(output(ws, 'f1').instruction, /reach out/);
  ws.emit('close'); await tick();
  assert.match(mails[0].subject, /^GJB inbound call: Al — no callback booked/); assert.match(mails[0].text, /NOT BOOKED: calendar problem/);
  const off = createCalendar({ env: {}, now: NOW });
  const ws2 = joinCall('c3', gjb, { Socket, log: quiet, cal: off, mail: async () => {} });
  ws2.emit('open'); msg(ws2, { type: 'session.updated' });
  msg(ws2, { type: 'response.function_call_arguments.done', name: 'check_callback_times', call_id: 'f', arguments: '{"caller_time_zone":"America/Chicago"}' });
  await tick();
  assert.equal(output(ws2, 'f').available, false);
});

test('summary flags do-not-contact and urgent customers, and escapes caller text', () => {
  const s = f => buildCallbackSummary({ line: trs, state: { details: { business_name: '<b>X</b>', flag: f } }, transcript: [] });
  assert.match(s('do_not_contact').subject, /^DO NOT CONTACT/); assert.match(s('customer_urgent').subject, /^CUSTOMER — urgent/);
  assert.doesNotMatch(s('none').html, /<b>X<\/b>/);
});

test('demo lines are unchanged: same single tool, no inbound handling', () => {
  const ws = joinCall('c', store.byId('demo-copperline-plumbing'), { Socket, log: quiet });
  ws.emit('open');
  assert.deepEqual(ws.sent[0].session.tools.map(t => t.name), ['save_job_request']);
});

// ---- TeXML flow
function server(e, options = {}) {
  const app = express(); app.use('/telnyx', texmlRouter({ store, env: { RENDER_EXTERNAL_URL: 'https://h.test', ...e }, log: quiet, ...options }));
  return new Promise(r => { const s = app.listen(0, () => r(s)); });
}
async function hit(s, p, body) {
  const r = await fetch(`http://127.0.0.1:${s.address().port}/telnyx/${p}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body || {}).toString() });
  return { status: r.status, text: await r.text() };
}
const CELL = '+17025550111';

test('TeXML: routes are off with no token, and a wrong token gets nothing', async () => {
  let s = await server({}); assert.equal((await hit(s, 'x/inbound', { To: '+17022682097' })).status, 404); s.close();
  s = await server({ INBOUND_TEXML_TOKEN: 'sekret', INBOUND_FORWARD_TO: CELL });
  const r = await hit(s, 'nope/inbound', { To: '+17022682097' });
  assert.equal(r.status, 404); assert.doesNotMatch(r.text, /5550111/); s.close();
});

test('TeXML: with no forward number, straight to the receptionist', async () => {
  const s = await server({ INBOUND_TEXML_TOKEN: 'sekret' });
  const r = await hit(s, 'sekret/inbound', { To: '+17022682097', CallSid: 'A' });
  assert.match(r.text, /<Sip>sip:\+17022682097@sip\.voice\.x\.ai;transport=tls<\/Sip>/); assert.doesNotMatch(r.text, /<Number/); s.close();
});

test('TeXML: rings the cell 18s showing the Telnyx number; a non-inbound number never rings it', async () => {
  const s = await server({ INBOUND_TEXML_TOKEN: 'sekret', INBOUND_FORWARD_TO: CELL });
  const r = await hit(s, 'sekret/inbound', { To: '+17022372415', CallSid: 'A&B' });
  assert.match(r.text, /timeout="18"/); assert.match(r.text, /callerId="\+17022372415"/); assert.match(r.text, />\+17025550111<\/Number>/);
  assert.match(r.text, /after-dial\?call=A%26B&amp;line=inbound-gjb/);
  assert.doesNotMatch((await hit(s, 'sekret/inbound', { To: '+17026028867' })).text, /Number/);
  s.close();
});

test('TeXML: voicemail or no answer falls to the receptionist; only pressing 1 keeps the call with Rod', async () => {
  const s = await server({ INBOUND_TEXML_TOKEN: 'sekret', INBOUND_FORWARD_TO: CELL });
  const q = 'call=A&line=inbound-trs';
  assert.match((await hit(s, `sekret/screen?${q}`)).text, /Trade Ready Sites inbound\. Press 1/);
  // voicemail "answered" and no digit: status says completed, still goes to the receptionist
  assert.match((await hit(s, `sekret/screen-result?${q}`, { Digits: '' })).text, /Hangup/);
  assert.match((await hit(s, `sekret/after-dial?${q}`, { DialCallStatus: 'completed' })).text, /<Sip>sip:\+17022682097/);
  assert.match((await hit(s, `sekret/after-dial?call=Z&line=inbound-trs`, { DialCallStatus: 'no-answer' })).text, /<Sip>/);
  // Rod presses 1: bridged, and after he hangs up the caller doesn't get sent to the receptionist
  assert.doesNotMatch((await hit(s, `sekret/screen-result?${q}`, { Digits: '1' })).text, /Hangup/);
  assert.match((await hit(s, `sekret/after-dial?${q}`, { DialCallStatus: 'completed' })).text, /Hangup/);
  s.close();
});


test('TeXML: repeated after-dial callbacks retain press-1 acceptance without extending its TTL', async t => {
  let clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  const s = await server({ INBOUND_TEXML_TOKEN: 'sekret' }, { acceptedTtlMs: 1000 });
  t.after(() => new Promise(resolve => s.close(resolve)));
  const q = 'call=retry&line=inbound-trs';
  await hit(s, `sekret/screen-result?${q}`, { Digits: '1' });
  const acceptedAt = clock;
  for (const elapsed of [0, 500, 999]) {
    clock = acceptedAt + elapsed;
    const result = await hit(s, `sekret/after-dial?${q}`, { DialCallStatus: 'completed' });
    assert.match(result.text, /<Hangup\/>/, `acceptance lost before TTL at ${elapsed}ms`);
    assert.doesNotMatch(result.text, /<Sip>/);
  }
  clock += 1;
  assert.match((await hit(s, `sekret/after-dial?${q}`)).text, /<Sip>/, 'reads must not extend acceptance past its original TTL');
});

test('TeXML: acceptance expires on after-dial even with no intervening screening requests', async t => {
  let clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  const s = await server({ INBOUND_TEXML_TOKEN: 'sekret' }, { acceptedTtlMs: 1000 });
  t.after(() => new Promise(resolve => s.close(resolve)));
  const q = 'call=expired&line=inbound-gjb';
  await hit(s, `sekret/screen-result?${q}`, { Digits: '1' });
  clock += 1001;
  assert.match((await hit(s, `sekret/after-dial?${q}`)).text, /<Sip>/);
  assert.match((await hit(s, `sekret/after-dial?${q}`)).text, /<Sip>/);
});
