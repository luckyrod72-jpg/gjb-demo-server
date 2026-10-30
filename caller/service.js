const fs=require('node:fs');const path=require('node:path');
const {allowed}=require('./schedule');const {speech,outcome}=require('./outcome');
class Caller {
 constructor({carrier,dir,clock=()=>new Date(),setTimer=setTimeout}){this.carrier=carrier;this.dir=dir;this.clock=clock;this.setTimer=setTimer;this.active=new Map();fs.mkdirSync(dir,{recursive:true,mode:0o700});}
 claimed(){return new Set(fs.readdirSync(this.dir).filter(x=>x.endsWith('.claim')).map(x=>x.slice(0,-6)));}
 async start(row){
  if(!allowed(row,this.clock()))return {skipped:'Window closed; never catch up outside permitted hours'};
  if(!/^[a-f0-9]{64}$/.test(row.id))throw Error('Invalid identity');
  try{fs.closeSync(fs.openSync(path.join(this.dir,row.id+'.claim'),'wx',0o600));}catch(e){if(e.code==='EEXIST')return {skipped:'Already attempted'};throw e;}
  const state={business:row.business,start:+this.clock(),label:null,answeredBy:null,sid:null};this.active.set(row.id,state);
  // Claim precedes network submission; ambiguous failures are never automatically redialed.
  try{const call=await this.carrier.dial(row);state.sid=call.sid;return {attempted:true};}
  catch{state.error=true;return {blocked:'Carrier submission ambiguous; claim retained; inspect account manually, do not retry'};}
 }
 async event(id,event,data){
  const s=this.active.get(id);if(!s)return;const sid=data.CallSid;
  if(s.sid&&sid!==s.sid)return;if(!s.sid&&sid)s.sid=sid;
  if(event==='speech'){
   let text='';try{text=JSON.parse(data.TranscriptionData||'{}').transcript||'';}catch{}
   const label=speech(text,s.business); // transient; neither data nor text is stored
   if(label){s.label=label;if(['AI or answering service answered','Voicemail full'].includes(label))await this.stop(s);}
  }
  if(event==='amd'){
   s.answeredBy=data.AnsweredBy;
   if(data.AnsweredBy==='human'||data.AnsweredBy==='fax'||data.AnsweredBy==='unknown'||String(data.AnsweredBy).startsWith('machine_end'))await this.stop(s);
  }
  if(event==='status'&&['completed','busy','no-answer','failed','canceled'].includes(data.CallStatus)){
   if(s.finalizing)return;s.finalizing=true;
   this.setTimer(()=>{this.finish(id,data);},2000); // tolerate reordered final classification callback
  }
 }
 async stop(s){if(s.stopping||!s.sid)return;s.stopping=true;try{await this.carrier.hangup(s.sid);}catch{s.stopFailed=true;/* carrier TimeLimit and silent TwiML remain the independent bound */}}
 finish(id,data){
  const s=this.active.get(id);if(!s)return;
  const label=outcome({label:s.label,answeredBy:s.answeredBy,status:data.CallStatus});
  if(!label){s.needsReview=true;return;} // never invent one of the six outcomes for unknown AMD
  const n=Number(data.CallDuration);const duration=Number.isFinite(n)&&n>=0?n:Math.max(0,Math.round((+this.clock()-s.start)/1000));
  const result={outcome:label,duration,timestamp:this.clock().toISOString()};
  try{fs.writeFileSync(path.join(this.dir,id+'.json'),JSON.stringify(result)+'\n',{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
  this.active.delete(id);
 }
}
module.exports={Caller};
