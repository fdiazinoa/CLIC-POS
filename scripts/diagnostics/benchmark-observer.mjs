#!/usr/bin/env node
// Host-only control of observer event volume/cost, NOT a terminal overhead gate.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
const [runtime,out]=process.argv.slice(2);
if(!runtime||!out)throw Error('benchmark-observer.mjs RUNTIME.ts OUTPUT.json');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pos-observer-bench-'));
try{
 const source=`import {installDiagnostics} from ${JSON.stringify(path.resolve(runtime))};
 async function main(){
 let flush,eventCount=0;globalThis.document={addEventListener(){}};
 globalThis.location={href:'https://localhost/'};globalThis.PerformanceObserver=class {static supportedEntryTypes=[]};
 globalThis.XMLHttpRequest=class extends EventTarget {};globalThis.requestAnimationFrame=()=>0;
 globalThis.setInterval=fn=>{flush=fn;return 0};globalThis.POSDiagnostics={enabled:()=>true,clock:()=>String(performance.now()*1e6)};
 globalThis.Capacitor={PluginHeaders:[{name:'PosDiagnosticSink',methods:[{name:'send',rtype:'promise'}]}],nativePromise:(p,m,o)=>{eventCount+=JSON.parse(o.payload).length;return Promise.resolve({});},isNativePlatform:()=>true,getPlatform:()=> 'android'};
 await installDiagnostics();const d=globalThis.__POS_DIAGNOSTICS__,results=[];
 // Fixed workload and warmup count; do not tune them after seeing results.
 for(let round=0;round<12;round++){
  d.enable();d.arm(30);const eventsBefore=eventCount,start=performance.now();
  const checksum=await d.run('calibration:microtasks',()=>{let p=Promise.resolve(0);for(let i=0;i<400;i++)p=p.then(n=>n+1);return p;});
  flush();results.push({round,warmup:round<2,ms:performance.now()-start,events:eventCount-eventsBefore,checksum});
 }
 d.disable();console.log(JSON.stringify({results,status:d.status(),scope:'host synthetic; Zone loaded, 400 Promise callbacks; includes synchronous fake sink parse, excludes Android/Perfetto'}));process.exit(0);
 }main().catch(e=>{console.error(e);process.exit(1)});`;
 const entry=path.join(temp,'bench.ts'),bundle=path.join(temp,'bench.mjs');fs.writeFileSync(entry,source);
 await build({entryPoints:[entry],outfile:bundle,bundle:true,platform:'node',format:'esm',target:'es2020',supported:{'async-await':false},nodePaths:[path.resolve('node_modules')],logLevel:'silent'});
 const output=execFileSync(process.execPath,[bundle],{encoding:'utf8',timeout:30000});
 const result=JSON.parse(output.trim());fs.writeFileSync(out,JSON.stringify(result,null,2));console.log(out);
}finally{fs.rmSync(temp,{recursive:true,force:true});}
