const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {Caller}=require('./service');const {identity}=require('./schedule');const {speech,OUTCOMES,outcome}=require('./outcome');const {carrier,silentTwiml,verify}=require('./carrier');
const row={business:'Fictional Roofer',phone:'+17025550100',time_zone:'America/Phoenix',posted_hours:'24/7'};row.id=identity(row);
const sid='CA'+'a'.repeat(32);
function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'caller-test-'));let dials=0,hangups=0;const c=new Caller({dir,clock:()=>new Date('2026-07-05T17:00:00Z'),setTimer:fn=>fn(),carrier:{dial:async()=>{dials++;return {sid};},hangup:async()=>{hangups++;}}});return {c,dir,counts:()=>({dials,hangups}),clean:()=>fs.rmSync(dir,{recursive:true,force:true})};}
test('exactly one attempt across duplicate requests and process restart',async()=>{const f=fixture();try{await Promise.all([f.c.start(row),f.c.start(row)]);assert.equal(f.counts().dials,1);const restarted=new Caller({dir:f.dir,carrier:{dial(){throw Error('must not dial');}}});assert.ok(restarted.claimed().has(row.id));assert.match((await restarted.start(row)).skipped,/Window|Already/);}finally{f.clean();}});
test('all six terminal outcomes log exactly three fields once; callbacks are idempotent',async()=>{
 for(const label of OUTCOMES){const f=fixture();try{await f.c.start(row);const state=f.c.active.get(row.id);state.label=label;const event={CallSid:sid,CallStatus:'completed',CallDuration:'12'};await f.c.event(row.id,'status',event);await f.c.event(row.id,'status',event);const result=JSON.parse(fs.readFileSync(path.join(f.dir,row.id+'.json')));assert.deepEqual(Object.keys(result).sort(),['duration','outcome','timestamp']);assert.equal(result.outcome,label);assert.equal(result.duration,12);}finally{f.clean();}}
});
test('person and AI detection immediately request hangup; transcripts never persisted',async()=>{
 for(const kind of ['human','ai']){const f=fixture();try{await f.c.start(row);await f.c.event(row.id,kind==='human'?'amd':'speech',kind==='human'?{CallSid:sid,AnsweredBy:'human'}:{CallSid:sid,TranscriptionData:JSON.stringify({transcript:'I am an AI receptionist, secret personal text'})});assert.equal(f.counts().hangups,1);assert.deepEqual(fs.readdirSync(f.dir),[row.id+'.claim']);}finally{f.clean();}}
});
test('greeting classifier covers generic, custom and full voicemail',()=>{
 assert.equal(speech('The wireless customer is unavailable. Leave a message.'),'Generic voicemail');
 assert.equal(speech('You have reached Fictional Roofer. Leave a message.','Fictional Roofer'),'Custom voicemail');
 assert.equal(speech('This mailbox is full.'),'Voicemail full');
});
test('unknown AMD is held for review, never fabricated as no answer',async()=>{const f=fixture();try{await f.c.start(row);await f.c.event(row.id,'amd',{CallSid:sid,AnsweredBy:'unknown'});await f.c.event(row.id,'status',{CallSid:sid,CallStatus:'completed',CallDuration:'20'});assert.equal(f.counts().hangups,1);assert.equal(f.c.active.get(row.id).needsReview,true);assert.equal(fs.existsSync(path.join(f.dir,row.id+'.json')),false);}finally{f.clean();}});
test('carrier request is silent, unrecorded, AMD enabled and hard capped; API entirely mocked',async()=>{
 const env={CALLER_CARRIER:'twilio',TWILIO_ACCOUNT_SID:'AC'+'a'.repeat(32),TWILIO_AUTH_TOKEN:'fixture',CALLER_ID:'+17025550101',CALLER_WEBHOOK_URL:'https://caller.example/hooks'};
 const p=carrier(env,async(url,o)=>{const b=new URLSearchParams(o.body);assert.equal(b.get('Record'),'false');assert.equal(b.get('MachineDetection'),'DetectMessageEnd');assert.equal(b.get('TimeLimit'),'20');assert.equal(b.get('MachineDetectionTimeout'),'20');assert.doesNotMatch(b.get('Twiml'),/<Say|<Play|<Record|<Gather|<Dial/);return Response.json({sid});});assert.equal((await p.dial(row)).sid,sid);
 assert.match(silentTwiml('https://example.com'),/<Pause length="20"\/><Hangup\/>/);assert.equal(verify('https://example.com',{},'bad','fixture'),false);
});
test('ambiguous carrier error retains claim and never retries',async()=>{const f=fixture();try{f.c.carrier.dial=async()=>{throw Error('timeout');};assert.ok((await f.c.start(row)).blocked);assert.ok((await f.c.start(row)).skipped);}finally{f.clean();}});
test('CLI defaults to no dialing and execute is gated before carrier initialization',()=>{const {main}=require('./index');assert.throws(()=>main([__dirname+'/example.csv'],{}),/dry-run/);assert.throws(()=>main([__dirname+'/example.csv','--execute'],{}),/Live execution disabled/);});

test('machine AMD alone and generic salutation do not invent classification',()=>{assert.equal(outcome({answeredBy:'machine_end_beep',status:'completed'}),null);assert.equal(speech('How can I help you?'),null);});
