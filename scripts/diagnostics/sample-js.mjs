#!/usr/bin/env node
// Bounded CDP V8 stack sampling. Only DevTools endpoint forwarded from the explicit target.
import fs from 'node:fs';
import path from 'node:path';
const [endpoint,out,duration='40',samplingInterval='2000']=process.argv.slice(2);
const seconds=Number(duration),interval=Number(samplingInterval);
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint||'')||!out||!Number.isFinite(seconds)||seconds<5||seconds>45||!Number.isInteger(interval)||interval<1000||interval>10000)throw Error('sample-js.mjs http://127.0.0.1:PORT OUTPUT_DIR 5..45 [sampling interval 1000..10000us]');
fs.mkdirSync(out,{recursive:true});
const tabs=await (await fetch(endpoint+'/json')).json();
const tab=tabs.find(t=>t.type==='page'&&t.url.startsWith('https://localhost'));
if(!tab)throw Error('Expected CLIC POS localhost WebView not found');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
let id=0;const pending=new Map();
ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p?.timer);m.error?p?.reject(Error(JSON.stringify(m.error))):p?.resolve(m.result);}};
function call(method,params={}){return new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(Error(method+' timeout'));},10000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params}));});}
let started=false;
try{
 await call('Profiler.enable');await call('Profiler.setSamplingInterval',{interval});
 const before=await call('Runtime.evaluate',{expression:'JSON.stringify({js:performance.now(),origin:performance.timeOrigin,diagnostic:globalThis.__POS_DIAGNOSTICS__?.status()})',returnByValue:true});
 await call('Performance.enable');const metrics=await call('Performance.getMetrics');const after=await call('Runtime.evaluate',{expression:'performance.now()',returnByValue:true});fs.writeFileSync(path.join(out,'v8-clock.json'),JSON.stringify({samplingIntervalUs:interval,jsBefore:JSON.parse(before.result.value),metrics:metrics.metrics,jsAfter:after.result.value,uncertaintyMs:after.result.value-JSON.parse(before.result.value).js},null,2));
 await call('Profiler.start');started=true;console.log('V8_SAMPLER_ACTIVE interval='+interval+'us seconds='+seconds);
 const stop=Date.now()+seconds*1000;let nextCheck=0;const initialDrops=JSON.parse(before.result.value).diagnostic?.drops||0;
 while(Date.now()<stop&&!fs.existsSync(path.join(out,'stop.request'))){
  await new Promise(r=>setTimeout(r,250));
  if(Date.now()>=nextCheck){nextCheck=Date.now()+2000;const r=await call('Runtime.evaluate',{expression:'globalThis.__POS_DIAGNOSTICS__?.status()',returnByValue:true});const status=r.result.value;
   if(status&&(status.drops>initialDrops||status.pending>3000)){fs.writeFileSync(path.join(out,'quality-abort.json'),JSON.stringify({reason:'diagnostic_volume_or_drops',status}));fs.writeFileSync(path.join(out,'stop.request'),'');await call('Runtime.evaluate',{expression:'globalThis.__POS_DIAGNOSTICS__?.disable()'});console.log('QUALITY_ABORT: stop user reproduction; excessive diagnostic volume');break;}
  }
 }
}finally{
 if(started){const result=await call('Profiler.stop');fs.writeFileSync(path.join(out,'javascript.cpuprofile'),JSON.stringify(result.profile));}
 await call('Profiler.disable');ws.close();console.log('V8_SAMPLER_STOPPED');
}
