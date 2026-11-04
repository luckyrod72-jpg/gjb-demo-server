const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { createCalendar, earliestDay, daySlots, ptToDate, ptParts, say, slotProblem } = require('../calendar');
const { createStore, pickForRegistration } = require('../customers');
const { buildInstructions } = require('../instructions');
const { checkUsage } = require('../usage');
const { sendDueReports } = require('../report');
const { texmlRouter } = require('../texml');
const store = createStore();
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const env = { GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'test@example.invalid', private_key: privateKey }) };
function google(now) {
  const writes = [], busy = [];
  const calendar = createCalendar({ env, now: () => new Date(now), request: async (url, options) => {
    if (url.includes('oauth2')) return { ok: true, json: async () => ({ access_token: 'test-only', expires_in: 3600 }) };
    if (url.endsWith('/freeBusy')) return { ok: true, json: async () => ({ calendars: { 'rod@leadsweep.co': { busy: [...busy] } } }) };
    const body = JSON.parse(options.body); writes.push(body);
    busy.push({ start: ptToDate(body.start.dateTime.slice(0, 16)).toISOString(), end: ptToDate(body.end.dateTime.slice(0, 16)).toISOString() });
    return { ok: true, json: async () => ({ id: `event${writes.length}` }) };
  } });
  return { calendar, writes, busy };
}

test('every open slot round-trips across both DST changes and events explicitly use Pacific', async () => {
  for (const [day, now, utc] of [
    ['2026-10-31', '2026-10-31T06:30:00Z', '2026-10-31T15:00:00.000Z'],
    ['2026-11-02', '2026-11-02T07:30:00Z', '2026-11-02T16:00:00.000Z'],
    ['2027-03-13', '2027-03-13T07:30:00Z', '2027-03-13T16:00:00.000Z'],
    ['2027-03-15', '2027-03-15T06:30:00Z', '2027-03-15T15:00:00.000Z'],
  ]) {
    assert.equal(earliestDay(new Date(now)), day);
    for (const start of daySlots(day)) {
      const parts = ptParts(ptToDate(start));
      assert.equal(`${parts.date}T${parts.hhmm}`, start);
      assert.equal(slotProblem(start, new Date(now)), null);
    }
    assert.equal(ptToDate(`${day}T08:00`).toISOString(), utc);
    const { calendar, writes } = google(now);
    assert.equal((await calendar.book({ start: `${day}T08:00`, zone: 'America/New_York', title: 'Test' })).booked, true);
    assert.deepEqual(writes[0].start, { dateTime: `${day}T08:00:00`, timeZone: 'America/Los_Angeles' });
    assert.deepEqual(writes[0].end, { dateTime: `${day}T08:15:00`, timeZone: 'America/Los_Angeles' });
  }
  assert.match(say('2027-03-13T08:00', 'America/Phoenix'), /9:00 AM Arizona/);
  assert.match(say('2027-03-15T08:00', 'America/Phoenix'), /8:00 AM Arizona/);
  assert.match(say('2027-03-15T08:00', 'Pacific/Honolulu'), /5:00 AM Hawaii/);
});

test('a conflict introduced after offering times is caught by the booking recheck', async () => {
  const { calendar, writes, busy } = google('2026-11-06T20:00:00Z');
  const days = await calendar.availability({ zone: 'America/New_York' });
  assert.deepEqual(days.map(d => d.date), ['2026-11-07', '2026-11-09', '2026-11-10']);
  const start = days[0].times[0].start;
  busy.push({ start: '2026-11-07T16:00:00Z', end: '2026-11-07T16:15:00Z' });
  assert.equal((await calendar.book({ start, title: 'Conflict' })).booked, false);
  assert.equal(writes.length, 0);
});

test('all demos retain their exact legacy instructions and registration selectors are separated', () => {
  for (const line of store.all().filter(c => c.demo)) {
    const read = file => fs.readFileSync(path.join(__dirname, '../kb', file), 'utf8');
    const legacy = read('shared.md').replaceAll('[BUSINESS NAME]', line.business).replaceAll('[TRADE]', line.trade) + '\n\n' + read(`${line.trade}.md`);
    assert.equal(buildInstructions(line), legacy);
  }
  for (const [selector, id] of [['plumbing', 'demo-copperline-plumbing'], ['trs', 'inbound-trs'], ['gjb', 'inbound-gjb']]) {
    assert.equal(pickForRegistration(selector, store.all()).id, id);
  }
  const listed = Object.values(require('../lines'));
  assert.equal(listed.length, 4);
  assert.ok(listed.every(line => line.demo && !line.inbound));
});

test('inbound lines never query plan stats, claim usage alerts or send monthly reports', async () => {
  const unexpected = () => { assert.fail('inbound entered billing/reporting'); };
  for (const customer of store.all().filter(c => c.inbound)) {
    assert.ok(customer.plan == null);
    assert.equal(await checkUsage({ customer, month: '2026-11', callLog: { monthStats: unexpected, claimAlert: unexpected }, mail: unexpected }), null);
  }
  assert.deepEqual(await sendDueReports({ customers: { all: () => store.all().filter(c => c.inbound).map(c => ({ ...c, ownerEmail: 'test@example.invalid' })) },
    callLog: { claimReport: unexpected }, mail: unexpected, force: true }), []);
});

async function withRouter(env, run) {
  const app = express(); app.use('/telnyx', texmlRouter({ store, env }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const hit = async (route, params = {}) => {
    const result = await fetch(`http://127.0.0.1:${server.address().port}/telnyx/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
    return { status: result.status, body: await result.text() };
  };
  try { await run(hit); } finally { await new Promise(resolve => server.close(resolve)); }
}

test('every TeXML endpoint is disabled without a token and hides the cell from wrong tokens', async () => {
  for (const token of [undefined, 'test-token']) await withRouter({ INBOUND_TEXML_TOKEN: token, INBOUND_FORWARD_TO: '+17025550111' }, async hit => {
    for (const endpoint of ['inbound', 'screen', 'screen-result', 'after-dial']) {
      const result = await hit(`wrong/${endpoint}`, { To: '+17022682097', line: 'inbound-trs', call: 'A', Digits: '1' });
      assert.equal(result.status, 404);
      assert.doesNotMatch(result.body, /17025550111/);
    }
  });
});

test('TeXML token, call-id, URL and XML escaping survive reserved characters', async () => {
  const token = `test/&<>"'?#`;
  await withRouter({ INBOUND_TEXML_TOKEN: token, INBOUND_FORWARD_TO: '+17025550111', RENDER_EXTERNAL_URL: 'https://example.invalid' }, async hit => {
    const result = await hit(`${encodeURIComponent(token)}/inbound`, { To: '+17022682097', CallSid: `call/&<>"'?#` });
    assert.equal(result.status, 200);
    assert.doesNotMatch(result.body, /call\/|<script/);
    const encoded = result.body.match(/<Dial action="([^"]+)"/)[1];
    const decoded = encoded.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const url = new URL(decoded);
    assert.equal(decodeURIComponent(url.pathname.split('/')[2]), token);
    assert.equal(url.searchParams.get('call'), `call/&<>"'?#`);
    assert.equal(url.searchParams.get('line'), 'inbound-trs');
  });
});
