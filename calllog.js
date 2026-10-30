// Call log: one row per answered call, kept in Postgres (DATABASE_URL, e.g. a free
// Neon project) so it survives restarts and deploys. Without DATABASE_URL it falls
// back to memory and says so in the logs: fine for tests and local runs, not for
// customers (history is lost on every restart).
const { periodKey, isAfterHours } = require("./hours");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS calls (
  call_id          text PRIMARY KEY,
  customer_id      text NOT NULL,
  demo             boolean NOT NULL DEFAULT false,
  month            text NOT NULL,          -- billing period start YYYY-MM-DD (signup-day cycle, customer's time zone)
  started_at       timestamptz NOT NULL,
  ended_at         timestamptz NOT NULL,
  duration_seconds integer NOT NULL,
  job_captured     boolean NOT NULL,
  urgency          text,                    -- emergency | soon | routine | null
  after_hours      boolean NOT NULL
);
CREATE INDEX IF NOT EXISTS calls_customer_month ON calls (customer_id, month);
CREATE TABLE IF NOT EXISTS usage_alerts (
  customer_id text NOT NULL,
  month       text NOT NULL,
  level       integer NOT NULL,            -- 80 or 100 (% of plan minutes)
  sent_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, month, level)
);
CREATE TABLE IF NOT EXISTS report_sends (
  customer_id text NOT NULL,
  month       text NOT NULL,               -- the month the report covers
  sent_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, month)
);`;

// Shapes one finished call into a log row.
function callRow({ callId, customer, startedAt, endedAt, job }) {
  const start = new Date(startedAt), end = new Date(endedAt);
  return {
    callId, customerId: customer.id, demo: !!customer.demo, month: periodKey(start, customer),
    startedAt: start.toISOString(), endedAt: end.toISOString(),
    durationSeconds: Math.max(0, Math.round((end - start) / 1000)),
    jobCaptured: !!job, urgency: job?.urgency || null, afterHours: isAfterHours(customer, start),
  };
}

const sumRows = rows => ({
  calls: rows.length,
  seconds: rows.reduce((s, r) => s + r.durationSeconds, 0),
  jobs: rows.filter(r => r.jobCaptured).length,
  emergencies: rows.filter(r => r.urgency === "emergency").length,
  afterHours: rows.filter(r => r.afterHours).length,
  afterHoursJobs: rows.filter(r => r.afterHours && r.jobCaptured).length,
});

function memoryLog() {
  const calls = new Map(), alerts = new Set(), reports = new Set();
  return {
    kind: "memory",
    async init() {},
    async record(row) { if (!calls.has(row.callId)) calls.set(row.callId, row); },
    async monthStats(customerId, month) { return sumRows([...calls.values()].filter(r => r.customerId === customerId && r.month === month)); },
    async claimAlert(customerId, month, level) { const k = `${customerId}|${month}|${level}`; if (alerts.has(k)) return false; alerts.add(k); return true; },
    async claimReport(customerId, month) { const k = `${customerId}|${month}`; if (reports.has(k)) return false; reports.add(k); return true; },
    async releaseReport(customerId, month) { reports.delete(`${customerId}|${month}`); },
    async close() {},
  };
}

function pgLog(pool) {
  return {
    kind: "postgres",
    async init() { await pool.query(SCHEMA); },
    async record(r) {
      await pool.query(
        `INSERT INTO calls (call_id, customer_id, demo, month, started_at, ended_at, duration_seconds, job_captured, urgency, after_hours)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (call_id) DO NOTHING`,
        [r.callId, r.customerId, r.demo, r.month, r.startedAt, r.endedAt, r.durationSeconds, r.jobCaptured, r.urgency, r.afterHours]);
    },
    async monthStats(customerId, month) {
      const { rows: [s] } = await pool.query(
        `SELECT count(*)::int AS calls, coalesce(sum(duration_seconds),0)::int AS seconds,
                count(*) FILTER (WHERE job_captured)::int AS jobs,
                count(*) FILTER (WHERE urgency = 'emergency')::int AS emergencies,
                count(*) FILTER (WHERE after_hours)::int AS "afterHours",
                count(*) FILTER (WHERE after_hours AND job_captured)::int AS "afterHoursJobs"
           FROM calls WHERE customer_id = $1 AND month = $2`, [customerId, month]);
      return s;
    },
    // True only for the first caller to claim this alert, so it's emailed once even if two calls end together.
    async claimAlert(customerId, month, level) {
      const { rowCount } = await pool.query(
        `INSERT INTO usage_alerts (customer_id, month, level) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [customerId, month, level]);
      return rowCount === 1;
    },
    async claimReport(customerId, month) {
      const { rowCount } = await pool.query(`INSERT INTO report_sends (customer_id, month) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [customerId, month]);
      return rowCount === 1;
    },
    async releaseReport(customerId, month) { await pool.query(`DELETE FROM report_sends WHERE customer_id = $1 AND month = $2`, [customerId, month]); },
    async close() { await pool.end(); },
  };
}

function createCallLog({ env = process.env, log = console, Pool } = {}) {
  if (!env.DATABASE_URL) {
    log.warn?.("[calls] DATABASE_URL not set: call log is in memory only and is lost on restart");
    return memoryLog();
  }
  Pool = Pool || require("pg").Pool;
  return pgLog(new Pool({ connectionString: env.DATABASE_URL, max: 3, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 }));
}

module.exports = { createCallLog, memoryLog, pgLog, callRow, SCHEMA };
