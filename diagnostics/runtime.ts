/* Opt-in, windowed diagnostics. Never collect arguments, PINs or document contents. */
declare const Zone:any;
type Trace={id:string;name:string;start:number;first?:boolean};
type Span={id:number;parent:number|null;name:string;t?:Trace;start:number};
let enabled=false,seq=0,sseq=0,deadline=0,session='',drops=0,overhead=0;
let queue:any[]=[];const dirty=new Set<Trace>();
const clock=()=>performance.now();
const active=()=>enabled&&clock()<deadline;
let syncSpan:Span|undefined;
const context=():Span|undefined=>syncSpan || (typeof Zone==='undefined'?undefined:Zone.current.get('posSpan'));
const shortSync=new Map<string,{count:number;total:number;max:number}>();
const native=()=> (globalThis as any).POSDiagnostics;
let input:{at:number;type:string}|undefined;
let chain:{id:number;start:number;end:number;count:number;sum:number;max:number;states:number;scheduled:number}|undefined;
let lastCost:any;
let drainPending=false,drain:MessagePort;
function emit(name:string,data:any={},span=context(),ts=clock()){
 if(!enabled)return;const s=clock();
 if(queue.length<6000)queue.push({name,traceId:span?.t?.id||'UNATTRIBUTED',spanId:span?.id,parentSpan:span?.parent,operation:span?.name,ts,session,thread:'CrRendererMain',...data});else drops++;
 overhead+=clock()-s;
}
function mark(name:string,span?:Span){performance.mark(`${span?.t?.id||'UNATTRIBUTED'}|${name}|${span?.name||''}`);}
function closeChain(){if(chain){emit('MICROTASK_CHAIN',{...chain,duration:chain.end-chain.start,measurement:'instrumented_microtasks_until_message_task; excludes unknown microtasks; not proof of paint'});chain=undefined;}drainPending=false;}
const taskMeta=new WeakMap<object,{parent?:Span;origin:string;id:number}>();
const zoneSpec={name:'pos-selective',onScheduleTask(delegate:any,current:any,target:any,task:any){
 if(active()&&task.type==='microTask'){
  const parent=context()||target.get('posSpan');taskMeta.set(task,{parent,origin:parent?.name||task.source,id:++sseq});if(chain)chain.scheduled++;
 }
 return delegate.scheduleTask(target,task);
},onInvokeTask(delegate:any,current:any,target:any,task:any,self:any,args:any[]){
 if(!active()||task.type!=='microTask')return delegate.invokeTask(target,task,self,args);
 const meta=taskMeta.get(task),parent=meta?.parent||context();
 const span:Span={id:meta?.id||++sseq,parent:parent?.id??null,name:meta?.origin||task.source,t:parent?.t,start:clock()};
 if(!chain){chain={id:span.id,start:span.start,end:span.start,count:0,sum:0,max:0,states:0,scheduled:0};}
 chain.count++;emit('PROMISE_RESUME',{source:task.source,chainId:chain.id},span);emit('JS_PROCESSING_START',{chainId:chain.id},span);
 try{return Zone.current.fork({name:'continuation',properties:{posSpan:span}}).run(()=>delegate.invokeTask(target,task,self,args));}
 finally{const d=clock()-span.start;emit('JS_PROCESSING_END',{duration:d,over16:d>16,over50:d>50,over100:d>100,chainId:chain?.id},span);if(chain){chain.end=clock();chain.sum+=d;chain.max=Math.max(chain.max,d);}if(!drainPending){drainPending=true;Zone.root.run(()=>drain.postMessage(0));}}
}};
function scoped<T>(span:Span,work:()=>T):T{return Zone.current.fork({...(Zone.current.get('posObserved')?{name:'pos-span'}:zoneSpec),properties:{posSpan:span,posObserved:true}}).run(work);}
export const diagEnabled=()=>enabled;
export function diagRun<T>(name:string,work:()=>T,kind='background'):T{
 if(!enabled || (kind==='direct-helper'&&!syncSpan))return work();
 const user=/ModernLoginScreen.*handleKeyPress|POSInterface.*handleProductCardClick|TableMap.*handleNodeSelect/.test(name)&&input&&clock()-input.at<150;
 if(user)deadline=clock()+5000;
 if(!active())return work();
 const parent=context();const t:Trace=(!user&&parent?.t)||{id:`POS-${String(++seq).padStart(6,'0')}`,name,start:clock()};
 const span:Span={id:++sseq,parent:parent?.id??null,name,t,start:clock()};
 if(t&&t!==parent?.t){emit('ACTION_START',{kind:user?'action':'background',...(user?{inputTimestamp:input?.at,eventType:input?.type}:{})},span);mark('ACTION_START',span);}
 emit('FUNCTION_START',{kind},span);
 return scoped(span,()=>{let async=false;
  const end=(outcome:string)=>{emit('FUNCTION_END',{duration:clock()-span.start,outcome,includesAwait:async},span);if(t&&t!==parent?.t)emit('ACTION_END',{},span);};
  try{const v=work();if(v&&typeof (v as any).then==='function'){async=true;return (v as any).then((r:any)=>{end('ok');return r;},(e:any)=>{end('error');throw e;});}end('ok');return v;}catch(e){end('error');throw e;}
 });
}
export function diagSync<T>(name:string,work:()=>T):T{
 if(!active())return work();const parent=context();const span:Span={id:++sseq,parent:parent?.id??null,name,t:parent?.t,start:clock()};
 if(/onUpdateCart/.test(name)){if(parent?.t)dirty.add(parent.t);if(chain)chain.states++;}
 const prior=syncSpan;syncSpan=span;
 try{return work();}finally{syncSpan=prior;const duration=clock()-span.start;
  if(duration>=1){emit('JS_PROCESSING_START',{},span,span.start);emit('JS_PROCESSING_END',{duration},span);}
  else {const x=shortSync.get(name)||{count:0,total:0,max:0};x.count++;x.total+=duration;x.max=Math.max(x.max,duration);shortSync.set(name,x);}
 }
}
export function diagState<T>(name:string,work:()=>T,_value?:unknown):T{
 if(!active())return work();const span=context();if(span?.t)dirty.add(span.t);if(chain)chain.states++;
 return diagSync(name,()=>{emit('STATE_UPDATE',{},span);return work();});
}
export function diagSet<T>(name:string,setter:(v:T)=>any,value:T){return diagState(name,()=>setter(value));}
export function diagLegacy(operation:string,stage:string,_meta?:Record<string,unknown>){if(active())emit('LEGACY_'+stage,{legacyOperation:operation});}
function installCommitHook(){const g=globalThis as any;if(g.__REACT_DEVTOOLS_GLOBAL_HOOK__)return;
 g.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,renderers:new Map(),inject(r:any){this.renderers.set(1,r);return 1;},onCommitFiberUnmount(){},onPostCommitFiberRoot(){},onCommitFiberRoot(){
  if(!active())return;const ts=clock(),traces=[...dirty];dirty.clear();emit('REACT_COMMIT',{traceIds:traces.map(t=>t.id)},undefined,ts);performance.mark('POS|REACT_COMMIT');
  for(const t of traces){if(t.first)continue;Zone.root.run(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{if(t.first)return;t.first=true;const span={id:++sseq,parent:null,name:t.name,t,start:ts};emit('FIRST_RENDER',{duration:clock()-t.start,commitTs:ts,ambiguous:traces.length>1,measurement:'post_paint_opportunity'},span);mark('FIRST_RENDER',span);})));}
 }};
}
function installBridge(){const cap=(globalThis as any).Capacitor;if(!cap?.nativePromise)return;const original=cap.nativePromise.bind(cap);
 cap.nativePromise=(plugin:string,method:string,options:any)=>{
  if(!active()||plugin==='PosDiagnosticSink')return original(plugin,method,options);
  const parent=context(),span:Span={id:++sseq,parent:parent?.id??null,name:`Capacitor:${plugin}.${method}`,t:parent?.t,start:clock()};
  emit('SYNC_CALL_START',{meaning:'JS nativePromise invocation, not synchronous native execution'},span);
  const p=original(plugin,method,options);emit('SYNC_CALL_NATIVE_RETURN',{meaning:'nativePromise returned a Promise; NOT native completion'},span);
  return scoped(span,()=>p.then((r:any)=>{emit('CAPACITOR_RETURN',{meaning:'JS fulfillment callback; native completion may be earlier'},span);return r;},(e:any)=>{emit('CAPACITOR_RETURN',{error:true},span);throw e;}));
 };
 const cb=cap.nativeCallback?.bind(cap);if(cb)cap.nativeCallback=(p:string,m:string,o:any,fn:any)=>{
  if(!active())return cb(p,m,o,fn);const parent=context();return cb(p,m,o,function(this:any,...args:any[]){return diagRun(`CapacitorCallback:${p}.${m}`,()=>scoped(parent||{id:++sseq,parent:null,name:`${p}.${m}`,start:clock()},()=>fn?.apply(this,args)));});
 };
}
export async function installDiagnostics(){
 if(!native()?.enabled())return;
 await import('zone.js');enabled=true;session=Date.now().toString(36);
 const channel=new MessageChannel();drain=channel.port2;channel.port1.onmessage=closeChain;
 const before=clock(),bootNs=native().clock(),after=clock();emit('CLOCK_SYNC',{bootNs,jsBefore:before,jsAfter:after,uncertaintyMs:after-before});
 for(const type of ['click','input','keydown'])document.addEventListener(type,e=>{input={at:e.timeStamp,type:e.type};},{capture:true,passive:true});
 installCommitHook();installBridge();
 const {registerPlugin}=await import('@capacitor/core');const sink=registerPlugin<{send(o:{payload:string}):Promise<void>}>('PosDiagnosticSink');
 for(const type of ['longtask','long-animation-frame'])if(PerformanceObserver.supportedEntryTypes.includes(type))new PerformanceObserver(list=>{for(const e of list.getEntries())if(active())emit(type.toUpperCase(),{duration:e.duration},undefined,e.startTime);}).observe({type,buffered:false});
 const flush=()=>{if(!queue.length)return;const t=clock(),batch=queue;queue=[];for(const [operation,stats] of shortSync)batch.push({name:'SHORT_SYNC_SUMMARY',operation,...stats,session,ts:clock(),thresholdMs:1});shortSync.clear();if(lastCost)batch.push(lastCost);const payload=JSON.stringify(batch);void sink.send({payload}).catch(()=>{drops+=batch.length;});lastCost={name:'DIAGNOSTIC_COST',ts:clock(),session,flushMs:clock()-t,emitMs:overhead,drops};overhead=0;performance.clearMarks();};
 Zone.root.run(()=>setInterval(flush,1000));
 (globalThis as any).__POS_DIAGNOSTICS__={status:()=>({session,drops,pending:queue.length,active:active()}),run:diagRun,processing:diagSync,flush,arm:(seconds=5)=>{deadline=clock()+Math.min(seconds,45)*1000;},disable:()=>{deadline=0;flush();}};
 emit('CAPABILITY',{mode:'selective',reactFiberTraversal:false,nativeSections:false,windowMs:5000,microtasks:'selected Zone continuations only; unknown callers require V8 sampling'});
}
