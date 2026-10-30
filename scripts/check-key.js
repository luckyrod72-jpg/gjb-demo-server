// Diagnose the xAI key without ever printing it. Usage: node scripts/check-key.js
const raw = process.env.XAI_API_KEY || '';
const key = raw.trim();
console.log('Key present:', raw.length > 0, '| length:', raw.length);
console.log('Starts with "xai-":', key.startsWith('xai-'));
console.log('Extra spaces/newlines around it:', raw !== key);
console.log('Quote marks inside:', /["']/.test(raw));
(async () => {
  const h = { Authorization: `Bearer ${raw}` };
  try {
    const r = await fetch('https://api.x.ai/v1/api-key', { headers: h });
    console.log('Key check (v1/api-key): HTTP', r.status);
    if (r.ok) {
      const j = await r.json();
      for (const k of ['name', 'team_blocked', 'api_key_blocked', 'api_key_disabled', 'acls']) if (k in j) console.log(' ', k + ':', JSON.stringify(j[k]));
    }
    const p = await fetch('https://api.x.ai/v2/phone-numbers', { headers: h });
    console.log('Phone numbers list (v2/phone-numbers): HTTP', p.status);
    if (!p.ok) console.log(' ', (await p.text()).slice(0, 300).replace(/xai-[A-Za-z0-9]+/g, '[key]'));
  } catch (e) { console.log('Network error:', e.message); }
})();
