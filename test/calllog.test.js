const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { memoryLog, pgLog, callRow, createCallLog } = require('../calllog');
const { checkUsage, minutesUsed } = require('../usage');
const { isAfterHours, monthKey } = require('../hours');
const { joinCall, recordCall } = require('../server');
const example = require('../docs/customer.example.json'); // Phoenix, Mon–Fri 07:30–17:00, $399 = 750 min
const quiet = { error() {}, warn() {}, log() {} };

test('after-hours and month use the customer time zone', () => {
  assert.equal(isAfterHours(example, new Date('2026-11-02T15:00:00Z')), false); // Mon 08:00 Phoenix
  assert.equal(isAfterHours(example, new Date('2026-11-03T00:30:00Z')), true);  // Mon 17:30 Phoenix
  assert.equal(isAfterHours(example, new Date('2026-11-07T17:00:00Z')), true);  // Saturday
  assert.equal(monthKey(new Date('2026-12-01T05:00:00Z'), 'America/Phoenix'), '2026-11'); // still Nov 30 locally
  assert.equal(minutesUsed(61), 2); assert.equal(minutesUsed(0), 0);
});

test('callRow captures duration, job, urgency and after-hours', () => {
  const r = callRow({ callId: 'c1', customer: example, startedAt: Date.parse('2026-11-07T17:00:00Z'), endedAt: Date.parse('2026-11-07T17:03:05Z'), job: { urgency: 'emergency' } });
  assert.deepEqual({ ...r }, { callId: 'c1', customerId: example.id, demo: false, month: '2026-11-01', startedAt: '2026-11-07T17:00:00.000Z', endedAt: '2026-11-07T17:03:05.000Z',
    durationSeconds: 185, jobCaptured: true, urgency: 'emergency', afterHours: true });
  assert.equal(callRow({ callId: 'c2', customer: example, startedAt: 0, endedAt: 1000, job: null }).jobCaptured, false);
});

test('Rod gets one email at 80% and one at 100%, never repeats, never for demo lines', async () => {
  const log = memoryLog(); const sent = [];
  const mail = async (s, o) => { sent.push({ s, o }); return { sent: true }; };
  const env = { USAGE_ALERT_TO: 'rod@example.com' };
  const add = async (id, secs) => { await log.record({ callId: id, customerId: example.id, month: '2026-11', durationSeconds: secs, jobCaptured: false, urgency: null, afterHours: false });
    return checkUsage({ customer: example, month: '2026-11', callLog: log, mail, env, log: quiet }); };
  assert.equal(await add('a', 599 * 60), null);                 // 599 of 750 = 79.9%
  assert.equal((await add('b', 60)).level, 80);                // 600 = 80%
  assert.equal(await add('c', 60), null);                      // still 80s, already sent
  assert.equal((await add('d', 150 * 60)).level, 100);         // 751
  assert.equal(await add('e', 600), null);
  const rod = sent.filter(x => x.o.to === 'rod@example.com'), owner = sent.filter(x => x.o.to === example.ownerEmail);
  assert.equal(rod.length, 2); assert.match(rod[1].s.subject, /Over plan.*751\/750/); assert.match(rod[1].s.text, /\$0\.60/);
  assert.equal(owner.length, 1, 'owner gets one heads-up at 80%'); assert.match(owner[0].s.text, /every call keeps getting answered/);
  // A single call that jumps straight past 100% sends only the 100% email.
  const log2 = memoryLog(); sent.length = 0;
  await log2.record({ callId: 'x', customerId: example.id, month: '2026-11', durationSeconds: 800 * 60 });
  assert.equal((await checkUsage({ customer: example, month: '2026-11', callLog: log2, mail, env, log: quiet })).level, 100);
  assert.equal(await checkUsage({ customer: example, month: '2026-11', callLog: log2, mail, env, log: quiet }), null);
  assert.equal(sent.length, 1);
  assert.equal(await checkUsage({ customer: { ...example, demo: true, plan: null }, month: '2026-11', callLog: log2, mail, env, log: quiet }), null);
});

test('a finished call is logged (silent ones too) through joinCall -> recordCall', async () => {
  class Socket extends EventEmitter { constructor() { super(); this.sent = []; } send(x) { this.sent.push(JSON.parse(x)); } terminate() {} }
  const log = memoryLog(); const rows = [];
  const onEnd = async info => rows.push(await recordCall(info, { log, mail: async () => ({ sent: true }), env: {}, logger: quiet }));
  const ws = joinCall('call-9', example, { Socket, log: quiet, mail: async () => ({}), onEnd });
  ws.emit('open'); ws.emit('message', Buffer.from('{"type":"session.updated"}')); ws.emit('close');
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  assert.equal(rows.length, 1); assert.equal(rows[0].callId, 'call-9'); assert.equal(rows[0].jobCaptured, false);
  const month = rows[0].month; assert.equal((await log.monthStats(example.id, month)).calls, 1);
});

test('no DATABASE_URL falls back to memory with a warning', () => {
  const warns = []; const l = createCallLog({ env: {}, log: { warn: m => warns.push(m) } });
  assert.equal(l.kind, 'memory'); assert.match(warns[0], /lost on restart/);
});

test('Postgres call log against a real database (set TEST_DATABASE_URL to run)', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await pool.query('DROP TABLE IF EXISTS calls, usage_alerts');
  const db = pgLog(pool); await db.init(); await db.init(); // idempotent
  const base = { customer: example, startedAt: Date.parse('2026-11-07T17:00:00Z'), endedAt: Date.parse('2026-11-07T17:02:00Z') };
  await db.record(callRow({ ...base, callId: 'p1', job: { urgency: 'emergency' } }));
  await db.record(callRow({ ...base, callId: 'p1', job: { urgency: 'emergency' } })); // duplicate webhook: ignored
  await db.record(callRow({ ...base, callId: 'p2', startedAt: Date.parse('2026-11-02T16:00:00Z'), endedAt: Date.parse('2026-11-02T16:00:30Z'), job: null }));
  assert.deepEqual(await db.monthStats(example.id, '2026-11'), { calls: 2, seconds: 150, jobs: 1, emergencies: 1, afterHours: 1, afterHoursJobs: 1 });
  assert.deepEqual(await db.monthStats(example.id, '2026-10'), { calls: 0, seconds: 0, jobs: 0, emergencies: 0, afterHours: 0, afterHoursJobs: 0 });
  assert.equal(await db.claimAlert(example.id, '2026-11', 80), true);
  assert.equal(await db.claimAlert(example.id, '2026-11', 80), false);
  await pool.query('DROP TABLE calls, usage_alerts'); await db.close();
});

test('the owner email goes out before the call log, and a broken log never blocks it', async () => {
  class Socket extends EventEmitter { constructor() { super(); this.sent = []; } send(x) { this.sent.push(JSON.parse(x)); } terminate() {} }
  const order = []; const errors = [];
  const ws = joinCall('call-10', { ...example, ownerEmail: 'o@example.com' }, { Socket, log: { ...quiet, error: m => errors.push(m) },
    mail: async () => { order.push('email'); return { sent: true }; }, onEnd: async () => { order.push('log'); throw new Error('db down'); } });
  ws.emit('open'); ws.emit('message', Buffer.from('{"type":"session.updated"}'));
  ws.emit('message', Buffer.from(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'hi' })));
  ws.emit('close'); await new Promise(r => setTimeout(r, 5));
  assert.deepEqual(order, ['email', 'log']); assert.match(errors.join(), /db down/);
});
