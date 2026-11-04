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
