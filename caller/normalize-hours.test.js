const test=require('node:test');const assert=require('node:assert/strict');
const {normalizeHours}=require('./normalize-hours');const {allowed}=require('./schedule');
const parse=x=>JSON.parse(normalizeHours(x));
test('Google weekday descriptions, AM/PM, noon and midnight',()=>{
 assert.deepEqual(parse(['Monday: 7 AM to 6 PM','Tuesday: 12 AM to 12 PM','Wednesday: noon to midnight','Sunday: Closed']),{mon:['07:00-18:00'],tue:['00:00-12:00'],wed:['12:00-00:00'],sun:[]});
 assert.deepEqual(parse({weekdayDescriptions:['Monday: 7:30 AM–6:15 PM']}),{mon:['07:30-18:15']});
 assert.deepEqual(parse({weekday_text:['Monday: 07:00-18:00']}),{mon:['07:00-18:00']});
});
test('Apify day/hours objects, JSON serialization, overnight and split shifts',()=>{
 const input=[{day:'Monday',hours:'7 AM to 11 AM, 1 PM to 6 PM'},{day:'Saturday',hours:'10 PM to 2 AM'},{day:'Sunday',hours:'Closed'}];
 assert.deepEqual(parse({openingHours:input}),{mon:['07:00-11:00','13:00-18:00'],sat:['22:00-02:00'],sun:[]});
 assert.equal(normalizeHours(JSON.stringify(input)),normalizeHours(input));
 assert.deepEqual(parse({Monday:'7 AM to 6 PM'}),{mon:['07:00-18:00']});
});
test('Open 24 hours preserves per-day opening; all seven days become 24/7',()=>{
 assert.equal(normalizeHours('Open 24 hours'),'24/7');
 const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
 assert.equal(normalizeHours(days.map(day=>({day,hours:'Open 24 hours'}))),'24/7');
 const h=normalizeHours([{day:'Monday',hours:'Open 24 hours'},{day:'Sunday',hours:'Closed'}]);
 const row={time_zone:'America/Phoenix',posted_hours:h};assert.equal(allowed(row,new Date('2026-07-06T17:00:00Z')),false);assert.equal(allowed(row,new Date('2026-07-05T17:00:00Z')),true);
});
test('Unicode spaces, compact times and dotted meridiems normalize',()=>{
 assert.deepEqual(parse(['Friday: 7\u202fAM–6\u00a0PM','Saturday: 9a.m.-5p.m.']),{fri:['07:00-18:00'],sat:['09:00-17:00']});
});
test('unparseable or contradictory hours discard whole schedule to weekends-only default',()=>{
 for(const input of [undefined,null,[],{},'Closed','By appointment','Monday: 7 to 6 PM','Monday: 25:00-26:00',['Monday: 7 AM to 6 PM','Tuesday: Call for hours'],['Monday: Closed','Monday: Open 24 hours'],['Someday: Closed'],[{day:'Monday',hours:null}],['Monday: 12 AM-12 AM']]){
  assert.equal(normalizeHours(input),'');
  const row={time_zone:'America/Phoenix',posted_hours:normalizeHours(input)};
  assert.equal(allowed(row,new Date('2026-07-07T02:00:00Z')),false);assert.equal(allowed(row,new Date('2026-07-05T17:00:00Z')),true);
 }
});
test('default CLI dry-run accepts Apify JSON without initializing carrier or writing state',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const {main}=require('./index');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hours-import-'));const file=path.join(dir,'input.json');
 fs.writeFileSync(file,JSON.stringify([{business:'Fictional Import',phone:'+17025550100',time_zone:'America/Phoenix',openingHours:[{day:'Monday',hours:'unparseable'}]}]));
 const write=process.stdout.write;let output='';process.stdout.write=x=>{output+=x;return true;};
 try{const plan=main([file,'--opening-hours-json'],{CALLER_STATE_DIR:path.join(dir,'state')});assert.equal(plan.calls.length,1);assert.equal(plan.calls[0].posted_hours,'');assert.equal(JSON.parse(output).dryRun,true);assert.equal(fs.existsSync(path.join(dir,'state')),false);}finally{process.stdout.write=write;fs.rmSync(dir,{recursive:true,force:true});}
});
