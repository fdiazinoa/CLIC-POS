import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {temporalDiagnosticsPlugin} from '../diagnostics/viteInstrumentation';

test('diagnostic build preserves async context across overlapping operations, results and exceptions',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'pos-diag-test-'));
 try{
 const runtime=path.resolve('diagnostics/runtime.ts');
 const fixture=`
 import assert from 'node:assert/strict';
 import {installDiagnostics,diagRun,diagSet} from ${JSON.stringify(runtime)};
 async function main(){
 const batches=[];let flush;const bridge=[];
 globalThis.document={addEventListener(){}};
 globalThis.location={href:'https://localhost/'};
 globalThis.PerformanceObserver=class {static supportedEntryTypes=[];};
 globalThis.XMLHttpRequest=class extends EventTarget {send(){}};
 globalThis.requestAnimationFrame=()=>0;
 globalThis.setInterval=(fn)=>{flush=fn;return 0;};
 globalThis.POSDiagnostics={enabled:()=>true,clock:()=>String(performance.now()*1e6),section(){},events(s){batches.push(...JSON.parse(s));}};
 globalThis.Capacitor={nativePromise:(p,m,o)=>{bridge.push({p,m,o});return Promise.resolve({values:[1,2]});}};
 await installDiagnostics();
 const delay=ms=>new Promise(r=>setTimeout(r,ms));
 const values=await Promise.all([
  diagRun('table-A',async()=>{await delay(20);await Capacitor.nativePromise('SQLite','query',{});return 17;}),
  diagRun('table-B',async()=>{await delay(1);await Capacitor.nativePromise('SQLite','query',{});return 29;})
 ]);
 assert.deepEqual(values,[17,29]);assert.equal(bridge[0].o._posTraceId,'POS-000002');assert.equal(bridge[1].o._posTraceId,'POS-000001');
 const error=new Error('same');await assert.rejects(diagRun('failure',async()=>{await delay(1);throw error;}),e=>e===error);
 let state=0;diagRun('quantity',()=>diagSet('setQuantity',v=>{state=typeof v==='function'?v(state):v;},v=>v+1));assert.equal(state,1);
 flush();assert.equal(batches.filter(e=>e.name==='ACTION_START').length,4);assert.equal(batches.filter(e=>e.name==='ACTION_END').length,4);
 assert.equal(batches.filter(e=>e.name==='CAPACITOR_CALL_END').length,2);
 assert.ok(!JSON.stringify(batches).includes('bindValues'));
 console.log('context-result-exception-pass');
 }
 main().catch(e=>{console.error(e);process.exitCode=1;});
 `;
 const file=path.join(dir,'fixture.ts');writeFileSync(file,fixture);
 // Match the diagnostic Vite async transform, retaining modern BigInt support.
 await build({entryPoints:[file],outfile:path.join(dir,'fixture.mjs'),bundle:true,platform:'node',format:'esm',target:'es2020',supported:{'async-await':false},logLevel:'silent'});
 assert.match(execFileSync(process.execPath,[path.join(dir,'fixture.mjs')],{encoding:'utf8'}),/context-result-exception-pass/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('normal build is untouched; diagnostic setter arguments retain await and are evaluated once',async()=>{
 const source=`const [items,setItems]=useState([]); const handleLoad=async()=>{ setItems(await getItems()); return 7; };`;
 const off=temporalDiagnosticsPlugin(false).transform as Function;
 assert.equal(off(source,'/src/components/POSInterface.tsx'),undefined);
 const on=temporalDiagnosticsPlugin(true).transform as Function;
 const result=on(source,'/src/components/POSInterface.tsx');
 assert.match(result.code,/await getItems\(\)/);assert.equal(result.code.match(/getItems\(/g)?.length,1);
 assert.match(result.code,/__posDiagRun/);assert.match(result.code,/__posDiagSet/);
 await build({stdin:{contents:result.code.replace(/^import .*\n/,''),loader:'tsx'},write:false,target:'es2020',logLevel:'silent'});
});

test('native SQL query and transaction instrumentation is repeatable and fails closed on mismatched sources',()=>{
 const patch=readFileSync('scripts/diagnostics/patch-native.py','utf8');
 assert.match(patch,/Already patched/);assert.match(patch,/assert s.count\(a\)==1/);
 const native=readFileSync('android/diagnostics/PosDiagnosticHooks.java','utf8');
 assert.match(native,/SQLITE_TRANSACTION_END/);assert.match(native,/Looper.myLooper\(\)==Looper.getMainLooper\(\)/);
 assert.doesNotMatch(native,/getData\(\).*toString/);
});
