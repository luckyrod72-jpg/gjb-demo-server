const {createHmac,timingSafeEqual}=require('node:crypto');
function verify(url,params,signature,token){
 if(!signature||!token)return false;
 const signed=url+Object.keys(params).sort().map(k=>k+params[k]).join('');
 const a=Buffer.from(createHmac('sha1',token).update(signed).digest('base64')),b=Buffer.from(signature);
 return a.length===b.length&&timingSafeEqual(a,b);
}
function silentTwiml(){return '<Response><Pause length="20"/><Hangup/></Response>';}
function carrier(env,request=fetch){
 if(env.CALLER_CARRIER!=='twilio')throw Error('Set CALLER_CARRIER=twilio (only implemented carrier)');
 const {TWILIO_ACCOUNT_SID:account,TWILIO_AUTH_TOKEN:token,CALLER_ID:from,CALLER_WEBHOOK_URL:base}=env;
 if(!/^AC[0-9a-f]{32}$/i.test(account||'')||!token||!/^\+[1-9]\d{7,14}$/.test(from||''))throw Error('Twilio account, auth token and real E.164 CALLER_ID required');
 const u=new URL(base);if(u.protocol!=='https:'||u.search||u.hash||u.username||u.password)throw Error('HTTPS CALLER_WEBHOOK_URL without query/credentials required');
 async function api(path,body){const r=await request(`https://api.twilio.com/2010-04-01/Accounts/${account}/${path}`,{method:'POST',headers:{Authorization:'Basic '+Buffer.from(account+':'+token).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body),signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error(`Carrier HTTP ${r.status}; no automatic retry`);return r.json();}
 const hook=(id,event)=>`${u.origin}${u.pathname.replace(/\/$/,'')}/${id}/${event}`;
 return {
  hook,
  verify:(path,params,sig)=>verify(u.origin+path,params,sig,token),
  dial:(row)=>api('Calls.json',{To:row.phone,From:from,MachineDetection:'Enable',MachineDetectionTimeout:'20',AsyncAmd:'true',AsyncAmdStatusCallback:hook(row.id,'amd'),Twiml:silentTwiml(),StatusCallback:hook(row.id,'status'),StatusCallbackEvent:'completed',Timeout:'20',TimeLimit:'20',Record:'false'}),
  startTranscription:(sid,id)=>{if(!/^CA[0-9a-f]{32}$/i.test(sid||'')||!/^[a-f0-9]{64}$/.test(id||''))throw Error('Invalid call identity');return api(`Calls/${sid}/Transcriptions.json`,{Track:'inbound_track',StatusCallbackUrl:hook(id,'speech'),StatusCallbackMethod:'POST',PartialResults:'true',EnableProviderData:'false'});},
  hangup:sid=>{if(!/^CA[0-9a-f]{32}$/i.test(sid||''))throw Error('Invalid call SID');return api(`Calls/${sid}.json`,{Status:'completed'});}
 };
}
module.exports={carrier,verify,silentTwiml};
