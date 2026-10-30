// Deliberately not run by npm start/test. Registration changes the xAI account.
function registration(env) {
  const { XAI_API_KEY, XAI_WEBHOOK_URL, XAI_PHONE_NUMBER, XAI_SIP_ALLOWED_ADDRESSES } = env;
  if (!XAI_API_KEY || !XAI_WEBHOOK_URL || !XAI_PHONE_NUMBER || !XAI_SIP_ALLOWED_ADDRESSES)
    throw new Error('Set XAI_API_KEY, XAI_WEBHOOK_URL, XAI_PHONE_NUMBER and XAI_SIP_ALLOWED_ADDRESSES');
  const url = new URL(XAI_WEBHOOK_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Webhook must be a public HTTPS URL without credentials/query/fragment');
  if (!/^\+[1-9]\d{7,14}$/.test(XAI_PHONE_NUMBER)) throw new Error('One E.164 number required');
  const addresses = XAI_SIP_ALLOWED_ADDRESSES.split(',').map(x => x.trim());
  if (addresses.some(x => !/^([0-9.]+|[a-fA-F0-9:]+)\/\d{1,3}$/.test(x) || /\/0$/.test(x))) throw new Error('Explicit carrier signaling CIDRs required; no open allowlist');
  return { origin: 'byo_trunk', name: env.XAI_NUMBER_NAME || 'Get Jobs Booked demo', phone_number: XAI_PHONE_NUMBER,
    webhook: { name: 'Get Jobs Booked incoming SIP', url: url.href }, sip_auth: { allowed_addresses: addresses } };
}
function findSecret(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const direct = obj.webhook?.signing_secret || obj.webhook?.secret || obj.signing_secret || obj.webhook_signing_secret;
  if (typeof direct === 'string' && direct) return direct;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && v && /secret/i.test(k)) return v;
    if (v && typeof v === 'object') { const f = findSecret(v); if (f) return f; }
  }
  return null;
}
async function register(env = process.env, request = fetch) {
  const body = registration(env);
  const r = await request('https://api.x.ai/v2/phone-numbers', { method: 'POST', headers: { Authorization: `Bearer ${env.XAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Number registration failed: HTTP ${r.status}; response omitted to protect secrets. Do not retry blindly.`);
  const result = await r.json();
  const secret = findSecret(result);
  if (!secret) {
    // xAI shows the secret only once, so never lose it: print the raw response to this shell only.
    console.error('Registration succeeded but no secret field was recognised. Raw response below; copy the signing secret from it into XAI_WEBHOOK_SECRETS. Do not re-register.');
    console.error(JSON.stringify(result, null, 2));
    throw new Error('Secret not auto-detected (see raw response above).');
  }
  return secret;
}
if (require.main === module) register().then(secret => process.stdout.write(secret + '\n')).catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { registration, register, findSecret };
