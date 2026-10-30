// Short form so it can be typed by hand in the Render web shell (pasting there inserts stray characters).
// Usage: node scripts/reg.js plumbing   (or hvac, roofing, electrical = that trade's demo line)
//        node scripts/reg.js <customer-id>   (a paying customer's number, from customers/<id>.json)
const { register } = require('./register-number.js');
const { createStore, pickForRegistration } = require('../customers.js');
const CIDRS = {
  // Telnyx US SIP region signaling IPs (sip.telnyx.com)
  telnyx: '192.76.120.10/32,64.16.250.10/32',
  // Twilio Elastic SIP Trunking signaling, North America Virginia + Oregon
  twilio: '54.172.60.0/30,54.244.51.0/30',
};
const all = createStore().all();
const info = pickForRegistration(process.argv[2], all);
if (!info) { console.error('Type a trade (' + [...new Set(all.filter(c => c.demo).map(c => c.trade))].join(', ') + ') or a customer id'); process.exit(1); }
const number = info.phoneNumber;
const carrier = info.carrier;
const base = process.env.RENDER_EXTERNAL_URL || 'https://gjb-demo-server.onrender.com';
const env = { ...process.env, XAI_PHONE_NUMBER: number, XAI_WEBHOOK_URL: base.replace(/\/$/, '') + '/webhooks/xai',
  XAI_SIP_ALLOWED_ADDRESSES: CIDRS[carrier], XAI_NUMBER_NAME: `GJB ${info.demo ? 'demo' : 'customer'} - ${info.business}` };
const replace = process.argv.includes('--replace');
async function removeExisting() {
  const h = { Authorization: `Bearer ${(process.env.XAI_API_KEY || '').trim()}` };
  const r = await fetch('https://api.x.ai/v2/phone-numbers', { headers: h });
  if (!r.ok) throw new Error(`Could not list numbers: HTTP ${r.status}`);
  const j = await r.json();
  const items = Array.isArray(j) ? j : (j.data || j.phone_numbers || j.items || j.numbers || []);
  const match = items.filter(x => (x.phone_number || x.number) === number);
  if (!match.length) { console.error('No existing registration found for this number; registering fresh.'); return; }
  for (const m of match) {
    const id = m.phone_number_id || m.id;
    const d = await fetch(`https://api.x.ai/v2/phone-numbers/${encodeURIComponent(id)}`, { method: 'DELETE', headers: h });
    if (!d.ok && d.status !== 404) throw new Error(`Could not remove old registration ${id}: HTTP ${d.status} ${(await d.text()).slice(0, 200)}`);
    console.error(`Removed old registration ${id}.`);
  }
}
console.error(`Registering ${number} (${info.business}, ${carrier}) ...`);
(replace ? removeExisting() : Promise.resolve()).then(() => register(env)).then(secret => {
  console.log('\nSUCCESS. Copy the line between the arrows into Render > Environment > XAI_WEBHOOK_SECRETS:\n');
  console.log('>>>>>>>>>>');
  console.log(secret);
  console.log('<<<<<<<<<<\n');
  console.log('This is shown only once. Keep this tab open until it is saved in Render.');
}).catch(e => { console.error(e.message); process.exitCode = 1; });
