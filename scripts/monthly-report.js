// Preview or send a customer's monthly report by hand.
//   node scripts/monthly-report.js <customer-id> [YYYY-MM]          preview (prints, sends nothing)
//   node scripts/monthly-report.js <customer-id> [YYYY-MM] --send   send now (once per customer per month)
// Month defaults to last month. Needs DATABASE_URL for real numbers.
const { createStore } = require('../customers');
const { createCallLog } = require('../calllog');
const { buildReport, previousMonth } = require('../report');
const { sendSummary } = require('../summary');
const { localParts } = require('../hours');

(async () => {
  const [id, maybeMonth] = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const send = process.argv.includes('--send');
  const c = createStore().byId(id || '');
  if (!c) { console.error('Usage: node scripts/monthly-report.js <customer-id> [YYYY-MM] [--send]'); process.exitCode = 1; return; }
  const p = localParts(new Date(), c.timezone);
  const month = /^\d{4}-\d{2}$/.test(maybeMonth || '') ? maybeMonth : previousMonth(`${p.year}-${p.month}`);
  const log = createCallLog(); await log.init();
  const rep = buildReport(c, month, await log.monthStats(c.id, month));
  if (!send) { console.log(`To: ${c.ownerEmail}\nSubject: ${rep.subject}\n\n${rep.text}\n\n(preview only; add --send to email it)`); await log.close(); return; }
  if (!(await log.claimReport(c.id, month))) { console.error(`Already sent ${month} to ${c.id}.`); await log.close(); return; }
  const r = await sendSummary(rep, { to: c.ownerEmail });
  if (!r.sent) { await log.releaseReport(c.id, month); console.error('Not sent (see message above).'); process.exitCode = 1; }
  else console.log(`Sent ${month} report to ${c.ownerEmail}.`);
  await log.close();
})().catch(e => { console.error(e.message); process.exitCode = 1; });
