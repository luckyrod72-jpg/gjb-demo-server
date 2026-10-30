#!/usr/bin/env node
const fs=require('node:fs');const http=require('node:http');const path=require('node:path');
const {csv,schedule}=require('./schedule');const {carrier}=require('./carrier');const {Caller}=require('./service');
function main(argv=process.argv.slice(2),env=process.env){
 const file=argv.find(x=>!x.startsWith('--'));if(!file)throw Error('Usage: node caller/index.js input.csv --dry-run [--days=7] [--calls-per-hour=4]');
 const execute=argv.includes('--execute');
 if(execute&&(!['true'].includes(env.CALLER_ENABLE_LIVE)||env.CALLER_PROVIDER_RETENTION_VERIFIED!=='true'||env.CALLER_CLASSIFICATION_VALIDATED!=='true'))throw Error('Live execution disabled: requires separate operator validation of carrier retention and outcome classification');
 if(!execute&&!argv.includes('--dry-run'))throw Error('Specify --dry-run; no implicit dialing');
 const opt=(name,fallback)=>Number((argv.find(x=>x.startsWith('--'+name+'='))||'').split('=')[1]||fallback);
 const rows=csv(fs.readFileSync(file,'utf8'));const dir=env.CALLER_STATE_DIR||path.resolve('caller-state');
 const claimed=fs.existsSync(dir)?new Set(fs.readdirSync(dir).filter(x=>x.endsWith('.claim')).map(x=>x.slice(0,-6))):new Set();
 const plan=schedule(rows,{days:opt('days',7),callsPerHour:opt('calls-per-hour',env.CALLER_CALLS_PER_HOUR||4),claimed});
 if(!execute){process.stdout.write(JSON.stringify({dryRun:true,...plan},null,2)+'\n');return plan;}
 const provider=carrier(env),worker=new Caller({carrier:provider,dir});
 const base=new URL(env.CALLER_WEBHOOK_URL).pathname.replace(/\/$/,'');
 const server=http.createServer(async(req,res)=>{
  const match=(req.url||'').match(new RegExp('^'+base.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'/([a-f0-9]{64})/(amd|speech|status)$'));
  if(req.method!=='POST'||!match){res.writeHead(404);return res.end();}
  let body='';for await(const chunk of req){body+=chunk;if(body.length>64000){res.writeHead(413);return res.end();}}
  const params=Object.fromEntries(new URLSearchParams(body));
  if(!provider.verify(req.url,params,req.headers['x-twilio-signature'])){res.writeHead(401);return res.end();}
  try{await worker.event(match[1],match[2],params);res.writeHead(204);res.end();}catch{res.writeHead(503);res.end();}
 });server.listen(Number(env.CALLER_PORT||3001),'127.0.0.1');
 const pending=new Map(plan.calls.map(r=>[r.id,r]));let running=false,nextDialAt=0;const spacing=3600000/opt('calls-per-hour',env.CALLER_CALLS_PER_HOUR||4);
 const tick=async()=>{if(running)return;running=true;try{for(const [id,row]of pending){if(Date.parse(row.at)>Date.now())continue;pending.delete(id);if(Date.now()-Date.parse(row.at)>60000||Date.now()<nextDialAt)continue;nextDialAt=Date.now()+spacing;await worker.start(row);}}finally{running=false;}};
 const timer=setInterval(()=>void tick(),1000);
 process.once('SIGTERM',()=>{clearInterval(timer);for(const s of worker.active.values())void worker.stop(s);server.close();});
 return {plan,worker,server};
}
if(require.main===module){try{main();}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={main};
