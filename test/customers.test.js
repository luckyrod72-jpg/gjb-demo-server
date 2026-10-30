const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateCustomer, createStore, pickForRegistration } = require('../customers');
const { buildInstructions, formatHours } = require('../instructions');
const example = require('../docs/customer.example.json');
const quiet = { error() {} };
const KB = f => fs.readFileSync(path.join(__dirname, '..', 'kb', f), 'utf8');

test('every file in customers/ is valid, and the 4 demo lines keep their numbers', () => {
  const dir = path.join(__dirname, '..', 'customers');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')))
    assert.deepEqual(validateCustomer(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))), [], f);
  const store = createStore({ dirs: [dir], log: quiet });
  const want = { '+17026028867': 'plumbing', '+17027448394': 'hvac', '+17253537160': 'roofing', '+17253072525': 'electrical' };
  for (const [n, trade] of Object.entries(want)) { assert.equal(store.byNumber(n).trade, trade); assert.equal(store.byNumber(n).demo, true); }
});

test('demo instructions are byte-identical to the pre-customer-store output', () => {
  const store = createStore({ dirs: [path.join(__dirname, '..', 'customers')], log: quiet });
  for (const c of store.all()) {
    const old = KB('shared.md').replaceAll('[BUSINESS NAME]', c.business).replaceAll('[TRADE]', c.trade) + '\n\n' + KB(`${c.trade}.md`);
    assert.equal(buildInstructions(c), old, c.id);
  }
});

test('the example customer validates; bad fields are reported', () => {
  assert.deepEqual(validateCustomer(example), []);
  const bad = { ...example, phoneNumber: '602-555-0142', plan: 99, status: 'trial', trialEndsAt: null, ownerEmail: null, servicesOffered: [], timezone: 'Mars/Base' };
  const errs = validateCustomer(bad).join('\n');
  for (const f of ['phoneNumber', 'plan', 'trialEndsAt', 'ownerEmail', 'servicesOffered', 'timezone']) assert.match(errs, new RegExp(f));
  assert.match(validateCustomer({ ...example, businessHours: { ...example.businessHours, mon: ['18:00-07:00'] } }).join(), /businessHours.mon/);
});

test('real-customer instructions keep the shared rules and drop every demo fact', () => {
  const s = buildInstructions(example);
  // Shared behaviour rules survive verbatim.
  for (const rule of ["If asked whether you're a real person, say plainly that you're an AI receptionist",
    'You do NOT confirm a final appointment time', 'Never quote a firm repair price', 'give the safety instruction BEFORE anything else',
    'use the save_job_request tool', 'Never take payment, card numbers or Social Security numbers'])
    assert.ok(s.includes(rule), rule);
  // Customer facts are in.
  for (const fact of ['Saguaro Plumbing Co', 'Phoenix, Tempe, Mesa, Chandler', 'Mon–Fri 7:30am–5pm, closed Sat–Sun', '$79, waived', 'drain clearing starts at $149',
    'within 20 minutes for emergencies / by 10am the next business day otherwise', 'We do not service commercial buildings', 'Do you do tankless?', 'Shut off the main water valve'])
    assert.ok(s.includes(fact), fact);
  // Demo-only facts are gone.
  assert.match(s, /never the RULES, the AI disclosure or a safety instruction/);
  assert.match(s, /EMERGENCIES \(what counts as one; response timing follows the owner's emergency policy above\)/);
  for (const demo of ['(24/7)\n', 'DEMO line', '(demo)', 'Las Vegas', 'Copperline', '$89', '$1,600', 'Henderson', 'financing', 'Licensed and insured', 'within 15 minutes'])
    assert.ok(!s.includes(demo), demo);
});

test('no prices on file means the agent is told to give none; utilities default to generic', () => {
  const c = { ...example, trade: 'electrical', serviceCallFee: undefined, priceRanges: undefined, gasUtility: undefined, electricUtility: undefined };
  const s = buildInstructions(c);
  assert.match(s, /PRICING: none on file/);
  assert.ok(!s.includes('NV Energy') && s.includes('the power company'));
  assert.ok(!buildInstructions({ ...example, trade: 'roofing' }).includes('tarping'));
  assert.throws(() => buildInstructions({ ...example, servicesOffered: [] }), /servicesOffered/);
});

test('formatHours groups days and handles split shifts', () => {
  assert.equal(formatHours({ mon: ['07:00-18:00'], tue: ['07:00-18:00'], wed: ['07:00-18:00'], thu: ['07:00-18:00'], fri: ['07:00-18:00'], sat: ['08:00-14:00'], sun: [] }),
    'Mon–Fri 7am–6pm, Sat 8am–2pm, closed Sun');
  assert.equal(formatHours({ mon: ['08:00-12:00', '13:00-17:30'], tue: [], wed: [], thu: [], fri: [], sat: [], sun: ['00:00-24:00'] }),
    'Mon 8am–12pm and 1pm–5:30pm, closed Tue–Sat, Sun midnight–midnight');
});

test('store skips invalid files and duplicate numbers instead of crashing; reload picks up new files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gjb-cust-'));
  fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify(example));
  fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify({ ...example, id: 'dupe-number' }));
  fs.writeFileSync(path.join(dir, 'c.json'), '{ not json');
  const errors = []; const store = createStore({ dirs: [dir], log: { error: m => errors.push(m) } });
  assert.equal(store.all().length, 1); assert.equal(errors.length, 2);
  fs.writeFileSync(path.join(dir, 'd.json'), JSON.stringify({ ...example, id: 'second', phoneNumber: '+16025550143' }));
  assert.equal(store.reload(), 2); assert.equal(store.byId('second').phoneNumber, '+16025550143');
  fs.rmSync(dir, { recursive: true });
});

test('registration lookup: trade name -> demo line, otherwise customer id', () => {
  const demo = { id: 'demo-copperline-plumbing', trade: 'plumbing', demo: true };
  const real = { id: 'example-saguaro-plumbing', trade: 'plumbing', demo: false };
  assert.equal(pickForRegistration('plumbing', [real, demo]), demo);
  assert.equal(pickForRegistration('example-saguaro-plumbing', [real, demo]), real);
  assert.equal(pickForRegistration('nope', [real, demo]), null);
});

test('webhook routing: dialed number picks the customer; paused customers are hung up, not answered', () => {
  const { routeCall } = require('../server');
  const active = { id: 'a', phoneNumber: '+16025550142', status: 'active' };
  const paused = { id: 'p', phoneNumber: '+16025550143', status: 'paused' };
  const store = { byNumber: n => [active, paused].find(c => c.phoneNumber === n) || null };
  const evt = n => ({ type: 'realtime.call.incoming', data: { call_id: 'c1', sip_headers: [{ name: 'To', value: `<sip:${n}@sip.voice.x.ai>` }] } });
  assert.deepEqual(routeCall(evt('+16025550142'), store), { action: 'join', callId: 'c1', line: active });
  assert.equal(routeCall(evt('+16025550143'), store).action, 'hangup');
  assert.equal(routeCall(evt('+16025550199'), store).action, 'ignore');
  assert.equal(routeCall({ type: 'realtime.call.ended' }, store).action, 'ignore');
});

test('real customers greet as the contractor\'s own virtual receptionist; demos keep the GJB greeting', () => {
  const { buildInstructions } = require('../instructions');
  const ex = require('../docs/customer.example.json');
  const real = buildInstructions(ex);
  assert.match(real, /"Thanks for calling Saguaro Plumbing Co, this is the virtual receptionist\. How can I help you today\?"/);
  assert.doesNotMatch(real, /Get Jobs Booked AI receptionist/);
  const demo = buildInstructions(require('../customers/demo-copperline-plumbing.json'));
  assert.match(demo, /this is the Get Jobs Booked AI receptionist/);
});
