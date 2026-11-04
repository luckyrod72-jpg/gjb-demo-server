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
