const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { adminRouter, customerFromForm, toE164 } = require('../admin');
const { createStore, validateCustomer } = require('../customers');
const { buildInstructions } = require('../instructions');

const form = {
  business: 'Cactus Flow Plumbing & Drain', trade: 'plumbing', serviceArea: 'Phoenix, Tempe', ownerName: 'Pat Owner', ownerEmail: 'pat@example.com',
  phoneNumber: '(602) 555-0177', carrier: 'telnyx', timezone: 'America/Phoenix',
  hours_mon: '07:00-17:00', hours_tue: '07:00-17:00', hours_wed: '07:00-17:00', hours_thu: '07:00-17:00', hours_fri: '08:00-12:00, 13:00-17:00', hours_sat: '', hours_sun: '',
  servicesOffered: 'drain cleaning\nwater heaters', serviceCallFee: '', priceRanges: '', emergencyPolicy: 'Burst pipes 24/7.', scheduling: 'Team confirms the time.',
  callbackEmergency: 'within 15 minutes', callbackRoutine: 'next business day', faqs: 'Weekends? | Emergencies only.', plan: '199', status: 'trial', trialEndsAt: '',
};

async function serve(env, store) {
  const app = express(); app.use('/admin', adminRouter({ store, env, now: () => new Date('2026-11-02T18:00:00Z') }));
  const srv = app.listen(0); await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return { base, close: () => srv.close() };
}
const auth = t => ({ Authorization: 'Basic ' + Buffer.from(`admin:${t}`).toString('base64') });

test('form fields become a valid customer whose instructions build', () => {
  const c = customerFromForm(form, new Date('2026-11-02T18:00:00Z'));
  assert.deepEqual(validateCustomer(c), []);
  assert.equal(c.id, 'cactus-flow-plumbing-and-drain'); assert.equal(c.phoneNumber, '+16025550177');
  assert.equal(c.trialEndsAt, '2026-11-16'); assert.deepEqual(c.businessHours.fri, ['08:00-12:00', '13:00-17:00']);
  assert.deepEqual(c.faqs, [{ q: 'Weekends?', a: 'Emergencies only.' }]); assert.equal(c.priceRanges, undefined);
  assert.match(buildInstructions(c), /PRICING: none on file/);
  assert.equal(toE164('1-702-555-0100'), '+17025550100'); assert.equal(toE164('+447700900123'), '+447700900123');
});

test('admin is off without ADMIN_TOKEN and needs the token with it', async () => {
  const store = createStore({ dirs: [], log: { error() {} } });
  let s = await serve({}, store);
  assert.equal((await fetch(`${s.base}/admin/intake`)).status, 503); s.close();
  s = await serve({ ADMIN_TOKEN: 'fixture-token' }, store);
  assert.equal((await fetch(`${s.base}/admin/intake`)).status, 401);
  assert.equal((await fetch(`${s.base}/admin/intake`, { headers: auth('wrong') })).status, 401);
  const ok = await fetch(`${s.base}/admin/intake`, { headers: auth('fixture-token') });
  assert.equal(ok.status, 200); assert.match(await ok.text(), /New customer/);
  const xsite = await fetch(`${s.base}/admin/customers`, { method: 'POST', headers: { ...auth('fixture-token'), Origin: 'https://evil.example', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
  assert.equal(xsite.status, 403); s.close();
});

test('without CUSTOMERS_DIR the form returns the file to commit; with it the customer is saved and live', async () => {
  const post = (base, body) => fetch(`${base}/admin/customers`, { method: 'POST', headers: { ...auth('t'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  let store = createStore({ dirs: [], log: { error() {} } });
  let s = await serve({ ADMIN_TOKEN: 't' }, store);
  let r = await post(s.base, form); assert.equal(r.status, 200);
  const html = await r.text(); assert.match(html, /customers\/cactus-flow-plumbing-and-drain\.json/); assert.match(html, /Not saved on the server/);
  assert.equal(store.all().length, 0);
  r = await post(s.base, { ...form, phoneNumber: '555', servicesOffered: '' }); assert.equal(r.status, 400);
  const bad = await r.text(); assert.match(bad, /phoneNumber/); assert.match(bad, /servicesOffered/); assert.match(bad, /Cactus Flow Plumbing &amp; Drain/, 'form keeps what was typed');
  s.close();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gjb-intake-'));
  store = createStore({ dirs: [dir], log: { error() {} } });
  s = await serve({ ADMIN_TOKEN: 't', CUSTOMERS_DIR: dir }, store);
  r = await post(s.base, form); assert.equal(r.status, 201);
  assert.equal(store.byNumber('+16025550177').id, 'cactus-flow-plumbing-and-drain');
  assert.ok(fs.existsSync(path.join(dir, 'cactus-flow-plumbing-and-drain.json')));
  r = await post(s.base, form); assert.equal(r.status, 400, 'same id/number twice is refused');
  assert.match(await r.text(), /already/);
  const list = await (await fetch(`${s.base}/admin/customers`, { headers: auth('t') })).text();
  assert.match(list, /Cactus Flow/);
  s.close(); fs.rmSync(dir, { recursive: true });
});

test('admin report preview renders last month and sends nothing', async () => {
  const { memoryLog } = require('../calllog');
  const example = require('../docs/customer.example.json');
  const store = { all: () => [example], byId: id => (id === example.id ? example : null), byNumber: () => null };
  const app = express(); app.use('/admin', adminRouter({ store, callLog: memoryLog(), env: { ADMIN_TOKEN: 't' }, now: () => new Date('2026-12-05T18:00:00Z') }));
  const srv = app.listen(0); await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const html = await (await fetch(`${base}/admin/report/${example.id}`, { headers: auth('t') })).text();
  assert.match(html, /November 2026 call report/); assert.match(html, /Preview only/);
  assert.equal((await fetch(`${base}/admin/report/nope`, { headers: auth('t') })).status, 404);
  srv.close();
});
