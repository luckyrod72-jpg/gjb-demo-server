const {createHash}=require('node:crypto');
const formatters=new Map();
const DAYS=['sun','mon','tue','wed','thu','fri','sat'];
function local(date,zone){
 if(!formatters.has(zone))formatters.set(zone,new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}));
 const p=Object.fromEntries(formatters.get(zone).formatToParts(date).map(x=>[x.type,x.value]));
 return {day:DAYS.indexOf(p.weekday.toLowerCase()),minute:Number(p.hour)*60+Number(p.minute)};
}
function clock(s){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(s))throw Error('Hours require HH:MM');return +s.slice(0,2)*60+ +s.slice(3);}
function hours(value){
 if(value==null||value==='')return null;
 if(/^(24\/7|24 hours)$/i.test(value))return '24/7';
 let h;if(typeof value==='object')h=value;else {try{h=JSON.parse(value);}catch{throw Error('posted_hours must be 24/7 or JSON weekday intervals; do not guess ambiguous hours');}}
 if(!h||Array.isArray(h))throw Error('Invalid posted hours');
 const parsed={};for(const [d,ranges] of Object.entries(h)){
  if(!DAYS.includes(d.toLowerCase())||!Array.isArray(ranges))throw Error('Use sun..sat arrays (empty means closed)');
  parsed[d.toLowerCase()]=ranges.map(r=>{if(typeof r!=='string'||!r.includes('-'))throw Error('Use HH:MM-HH:MM');const [a,b,...extra]=r.split('-');if(extra.length)throw Error('Invalid interval');const start=clock(a),end=clock(b);if(start===end)throw Error('Equal hours ambiguous; use 24/7');return [start,end];});
 }
 // Every omitted weekday is closed; specify all known opening intervals.
 return parsed;
}
function allowed(row,date){
 const {day,minute}=local(date,row.time_zone);if(minute<480||minute>=1260)return false;
 const h=hours(row.posted_hours);if(h===null)return day===0||day===6;if(h==='24/7')return true;
 const today=h[DAYS[day]]||[],yesterday=h[DAYS[(day+6)%7]]||[];
 const open=today.some(([a,b])=>a<b?minute>=a&&minute<b:minute>=a)||yesterday.some(([a,b])=>a>b&&minute<b);
 return !open;
}
function identity(row){return createHash('sha256').update(row.business.trim().toLowerCase().replace(/\s+/g,' ')).digest('hex');}
function validate(row){
 if(!row.business||!/^\+[1-9]\d{7,14}$/.test(row.phone||''))throw Error('Business name and E.164 phone required');
 local(new Date(),row.time_zone);if(!row.time_zone)throw Error('Explicit IANA time_zone required');hours(row.posted_hours);return row;
}
function schedule(rows,{now=new Date(),days=7,callsPerHour=4,claimed=new Set()}={}){
 if(!Number.isInteger(days)||days<1||days>31||!Number.isInteger(callsPerHour)||callsPerHour<1||callsPerHour>60)throw Error('days 1..31 and callsPerHour 1..60 required');
 const start=Math.ceil(+now/60000)*60000,end=+now+days*86400000,spacing=3600000/callsPerHour,seen=new Set(claimed),phones=new Set(),booked=[],unscheduled=[];
 const dayLoads=Array(days).fill(0);
 for(const row of rows){validate(row);const id=identity(row);if(seen.has(id)||phones.has(row.phone))continue;seen.add(id);phones.add(row.phone);let best;
  // Choose the least loaded UTC day, with stable earliest eligible slots within it.
  for(let d=0;d<days;d++){
   if(best&&dayLoads[d]>best.load)continue;
   const a=start+d*86400000,b=Math.min(a+86400000,end);
   for(let t=a;t<b;t+=60000){if(!allowed(row,new Date(t))||booked.some(x=>Math.abs(+new Date(x.at)-t)<spacing))continue;
    if(!best||dayLoads[d]<best.load)best={t,load:dayLoads[d],d};break;
   }
  }
  if(best){dayLoads[best.d]++;booked.push({id,...row,at:new Date(best.t).toISOString()});}else unscheduled.push({business:row.business,reason:'No eligible closed-hours slot in horizon'});
 }
 return {calls:booked.sort((a,b)=>a.at.localeCompare(b.at)),unscheduled};
}
function csv(text){
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(!quoted&&(c===','||c==='\n')){row.push(cell.replace(/\r$/,''));cell='';if(c==='\n'){if(row.some(Boolean))rows.push(row);row=[];}}else cell+=c;}
 if(quoted)throw Error('Unclosed CSV quote');if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}
 const header=rows.shift();if(!header||header.join(',')!=='business,phone,time_zone,posted_hours')throw Error('Expected business,phone,time_zone,posted_hours header');
 return rows.map(r=>{if(r.length!==4)throw Error('CSV column count mismatch');return Object.fromEntries(header.map((h,i)=>[h,r[i]]));});
}
module.exports={local,hours,allowed,identity,validate,schedule,csv};
