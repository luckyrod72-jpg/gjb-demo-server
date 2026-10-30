// Short form so it can be typed by hand in the Render web shell (pasting there inserts stray characters).
// Usage: node scripts/reg.js plumbing   (or hvac, roofing, electrical)
const { register } = require('./register-number.js');
const lines = require('../lines.js');
const CIDRS = {
  // Telnyx US SIP region signaling IPs (sip.telnyx.com)
  telnyx: '192.76.120.10/32,64.16.250.10/32',
  // Twilio Elastic SIP Trunking signaling, North America Virginia + Oregon
  twilio: '54.172.60.0/30,54.244.51.0/30',
};
const trade = (process.argv[2] || '').toLowerCase();
const entry = Object.entries(lines).find(([, v]) => v.trade === trade);
if (!entry) { console.error('Type one of: ' + Object.values(lines).map(v => v.trade).join(', ')); process.exit(1); }
const [number, info] = entry;
const carrier = info.carrier.startsWith('telnyx') ? 'telnyx' : 'twilio';
const base = process.env.RENDER_EXTERNAL_URL || 'https://gjb-demo-server.onrender.com';
const env = { ...process.env, XAI_PHONE_NUMBER: number, XAI_WEBHOOK_URL: base.replace(/\/$/, '') + '/webhooks/xai',
  XAI_SIP_ALLOWED_ADDRESSES: CIDRS[carrier], XAI_NUMBER_NAME: `GJB demo - ${info.business}` };
console.error(`Registering ${number} (${info.business}, ${carrier}) ...`);
register(env).then(secret => {
  console.log('\nSUCCESS. Copy the line below into Render > Environment > XAI_WEBHOOK_SECRETS:\n');
  console.log(secret + '\n');
}).catch(e => { console.error(e.message); process.exitCode = 1; });
