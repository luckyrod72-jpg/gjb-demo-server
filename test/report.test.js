const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport, sendDueReports, previousMonth } = require('../report');
const { memoryLog, callRow, pgLog } = require('../calllog');
const example = require('../docs/customer.example.json'); // Phoenix, $399 = 750 min
const quiet = { error() {}, warn() {}, log() {} };
const demo = { ...example, id: 'demo-x', demo: true, plan: null, phoneNumber: '+17025550000' };
const paused = { ...example, id: 'paused-x', status: 'paused', phoneNumber: '+17025550001' };
const store = list => ({ all: () => list });

async function seeded() {
  const log = memoryLog();
  const at = (iso, secs, job) => log.record(callRow({ callId: iso, customer: example, startedAt: Date.parse(iso), endedAt: Date.parse(iso) + secs * 1000, job }));
  await at('2026-11-02T16:00:00Z', 120, { urgency: 'routine' });   // Mon 9am, job
  await at('2026-11-03T03:00:00Z', 200, { urgency: 'emergency' }); // Mon 8pm after hours, emergency job
  await at('2026-11-08T18:00:00Z', 30, null);                      // Sunday, no job
  return log;
}

test('report counts calls, jobs, emergencies, after-hours and minutes, and never claims booking', async () => {
  const r = buildReport(example, '2026-11', await (await seeded()).monthStats(example.id, '2026-11-01'));
  assert.equal(r.subject, 'Saguaro Plumbing Co: your call report (November 2026)');
  for (const line of ['Calls answered: 3', 'Job requests captured: 2', 'Emergencies flagged: 1', 'After-hours calls: 2', 'Job requests captured after hours: 1', 'Minutes used: 6 of 750'])
    assert.ok(r.text.includes(line), line);
  assert.match(r.text, /doesn't book appointments/);
  assert.doesNotMatch(r.text + r.html, /\bbooked (an|the|your) appointment|we booked|appointments booked/i);
  const empty = buildReport(example, '2026-10', { calls: 0, seconds: 0, jobs: 0, emergencies: 0, afterHours: 0, afterHoursJobs: 0 });
  assert.match(empty.text, /check that call forwarding is still on/);
  assert.doesNotMatch(buildReport({ ...example, ownerName: '<i>x</i>' }, '2026-11', { calls: 0, seconds: 0 }).html, /<i>x<\/i>/);
  assert.equal(previousMonth('2026-01'), '2025-12');
});

test('reports go out on the 1st after 8am local, once, only to live customers, only when enabled', async () => {
  const log = await seeded(); const sent = [];
  const mail = async (s, o) => { sent.push({ s, o }); return { sent: true }; };
  const customers = store([example, demo, paused]);
  const run = (iso, env = { REPORTS_ENABLED: 'true' }) => sendDueReports({ customers, callLog: log, mail, env, now: new Date(iso), log: quiet });
  assert.deepEqual(await run('2026-12-01T16:00:00Z', {}), []);           // disabled
  assert.deepEqual(await run('2026-12-01T14:30:00Z'), []);               // 7:30am Phoenix: too early
  assert.deepEqual(await run('2026-12-02T16:00:00Z'), []);               // the 2nd
  assert.deepEqual(await run('2026-12-01T16:00:00Z'), [{ id: example.id, month: '2026-11-01' }]);
  assert.deepEqual(await run('2026-12-01T17:00:00Z'), []);               // already sent
  assert.equal(sent.length, 1); assert.equal(sent[0].o.to, example.ownerEmail); assert.match(sent[0].s.text, /Calls answered: 3/);
});

test('a failed send is released and retried next hour', async () => {
  const log = await seeded(); let ok = false; let tries = 0;
  const mail = async () => { tries++; return { sent: ok }; };
  const run = () => sendDueReports({ customers: store([example]), callLog: log, mail, env: { REPORTS_ENABLED: 'true' }, now: new Date('2026-12-01T16:00:00Z'), log: quiet });
  assert.deepEqual(await run(), []); ok = true;
  assert.equal((await run()).length, 1); assert.equal(tries, 2);
});

test('report tracking in real Postgres (TEST_DATABASE_URL)', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const { Pool } = require('pg'); const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await pool.query('DROP TABLE IF EXISTS calls, usage_alerts, report_sends'); const db = pgLog(pool); await db.init();
  assert.equal(await db.claimReport('a', '2026-11'), true); assert.equal(await db.claimReport('a', '2026-11'), false);
  await db.releaseReport('a', '2026-11'); assert.equal(await db.claimReport('a', '2026-11'), true);
  await pool.query('DROP TABLE calls, usage_alerts, report_sends'); await db.close();
});

test('billing periods follow the signup day; reports go out on the new period start', async () => {
  const { periodKey, periodLabel } = require('../hours');
  const c = { ...example, createdAt: '2026-10-15T19:00:00Z' }; // Oct 15 locally
  assert.equal(periodKey(new Date('2026-11-14T19:00:00Z'), c), '2026-10-15');
  assert.equal(periodKey(new Date('2026-11-15T19:00:00Z'), c), '2026-11-15');
  assert.equal(periodLabel('2026-10-15', c), 'Oct 15 – Nov 14, 2026');
  const end = { ...example, createdAt: '2026-01-31T19:00:00Z' };
  assert.equal(periodKey(new Date('2026-02-28T19:00:00Z'), end), '2026-02-28'); // short month clamps
  const log = memoryLog(); const sent = [];
  await log.record(callRow({ callId: 'p1', customer: c, startedAt: Date.parse('2026-11-01T17:00:00Z'), endedAt: Date.parse('2026-11-01T17:02:00Z'), job: { urgency: 'routine' } }));
  const run = iso => sendDueReports({ customers: store([c]), callLog: log, mail: async s => (sent.push(s), { sent: true }), env: { REPORTS_ENABLED: 'true' }, now: new Date(iso), log: quiet });
  assert.deepEqual(await run('2026-12-01T16:00:00Z'), []); // the 1st is no longer special
  assert.deepEqual(await run('2026-11-15T16:00:00Z'), [{ id: c.id, month: '2026-10-15' }]);
  assert.match(sent[0].subject, /Oct 15 – Nov 14, 2026/);
});

test('report shows overage at $0.60/min when over plan', () => {
  const r = buildReport(example, '2026-11-01', { calls: 1, seconds: 760 * 60, jobs: 0, emergencies: 0, afterHours: 0, afterHoursJobs: 0 });
  assert.match(r.text, /Minutes over plan: 10 × \$0\.60 = \$6\.00/);
});
