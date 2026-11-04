const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createStore } = require('../customers');
const { createCalendar, ptToDate, earliestDay, say, daySlots, slotProblem } = require('../calendar');
const { createInboundSession, buildCallbackSummary } = require('../inbound');
const { joinCall } = require('../server');
const store = createStore();
const trs = store.byId('inbound-trs');
const quiet = { error() {}, warn() {}, log() {} };
const turn = () => new Promise(resolve => setImmediate(resolve));
class Socket extends EventEmitter {
  constructor() { super(); this.sent = []; }
  send(value) { this.sent.push(JSON.parse(value)); }
  terminate() {}
}
const message = (ws, event) => ws.emit('message', Buffer.from(JSON.stringify(event)));
const args = start => ({ start, caller_time_zone: 'America/New_York', caller_name: 'Dana', callback_number: '2125550100' });

test('missing credentials on availability are identified in the summary while retaining details', async () => {
  const session = createInboundSession(trs, { calendar: createCalendar({ env: {} }), log: quiet });
  await session.handlers.save_caller_details(args());
  const result = await session.handlers.check_callback_times({ caller_time_zone: 'America/New_York' });
  assert.equal(result.available, false);
  const summary = buildCallbackSummary({ line: trs, state: session.state });
  assert.match(summary.text, /NOT BOOKED: calendar problem/);
  assert.match(summary.text, /2125550100/);
  assert.match(summary.subject, /no callback booked/);
});

test('a failed move retains the previous booking and identifies the calendar failure', async () => {
  let calls = 0;
  const calendar = { configured: () => true, book: async ({ start }) => {
    if (++calls > 1) throw new Error('unavailable');
    return { booked: true, eventId: 'event', start, say: say(start, 'America/New_York') };
  } };
  const session = createInboundSession(trs, { calendar, log: quiet });
  await session.handlers.book_callback(args('2026-11-05T08:00'));
  assert.equal((await session.handlers.book_callback(args('2026-11-05T10:00'))).booked, false);
  const summary = buildCallbackSummary({ line: trs, state: session.state });
  assert.match(summary.text, /8:00 AM Pacific/);
  assert.match(summary.text, /Calendar problem.*verify/i);
  assert.doesNotMatch(summary.text, /10:00 AM Pacific/);
});

test('calendar failures never log provider or credential error text', async () => {
  const logged = [];
  const secretMarker = 'DO_NOT_LOG_PROVIDER_CREDENTIALS';
  const calendar = { configured: () => true,
    availability: async () => { throw new Error(secretMarker); },
    book: async () => { throw new Error(secretMarker); } };
  const session = createInboundSession(trs, { calendar, log: { error: s => logged.push(s) } });
  await session.handlers.check_callback_times({ caller_time_zone: 'America/New_York' });
  await session.handlers.book_callback(args('2026-11-05T08:00'));
  assert.equal(logged.length, 2);
  assert.doesNotMatch(logged.join('\n'), new RegExp(secretMarker));
  assert.match(logged.join('\n'), /calendar/);
});

test('overlapping booking tools on one call move the first event instead of creating a second', async () => {
  const writes = [];
  const calendar = { configured: () => true, book: async request => {
    writes.push(request);
    await turn();
    return { booked: true, eventId: 'first-event', start: request.start, say: say(request.start, 'America/New_York') };
  } };
  const session = createInboundSession(trs, { calendar, log: quiet });
  await Promise.all([
    session.handlers.book_callback(args('2026-11-05T08:00')),
    session.handlers.book_callback(args('2026-11-05T10:00')),
  ]);
  assert.equal(writes.length, 2);
  assert.equal(writes[1].replaceEventId, 'first-event');
  assert.equal(session.state.booking.start, '2026-11-05T10:00');
});

test('overlapping repeated bookings on one call create only one event', async () => {
  let writes = 0;
  const calendar = { configured: () => true, book: async request => {
    writes++; await turn();
    return { booked: true, eventId: 'one', start: request.start, say: say(request.start, 'America/New_York') };
  } };
  const session = createInboundSession(trs, { calendar, log: quiet });
  const results = await Promise.all([1, 2].map(() => session.handlers.book_callback(args('2026-11-05T08:00'))));
  assert.equal(writes, 1);
  assert.ok(results.every(r => r.booked));
});

test('hangup waits for an in-flight calendar write before emailing its outcome', async () => {
  let complete, started;
  const began = new Promise(resolve => { started = resolve; });
  const result = new Promise(resolve => { complete = resolve; });
  const mails = [], ended = [];
  const cal = { configured: () => true, book: async request => {
    started(); await result;
    return { booked: true, eventId: 'saved', start: request.start, say: say(request.start, 'America/New_York') };
  } };
  const ws = joinCall('hangup-during-booking', trs, { Socket, cal, log: quiet,
    mail: async summary => mails.push(summary), onEnd: async info => ended.push(info) });
  ws.emit('open'); message(ws, { type: 'session.updated' });
  message(ws, { type: 'response.function_call_arguments.done', name: 'book_callback', call_id: 'book', arguments: JSON.stringify(args('2026-11-05T08:00')) });
  await began;
  ws.emit('close'); await turn();
  assert.equal(mails.length, 0, 'do not prematurely email no booking');
  complete(); await turn(); await turn();
  assert.equal(mails.length, 1);
  assert.match(mails[0].subject, /TRS callback booked/);
  assert.equal(ended.length, 1);
  assert.equal(ended[0].job.caller_name, 'Dana');
});

test('parallel xAI tools return all outputs and wait for response.done before continuing', async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const cal = { configured: () => true, availability: async () => { await held; return []; } };
  const ws = joinCall('parallel-tools', trs, { Socket, cal, log: quiet, mail: async () => {} });
  ws.emit('open'); message(ws, { type: 'session.updated' });
  const initial = ws.sent.filter(x => x.type === 'response.create').length;
  message(ws, { type: 'response.function_call_arguments.done', response_id: 'r', name: 'save_caller_details', call_id: 'save', arguments: JSON.stringify(args()) });
  message(ws, { type: 'response.function_call_arguments.done', response_id: 'r', name: 'check_callback_times', call_id: 'check', arguments: '{"caller_time_zone":"America/New_York"}' });
  await turn();
  assert.equal(ws.sent.filter(x => x.type === 'response.create').length, initial);
  release(); await turn();
  assert.equal(ws.sent.filter(x => x.item?.type === 'function_call_output').length, 2);
  assert.equal(ws.sent.filter(x => x.type === 'response.create').length, initial, 'wait for end of tool-generating response');
  message(ws, { type: 'response.done', response: { id: 'r' } });
  assert.equal(ws.sent.filter(x => x.type === 'response.create').length, initial + 1);
  message(ws, { type: 'response.done', response: { id: 'r' } });
  assert.equal(ws.sent.filter(x => x.type === 'response.create').length, initial + 1);
  ws.emit('close'); await turn();
});

test('response.done before a slow tool still waits for its output', async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const cal = { configured: () => true, availability: async () => { await held; return []; } };
  const ws = joinCall('slow-tool', trs, { Socket, cal, log: quiet, mail: async () => {} });
  ws.emit('open'); message(ws, { type: 'session.updated' });
  message(ws, { type: 'response.function_call_arguments.done', response_id: 'r', name: 'check_callback_times', call_id: 'check', arguments: '{}' });
  message(ws, { type: 'response.done', response: { id: 'r' } });
  assert.equal(ws.sent.filter(x => x.type === 'response.create').length, 1);
  release(); await turn();
  assert.equal(ws.sent.filter(x => x.type === 'response.create').length, 2);
  ws.emit('close'); await turn();
});

test('confirming the same booking after correcting the caller zone uses the corrected zone', async () => {
  let writes = 0;
  const calendar = { configured: () => true, book: async request => {
    writes++;
    return { booked: true, eventId: 'one', start: request.start, say: say(request.start, request.zone) };
  } };
  const session = createInboundSession(trs, { calendar, log: quiet });
  await session.handlers.book_callback(args('2026-11-05T08:00'));
  const result = await session.handlers.book_callback({ ...args('2026-11-05T08:00'), caller_time_zone: 'America/Phoenix' });
  assert.equal(result.say, 'Thursday, November 5, 9:00 AM Arizona');
  assert.equal(writes, 1);
});

test('an uncertain Google write is reported for verification and cannot be blindly retried in the same call', async () => {
  const crypto = require('node:crypto');
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  let writes = 0;
  const calendar = createCalendar({
    env: { GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'test@example.invalid', private_key: privateKey }) },
    now: () => new Date('2026-11-04T20:00:00Z'),
    request: async url => {
      if (url.includes('oauth2')) return { ok: true, json: async () => ({ access_token: 'test-only' }) };
      if (url.endsWith('/freeBusy')) return { ok: true, json: async () => ({ calendars: { 'rod@leadsweep.co': { busy: [] } } }) };
      writes++;
      throw new Error('response lost after simulated commit');
    },
  });
  const session = createInboundSession(trs, { calendar, log: quiet });
  assert.equal((await session.handlers.book_callback(args('2026-11-05T08:00'))).booked, false);
  const summary = buildCallbackSummary({ line: trs, state: session.state });
  assert.match(summary.subject, /needs verification/);
  assert.match(summary.text, /NOT CONFIRMED.*may have succeeded/);
  assert.match(summary.text, /2125550100/);
  assert.doesNotMatch(summary.text, /NOT BOOKED/);
  assert.equal((await session.handlers.book_callback(args('2026-11-05T10:00'))).booked, false);
  assert.equal(writes, 1, 'uncertain first write must be reconciled before attempting another');
});

test('xAI batches without response IDs also wait across message turns until response.done', async () => {
  const ws = joinCall('unscoped-tools', trs, { Socket, cal: { configured: () => false }, log: quiet, mail: async () => {} });
  ws.emit('open'); message(ws, { type: 'session.updated' });
  message(ws, { type: 'response.function_call_arguments.done', name: 'save_caller_details', call_id: 'first', arguments: JSON.stringify(args()) });
  await turn();
  assert.equal(ws.sent.filter(x => x.type === 'response.create').length, 1);
  message(ws, { type: 'response.function_call_arguments.done', name: 'check_callback_times', call_id: 'second', arguments: '{}' });
  await turn();
  assert.equal(ws.sent.filter(x => x.type === 'response.create').length, 1);
  message(ws, { type: 'response.done' });
  assert.equal(ws.sent.filter(x => x.type === 'response.create').length, 2);
  assert.equal(ws.sent.filter(x => x.item?.type === 'function_call_output').length, 2);
  ws.emit('close'); await turn();
});
