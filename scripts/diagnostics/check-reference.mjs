#!/usr/bin/env node
// Read-only preflight. An inactive window with Zone loaded is NOT a clean reference.
import fs from 'node:fs';
const [endpoint,mode,out]=process.argv.slice(2);
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint||'')||!['reference','diagnostic'].includes(mode)||!out)throw Error('check-reference.mjs http://127.0.0.1:PORT reference|diagnostic OUTPUT.json');
const tabs=await(await fetch(endpoint+'/json')).json();const tab=tabs.find(t=>t.type==='page'&&t.url.startsWith('https://localhost'));
if(!tab)throw Error('Expected POS WebView missing');
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
try{
 const result=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Reference preflight timeout')),10000);
  ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id!==1)return;clearTimeout(timer);m.error||m.result.exceptionDetails?reject(Error(JSON.stringify(m.error||m.result.exceptionDetails))):resolve(m.result.result.value);};
  ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:'({zone:typeof globalThis.Zone,nativeActive:globalThis.POSDiagnostics?.enabled(),diagnosticApi:typeof globalThis.__POS_DIAGNOSTICS__,origin:location.origin})',returnByValue:true}}));
 });
 const valid=mode==='reference'?result.zone==='undefined'&&result.nativeActive===false&&result.diagnosticApi==='undefined':result.zone==='function'&&result.nativeActive===true&&result.diagnosticApi==='object';
 fs.writeFileSync(out,JSON.stringify({mode,valid,...result},null,2));if(!valid)throw Error('Observer mode mismatch; do not run comparison');console.log(out);
}finally{ws.close();}
