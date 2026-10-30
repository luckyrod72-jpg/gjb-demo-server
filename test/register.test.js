const test = require('node:test');
const assert = require('node:assert');
const { findSecret, registration } = require('../scripts/register-number.js');
test('finds secret in documented and alternate shapes', () => {
  assert.equal(findSecret({ webhook: { signing_secret: 'a' } }), 'a');
  assert.equal(findSecret({ webhook: { secret: 'b' } }), 'b');
  assert.equal(findSecret({ webhook_signing_secret: 'c' }), 'c');
  assert.equal(findSecret({ data: { webhook: { signingSecret: 'd' } } }), 'd');
  assert.equal(findSecret({ webhook: { url: 'x' } }), null);
});
test('builds documented byo_trunk body', () => {
  const b = registration({ XAI_API_KEY: 'k', XAI_WEBHOOK_URL: 'https://gjb-demo-server.onrender.com/webhooks/xai', XAI_PHONE_NUMBER: '+17026028867', XAI_SIP_ALLOWED_ADDRESSES: '192.76.120.10/32, 64.16.250.10/32' });
  assert.deepEqual(b.sip_auth.allowed_addresses, ['192.76.120.10/32', '64.16.250.10/32']);
  assert.equal(b.origin, 'byo_trunk');
});
