// Returns posted_hours: JSON weekday intervals, "24/7", or "" (weekends-only default).
// No fuzzy parsing: one invalid/contradictory entry discards the entire schedule.
const DAYS={sunday:'sun',monday:'mon',tuesday:'tue',wednesday:'wed',thursday:'thu',friday:'fri',saturday:'sat',sun:'sun',mon:'mon',tue:'tue',wed:'wed',thu:'thu',fri:'fri',sat:'sat'};
function clean(s){return String(s).replace(/[\u200e\u200f\u202a-\u202e]/g,'').replace(/[\u00a0\u202f]/g,' ').replace(/[–—−]/g,'-').trim();}
function time(s){
 s=clean(s).toLowerCase().replace(/\./g,'');
 if(s==='noon')return '12:00';if(s==='midnight')return '00:00';
 const m=s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);if(!m)throw Error('Invalid time');
 let h=+m[1],min=+(m[2]||0);if(min>59)throw Error('Invalid minute');
 if(m[3]){if(h<1||h>12)throw Error('Invalid hour');h=h%12+(m[3]==='pm'?12:0);}
 else if(!m[2]||h>23)throw Error('Ambiguous hour');
 return String(h).padStart(2,'0')+':'+String(min).padStart(2,'0');
}
function intervals(value){
 const s=clean(value);if(/^closed$/i.test(s))return [];
 // Two non-equal intervals represent a whole day without ambiguous 00:00-00:00.
 if(/^(open\s*)?24\s*hours$|^24\/7$/i.test(s))return ['00:00-12:00','12:00-00:00'];
 return s.split(/\s*(?:,|;|&)\s*/).map(part=>{
  const range=part.split(/\s+to\s+|\s*-\s*/i);if(range.length!==2)throw Error('Invalid range');
  const start=time(range[0]),end=time(range[1]);if(start===end)throw Error('Ambiguous equal interval');return start+'-'+end;
 });
}
function normalizeHours(openingHours){
 try {
  if(openingHours==null||openingHours==='')return '';
  if(typeof openingHours==='object'&&!Array.isArray(openingHours)){
   if('openingHours' in openingHours)return normalizeHours(openingHours.openingHours);
   if('weekdayDescriptions' in openingHours)return normalizeHours(openingHours.weekdayDescriptions);
   if('weekday_text' in openingHours)return normalizeHours(openingHours.weekday_text);
  }
  let entries;
  if(typeof openingHours==='string'){
   const s=clean(openingHours);if(/^(open\s*)?24\s*hours$|^24\/7$/i.test(s))return '24/7';
   if(s.startsWith('[')||s.startsWith('{'))return normalizeHours(JSON.parse(s));
   entries=s.split(/\r?\n/).filter(s=>s.trim());
  }else if(Array.isArray(openingHours))entries=openingHours;
  else if(typeof openingHours==='object')entries=Object.entries(openingHours).map(([day,hours])=>({day,hours}));
  else return '';
  if(!entries.length)return '';
  const result={};
  for(const entry of entries){
   let day,value;
   if(typeof entry==='string'){
    const m=clean(entry).match(/^([a-z]+)\s*:\s*(.+)$/i);if(!m)throw Error('Missing weekday');day=m[1];value=m[2];
   }else if(entry&&typeof entry==='object'&&!Array.isArray(entry)){
    day=entry.day;value=entry.hours;
   }else throw Error('Unsupported entry');
   const key=typeof day==='string'&&DAYS[day.toLowerCase().trim()];if(!key||key in result||typeof value!=='string')throw Error('Invalid/duplicate weekday');
   result[key]=intervals(value);if(!result[key].length&&!/^closed$/i.test(clean(value)))throw Error('Empty hours');
  }
  if(Object.keys(result).length===7&&Object.values(result).every(v=>v.join(',')==='00:00-12:00,12:00-00:00'))return '24/7';
  return JSON.stringify(result);
 }catch{return '';}
}
module.exports={normalizeHours};
