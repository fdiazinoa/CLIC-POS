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
 import {installDiagnostics,diagRun,diagSet,diagSync} from ${JSON.stringify(runtime)};
 async function main(){
 const batches=[];let flush;const bridge=[];const frames=[];
 const inputs={};globalThis.document={addEventListener(type,fn){inputs[type]=fn;}};
 globalThis.location={href:'https://localhost/'};
 globalThis.PerformanceObserver=class {static supportedEntryTypes=[];};
 globalThis.XMLHttpRequest=class extends EventTarget {send(){}};
 globalThis.requestAnimationFrame=(fn)=>{frames.push(fn);return 0;};
 globalThis.setInterval=(fn)=>{flush=fn;return 0;};
 globalThis.POSDiagnostics={enabled:()=>true,clock:()=>String(performance.now()*1e6),section(){},events(s){batches.push(...JSON.parse(s));}};
 globalThis.Capacitor={PluginHeaders:[{name:'PosDiagnosticSink',methods:[{name:'send',rtype:'promise'}]}],nativePromise:(p,m,o)=>{if(p==='PosDiagnosticSink'){batches.push(...JSON.parse(o.payload));return Promise.resolve({});}bridge.push({p,m,o});return Promise.resolve({values:[1,2]});},isNativePlatform:()=>true,getPlatform:()=> 'android'};
 await installDiagnostics();globalThis.__POS_DIAGNOSTICS__.arm(5);
 const delay=ms=>new Promise(r=>setTimeout(r,ms));
 for(let i=0;i<10000;i++)assert.equal(diagRun('POSInterface.tsx:getProductPrice:3087',()=>i,'direct-helper'),i);
 inputs.click({timeStamp:performance.now(),type:'click'});const values=await Promise.all([
  diagRun('ModernLoginScreen.tsx:handleKeyPress:1',async()=>{await delay(20);await Capacitor.nativePromise('SQLite','query',{});return diagSync('addToCart:getProductPrice:3320',()=>diagRun('POSInterface.tsx:getProductPrice:3087',()=>17,'direct-helper'));}),
  diagRun('ModernLoginScreen.tsx:handleKeyPress:2',async()=>{await delay(1);await Capacitor.nativePromise('SQLite','query',{});return 29;})
 ]);
 assert.deepEqual(values,[17,29]);assert.equal(bridge.length,2);assert.deepEqual(bridge[0].o,{});
 const error=new Error('same');await assert.rejects(diagRun('failure',async()=>{await delay(1);throw error;}),e=>e===error);
 let state=0;diagRun('quantity',()=>diagSet('setQuantity',v=>{state=typeof v==='function'?v(state):v;},v=>v+1));assert.equal(state,1);
 inputs.click({timeStamp:performance.now(),type:'click'});const background=diagRun('ModernLoginScreen.tsx:handleKeyPress:10',async()=>{diagSet('setVisible',()=>{},true);globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot(1,{current:{flags:1,type:function SmallComponent(){},memoizedProps:{},actualDuration:1}});await delay(60);});
 for(let i=0;i<2;i++)for(const fn of frames.splice(0))fn(performance.now());
 await background;
 flush();await delay(1);assert.equal(batches.filter(e=>e.name==='ACTION_START'&&e.kind==='action').length,3);assert.equal(batches.filter(e=>e.name==='REACT_RENDER').length,0);
 const visible=batches.find(e=>e.traceId==='POS-000005'&&e.name==='FIRST_RENDER');const done=batches.find(e=>e.traceId==='POS-000005'&&e.name==='ACTION_END');assert.ok(visible.ts<done.ts-30);
 assert.deepEqual(batches.filter(e=>e.name==='CAPACITOR_RETURN').map(e=>e.traceId),['POS-000002','POS-000001']);assert.ok(batches.some(e=>(e.name==='PROMISE_RESUME'||e.name==='MICROTASK_EXECUTION')&&e.parentSpan));
 assert.equal(batches.filter(e=>e.name==='FUNCTION_START'&&e.operation==='POSInterface.tsx:getProductPrice:3087').length,1);assert.ok(!JSON.stringify(batches).includes('bindValues'));
 const d=globalThis.__POS_DIAGNOSTICS__;
 await diagRun('render-microtask',()=>Promise.resolve().then(()=>{for(let i=0;i<10000;i++)diagRun('POSInterface.tsx:getProductPrice:3087',()=>i,'direct-helper');}));
 flush();assert.equal(batches.filter(e=>e.name==='FUNCTION_START'&&e.operation==='POSInterface.tsx:getProductPrice:3087').length,1);
 const compact=batches.filter(e=>e.name==='MICROTASK_EXECUTION');assert.ok(compact.length>0);assert.ok(compact.every(e=>e.endTs>=e.startTs&&e.duration>=0));
 assert.equal(d.target('return',()=>42,()=>{throw Error('metadata');}),42);
 assert.throws(()=>d.target('throw',()=>{throw error;}),e=>e===error);
 d.disable();inputs.click({timeStamp:performance.now(),type:'click'});
 assert.equal(diagRun('ModernLoginScreen.tsx:handleKeyPress:99',()=>123),123);
 assert.equal(d.status().active,false);d.enable();d.arm(1);assert.equal(d.status().active,true);d.disable();
 console.log('context-result-exception-pass');process.exit(0);
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
 const source=`const [items,setItems]=useState([]); const handleProductClick=async()=>{ setItems(await getItems()); return 7; };`;
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

test('diagnostic bootstrap chunks cannot eagerly import the React renderer',()=>{
 const config=readFileSync('vite.config.ts','utf8');
 assert.ok(config.indexOf("id.includes('/diagnostics/runtime.ts')") < config.indexOf("id.includes('node_modules')"));
 assert.match(config,/pos-diagnostics-zone/);
});

test('selective mode never traverses fibers, uses production React and does not patch SQLite',()=>{
 const runtime=readFileSync('diagnostics/runtime.ts','utf8');
 assert.doesNotMatch(runtime,/root\.current|memoizedProps|actualDuration|REACT_RENDER|native\(\)\?\.section/);
 assert.doesNotMatch(readFileSync('vite.config.ts','utf8'),/react-dom\/profiling/);
 assert.doesNotMatch(readFileSync('scripts/release-android.sh','utf8'),/python3 scripts\/diagnostics\/patch-native\.py/);
 const plugin=temporalDiagnosticsPlugin(true).transform as Function;
 assert.equal(plugin('const handleSend=()=>send();','/src/components/PaymentModal.tsx'),undefined);
 const result=plugin('class Adapter { async getCollection(){ const docs=await read(); return docs.map(x=>x); }}','/src/services/db/adapters/CapacitorSQLiteAdapter.ts');
 assert.match(result.code,/__posDiagSync/);assert.match(result.code,/getCollection:1/);
});

test('target aggregates bound volume and store only changed reference names, not values',async()=>{
 const {TargetCounters}=await import('../diagnostics/targeted');const counters=new TargetCounters();
 const stable={};for(let i=0;i<10000;i++)counters.observe('card',0.01,{key:'private-product-id',refs:{product:stable,onClick:stable}});
 counters.observe('card',20,{key:'private-product-id',refs:{product:stable,onClick:()=>{}}});
 const rows=counters.drain();assert.equal(rows.length,1);assert.equal(rows[0].count,10001);assert.equal(rows[0].changed.onClick,1);assert.equal(rows[0].changed.product,undefined);
 assert.equal(rows[0].over16,1);assert.equal(rows[0].baseline,1);assert.ok(!JSON.stringify(rows).includes('private-product-id'));
 counters.reset();counters.observe('card',1,{key:'private-product-id',refs:{product:stable}});assert.equal(counters.drain()[0].baseline,1);
});

test('focus instrumentation retains optional call, receiver, return and exception',async()=>{
 const transform=temporalDiagnosticsPlugin(true).transform as Function;
 const result=transform(`export function focusSalesScannerInput(doc){ const input=doc.querySelector('x'); return input?.focus({preventScroll:true}); }`,'/src/utils/globalBarcodeCapture.ts');
 assert.match(result.code,/__posDiagTarget/);assert.match(result.code,/input\?\.focus/);
 const {transform:compile}=await import('esbuild');
 const js=await compile(result.code.replace(/^import .*\n/,'').replace('export function','function'),{loader:'ts',format:'cjs'});
 const calls:string[]=[];
 const run=new Function('__posDiagTarget',js.code+';return focusSalesScannerInput;')((name:string,work:Function)=>{calls.push(name);return work();});
 const target={focus(options:any){assert.equal(this,target);assert.deepEqual(options,{preventScroll:true});return 42;}};
 assert.equal(run({querySelector:()=>target}),42);assert.equal(run({querySelector:()=>null}),undefined);
 const err=new Error('same');assert.throws(()=>run({querySelector:()=>{throw err;}}),e=>e===err);
 assert.ok(calls.some(s=>s==='scanner:input?.focus'));
});

test('reference control permits DevTools without starting native observers or enabling JS diagnostics',()=>{
 const source=readFileSync('android/app/src/main/java/com/clicpos/app/PosNativeDiagnostics.java','utf8');
 assert.match(source,/active=BuildConfig.POS_DIAGNOSTICS && activity.getIntent\(\).getBooleanExtra\("pos_diagnostics",false\)/);
 assert.match(source,/boolean controlOnly=BuildConfig.POS_DIAGNOSTICS\s*&& activity.getIntent\(\).getBooleanExtra\("pos_diagnostic_control",false\)/);
 const gate=source.indexOf('if(!active)return;');assert.ok(source.indexOf('if(active || controlOnly)')<gate);
 assert.ok(source.indexOf('new HandlerThread')>gate);assert.ok(source.indexOf('addOnFrameMetricsAvailableListener')>gate);
 assert.match(source,/boolean enabled\(\)\{return active;\}/);
});
