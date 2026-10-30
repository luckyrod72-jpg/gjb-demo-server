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
async function register(env = process.env, request = fetch) {
  const body = registration(env);
  const r = await request('https://api.x.ai/v2/phone-numbers', { method: 'POST', headers: { Authorization: `Bearer ${env.XAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Number registration failed: HTTP ${r.status}; response omitted to protect secrets. Do not retry blindly.`);
  const result = await r.json();
  const secret = result.webhook?.signing_secret || result.webhook?.secret;
  if (!secret) throw new Error('Registration succeeded but signing secret was not in the expected webhook field; inspect securely in the account. Do not re-register.');
  return secret;
}
if (require.main === module) register().then(secret => process.stdout.write(secret + '\n')).catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { registration, register };
