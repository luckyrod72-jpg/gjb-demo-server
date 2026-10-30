const test=require('node:test');const assert=require('node:assert/strict');
const {allowed,schedule,csv,identity}=require('./schedule');
const row={business:'Fictional roofer',phone:'+17025550100',time_zone:'America/Phoenix',posted_hours:JSON.stringify({mon:['08:00-19:00'],tue:['08:00-19:00'],wed:['08:00-19:00'],thu:['08:00-19:00'],fri:['08:00-19:00']})};
const check=(date,expected,r=row)=>assert.equal(allowed(r,new Date(date)),expected,date);
test('Phoenix has no DST in winter or summer, 8 inclusive and 21 exclusive',()=>{
 for(const day of ['2026-01-04','2026-07-05']){check(day+'T14:59:00Z',false);check(day+'T15:00:00Z',true);}
 check('2026-07-06T03:59:00Z',true);check('2026-07-06T04:00:00Z',false);
});
test('7pm close is ineligible at 18:59, eligible at 19:00 and before 21:00',()=>{
 check('2026-07-07T01:59:00Z',false);check('2026-07-07T02:00:00Z',true);check('2026-07-07T04:00:00Z',false);
});
test('Sunday explicitly closed and omitted days closed',()=>{
 check('2026-07-05T17:00:00Z',true);check('2026-07-06T17:00:00Z',false);
});
test('24/7 gets exactly one call in permitted local window',()=>{
 const r={...row,posted_hours:'24/7'};check('2026-07-06T17:00:00Z',true,r);check('2026-07-06T14:00:00Z',false,r);
 assert.equal(schedule([r,r],{now:new Date('2026-07-06T00:00:00Z')}).calls.length,1);
});
test('no posted hours: weekends only, even weekday evening closed hours are excluded',()=>{
 const r={...row,posted_hours:''};check('2026-07-07T02:00:00Z',false,r);check('2026-07-05T17:00:00Z',true,r);check('2026-07-05T14:59:00Z',false,r);
});
test('overnight hours carry into next day; split shifts and exact close',()=>{
 const r={...row,posted_hours:{sat:['20:00-10:00'],sun:['12:00-13:00','18:00-19:00']}};
 check('2026-07-05T16:00:00Z',false,r);check('2026-07-05T17:00:00Z',true,r);check('2026-07-05T19:00:00Z',false,r);check('2026-07-05T20:00:00Z',true,r);
});
test('DST-observing zones evaluate actual local wall clock',()=>{
 const r={...row,time_zone:'America/New_York',posted_hours:'24/7'};
 check('2026-01-04T13:00:00Z',true,r);check('2026-07-05T12:00:00Z',true,r);check('2026-07-05T11:59:00Z',false,r);
});
test('scheduler spreads seven days, enforces spacing, dedupes and honors persistent claims',()=>{
 const rows=Array.from({length:28},(_,i)=>({...row,business:'Fictional business '+i,posted_hours:'24/7',phone:'+1702555'+String(1000+i)}));
 const now=new Date('2026-07-05T00:00:00Z');const p=schedule(rows,{now,callsPerHour:2});
 assert.equal(p.calls.length,28);assert.equal(new Set(p.calls.map(x=>x.at.slice(0,10))).size,7);
 p.calls.forEach((r,i)=>{assert.ok(allowed(r,new Date(r.at)));assert.ok(Date.parse(r.at)<+now+7*86400000);if(i)assert.ok(Date.parse(r.at)-Date.parse(p.calls[i-1].at)>=1800000);});
 assert.equal(schedule(rows,{now,claimed:new Set([identity(rows[0])])}).calls.length,27);
});
test('CSV handles quoted JSON/commas and rejects malformed or ambiguous hours',()=>{
 const fs=require('node:fs');const rows=csv(fs.readFileSync(__dirname+'/example.csv','utf8'));assert.equal(rows.length,3);assert.ok(schedule(rows).calls.length);
 assert.throws(()=>schedule([{...row,time_zone:'invalid'}]));assert.throws(()=>schedule([{...row,posted_hours:'Mon-Fri 8-5'}]));assert.throws(()=>csv('wrong,header\n'));
});

test('same business with alternate number still receives one attempt',()=>{const p=schedule([{...row,posted_hours:'24/7'},{...row,phone:'+17025550101',posted_hours:'24/7'}]);assert.equal(p.calls.length,1);});
