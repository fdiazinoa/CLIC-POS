#!/usr/bin/env node
// Calibration only: generated arrays/JSON, no POS state, database, HTTP or input dispatch.
import fs from 'node:fs';
const [endpoint,out]=process.argv.slice(2);
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint||'')||!out)throw Error('calibrate-js.mjs http://127.0.0.1:PORT OUTPUT.json');
const tabs=await(await fetch(endpoint+'/json')).json();const tab=tabs.find(t=>t.type==='page'&&t.url.startsWith('https://localhost'));
if(!tab)throw Error('POS WebView missing');const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
let id=0;const pending=new Map();ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.j(Error(JSON.stringify(m.error))):p.r(m.result);}};
const call=(method,params={})=>new Promise((r,j)=>{const n=++id,timer=setTimeout(()=>j(Error(method+' timeout')),30000);pending.set(n,{r,j,timer});ws.send(JSON.stringify({id:n,method,params}));});
const expression=`(async()=>{
 const d=globalThis.__POS_DIAGNOSTICS__;if(!d)throw Error('Selective hooks unavailable');
 const rows=Array.from({length:12000},(_,i)=>({id:i,q:i%13,label:'synthetic-'+i}));const results=[];
 const work=()=>{let p=Promise.resolve(0);for(let k=0;k<8;k++)p=p.then(checksum=>checksum+d.processing('calibration:parse-map-stringify',()=>JSON.parse(JSON.stringify(rows)).filter(x=>x.q>3).map(x=>x.id+x.q).reduce((a,b)=>a+b,0)));return p;};
 for(let pair=0;pair<6;pair++)for(const enabled of (pair%2?[true,false]:[false,true])){d.disable();await new Promise(r=>setTimeout(r,150));if(enabled)d.arm(20);const start=performance.now();const checksum=await d.run('calibration:continuations',work);results.push({pair,enabled,ms:performance.now()-start,checksum});}
 d.disable();return {results,status:d.status(),scope:'incremental selected scopes only; Zone already loaded; excludes profiler/Perfetto and real interaction overhead'};
})()`;
try{const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));fs.writeFileSync(out,JSON.stringify(result.result.value,null,2));console.log(out);}finally{ws.close();}
