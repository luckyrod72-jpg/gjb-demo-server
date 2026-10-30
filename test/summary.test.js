const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { joinCall } = require('../server');
const { buildSummary, sendSummary, SAVE_JOB_TOOL } = require('../summary');
class Socket extends EventEmitter { constructor() { super(); this.sent=[]; } send(x) {this.sent.push(JSON.parse(x));} terminate(){this.ended=true;} }
const line = { business: 'Copperline Plumbing', trade: 'plumbing', ownerEmail: 'owner@example.com' };
const quiet = { error() {}, warn() {}, log() {} };
const msg = (ws, o) => ws.emit('message', Buffer.from(JSON.stringify(o)));

test('session declares the save_job_request tool', () => {
  const ws = joinCall('c1', line, { Socket, log: quiet }); ws.emit('open');
  assert.equal(ws.sent[0].session.tools[0].name, 'save_job_request');
  assert.deepEqual(SAVE_JOB_TOOL.parameters.required, ['caller_name', 'callback_number', 'problem', 'urgency']);
});

test('tool call is acknowledged, and the owner is emailed the job when the call ends', async () => {
  const sent = [];
  const ws = joinCall('c2', line, { Socket, log: quiet, mail: async (s, o) => { sent.push({ s, o }); return { sent: true }; } });
  ws.emit('open'); msg(ws, { type: 'session.updated' });
  msg(ws, { type: 'conversation.item.input_audio_transcription.completed', transcript: 'My water heater is leaking' });
  msg(ws, { type: 'response.function_call_arguments.done', name: 'save_job_request', call_id: 'fc1',
    arguments: JSON.stringify({ caller_name: 'Dana Ruiz', callback_number: '702-555-0199', problem: 'Water heater leaking', urgency: 'soon' }) });
  const ack = ws.sent.find(e => e.type === 'conversation.item.create');
  assert.equal(ack.item.type, 'function_call_output'); assert.equal(ack.item.call_id, 'fc1');
  assert.equal(ws.sent.at(-1).type, 'response.create');
  msg(ws, { type: 'response.function_call_arguments.done', name: 'save_job_request', call_id: 'fc2', arguments: JSON.stringify({ service_address: '123 Main St, Las Vegas 89139' }) });
  ws.emit('close'); await new Promise(r => setImmediate(r));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].o.to, 'owner@example.com');
  assert.match(sent[0].s.subject, /Dana Ruiz/);
  assert.match(sent[0].s.text, /123 Main St/);
  assert.match(sent[0].s.text, /Caller: My water heater is leaking/);
  ws.emit('close'); await new Promise(r => setImmediate(r));
  assert.equal(sent.length, 1, 'only one email per call');
});

test('silent hang-ups send nothing; emergencies are flagged in the subject', async () => {
  const sent = [];
  const ws = joinCall('c3', line, { Socket, log: quiet, mail: async (s) => sent.push(s) });
  ws.emit('open'); msg(ws, { type: 'session.updated' }); ws.emit('close');
  await new Promise(r => setImmediate(r));
  assert.equal(sent.length, 0);
  const s = buildSummary({ line, job: { caller_name: 'Al', callback_number: '1', problem: 'Gas smell', urgency: 'emergency' }, startedAt: 0, endedAt: 95000 });
  assert.match(s.subject, /EMERGENCY/); assert.match(s.text, /1m 35s/);
  assert.doesNotMatch(buildSummary({ line, job: { caller_name: '<b>x</b>', callback_number: '1', problem: 'p', urgency: 'routine' } }).html, /<b>x<\/b>/);
});

test('sendSummary posts to Resend only with full config', async () => {
  const calls = [];
  const request = async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return { ok: true }; };
  assert.deepEqual(await sendSummary({ subject: 's', text: 't', html: 'h' }, { to: 'a@b.c', env: {}, request, log: quiet }), { sent: false });
  const r = await sendSummary({ subject: 's', text: 't', html: 'h' }, { to: 'a@b.c', env: { RESEND_API_KEY: 'k', SUMMARY_FROM: 'GJB <calls@getjobsbooked.co>' }, request, log: quiet });
  assert.equal(r.sent, true); assert.equal(calls[0].url, 'https://api.resend.com/emails'); assert.deepEqual(calls[0].body.to, ['a@b.c']);
});
