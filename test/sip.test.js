const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { verifySignature, joinCall } = require('../server');
const { registration, register } = require('../scripts/register-number');
test('signature rejects malformed/stale/future timestamps and unknown versions', () => {
  for (const ts of ['NaN', 'Infinity', '', '1.2', String(Date.now()), '1']) {
    const sig = crypto.createHmac('sha256', 'key').update(`id.${ts}.body`).digest('base64');
    assert.equal(verifySignature('body', {'webhook-id':'id','webhook-timestamp':ts,'webhook-signature':`v1,${sig}`}, ['key']), false);
  }
  const ts = String(Math.floor(Date.now()/1000));
  const sig = crypto.createHmac('sha256', 'key').update(`id.${ts}.body`).digest('base64');
  const h = {'webhook-id':'id','webhook-timestamp':ts,'webhook-signature':`v2,${sig}`};
  assert.equal(verifySignature('body', h, ['key']), false);
  h['webhook-signature'] = `v1,bad v1,${sig}`;
  assert.equal(verifySignature('body', h, ['other','key']), true);
});
class Socket extends EventEmitter { constructor() { super(); this.sent=[]; } send(x) {this.sent.push(JSON.parse(x));} terminate(){this.ended=true;} }
const line = { business:'Fixture Roofing', trade:'roofing' };
const quiet = { error() {} };
test('session uses documented fields and greets only after session.updated', () => {
 const ws = joinCall('fixture', line, {Socket, log:quiet}); ws.emit('open');
 assert.equal(ws.sent.length, 1);
 assert.deepEqual(ws.sent[0].session.turn_detection, {type:'server_vad'});
 ws.emit('message', Buffer.from('{"type":"session.updated"}'));
 assert.deepEqual(ws.sent[1], {type:'response.create'});
 ws.emit('close');
});
test('failed handshake hangs up exactly once without uncaught rejection', async () => {
 let calls=0; const ws=joinCall('fixture', line, {Socket, log:quiet, request:async()=>{calls++;throw Error('offline');}});
 ws.emit('error', Error('failed')); ws.emit('close');
 await new Promise(r=>setImmediate(r)); assert.equal(calls,1); assert.ok(ws.ended);
});
test('join timeout and synchronous constructor failure fail safely', async () => {
 let calls=0; const request=async()=>{calls++;return {ok:true};};
 joinCall('fixture',line,{Socket,request,log:quiet,timeoutMs:5});
 await new Promise(r=>setTimeout(r,15)); assert.equal(calls,1);
 class Broken { constructor(){throw Error('bad');} }
 joinCall('fixture',line,{Socket:Broken,request,log:quiet});
 await new Promise(r=>setImmediate(r)); assert.equal(calls,2);
});
test('registration uses Direct SIP endpoint and prints no entire API response', async () => {
 const env={XAI_API_KEY:'fixture',XAI_PHONE_NUMBER:'+17025550100',XAI_WEBHOOK_URL:'https://demo.example/webhooks/xai',XAI_SIP_ALLOWED_ADDRESSES:'192.0.2.0/24'};
 assert.equal(registration(env).origin,'byo_trunk');
 const secret=await register(env,async(url,opt)=>{assert.equal(url,'https://api.x.ai/v2/phone-numbers');assert.equal(JSON.parse(opt.body).phone_number,env.XAI_PHONE_NUMBER);return Response.json({webhook:{signing_secret:'fixture-secret'}});});
 assert.equal(secret,'fixture-secret');
 assert.throws(()=>registration({...env,XAI_SIP_ALLOWED_ADDRESSES:'0.0.0.0/0'}));
 await assert.rejects(register(env,async()=>new Response('',{status:401})),/HTTP 401/);
});
