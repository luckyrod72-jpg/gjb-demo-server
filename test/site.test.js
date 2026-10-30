const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'site', 'index.html'), 'utf8');
const text = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

test('landing page never claims it books appointments', () => {
  const claims = text.replace('Does it book appointments?', '');
  assert.doesNotMatch(claims, /\b(we|it|receptionist|AI) (book|books|schedules?)\b/i);
  assert.doesNotMatch(text, /appointments? (booked|scheduled) (for you|automatically)/i);
  assert.match(text, /Does it book appointments\? No\./);
});

test('plans match the decided tiers and Buy buttons are consistent placeholders or all real', () => {
  for (const [p, m] of [['199', '350'], ['399', '750'], ['699', '1,400']]) assert.match(text, new RegExp(`\\$${p} ?/mo ${m} minutes a month`));
  assert.match(text, /No setup fee/); assert.match(text, /Two-week trial on your own business line/); assert.match(text, /nothing is billed until you say OK/);
  const buys = [...html.matchAll(/<a [^>]*data-plan="(\d+)"[^>]*>/g)].map(m => m[0]);
  assert.equal(buys.length, 3);
  const placeholders = buys.filter(b => /href="#STRIPE_LINK_\d+"/.test(b)).length;
  assert.ok(placeholders === 0 || placeholders === 3, 'replace all three Stripe links together');
  if (placeholders === 0) for (const b of buys) assert.match(b, /href="https:\/\/buy\.stripe\.com\//);
});

test('every demo number on the page is a real demo line, and the live one is the CTA', () => {
  const lines = require('../lines');
  const nums = [...html.matchAll(/href="tel:(\+\d+)"/g)].map(m => m[1]);
  for (const n of new Set(nums)) assert.ok(lines[n], `${n} is not a server line`);
  assert.equal(new Set(nums).size, Object.keys(lines).length);
  assert.match(html, /data-live="true"><span class="trade">Plumbing/);
});
