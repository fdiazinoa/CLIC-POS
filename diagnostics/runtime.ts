/* Temporary, opt-in diagnostics. Never log payloads, PINs, SQL bind values or URLs. */
type Trace = { id: string; name: string; start: number; kind: string; busy: Set<string>; ended?: boolean; first?: boolean; unlocked?: boolean; handlerDone?: boolean };
type Event = { traceId: string; name: string; ts: number; wall: number; [key: string]: unknown };
declare const Zone: any;
const native = () => (globalThis as any).POSDiagnostics;
let observerMs=0;
let enabled = false, seq = 0, spanSeq = 0, session = '', pending: Event[] = [], dropped = 0;
const traces = new Map<string, Trace>(), dirty = new Set<string>();
let input: { at: number; target: HTMLElement | null; type: string } | undefined;
const now = () => performance.now();
const current = (): Trace | undefined => typeof Zone !== 'undefined' ? Zone.current.get('posTrace') : undefined;
export const diagEnabled = () => enabled;
const safeName = (s: unknown) => String(s ?? '').replace(/[^a-zA-Z0-9_./:-]/g, '_').slice(0, 160);
function emit(t: Trace | undefined, name: string, data: Record<string, unknown> = {}, timestamp = now()) {
  if (!enabled) return;
  const overheadStart=now();
  const event = { traceId: t?.id || 'UNATTRIBUTED', name, ts: timestamp, wall: performance.timeOrigin + timestamp, session, jsThread: 'CrRendererMain', ...data };
  if (pending.length < 12000) pending.push(event); else dropped++;
  // UserTiming is recorded in Chromium's Perfetto producer on the actual renderer thread.
  performance.mark(`${event.traceId}|${name}|${safeName(data.operation || '')}`, { startTime: timestamp });
  observerMs+=now()-overheadStart;
}
function start(name: string, kind: string, meta: Record<string, unknown> = {}): Trace {
  const t: Trace = { id: `POS-${String(++seq).padStart(6,'0')}`, name, start: now(), kind, busy: new Set() };
  traces.set(t.id,t);
  emit(t,'ACTION_START',{operation:name,kind,...meta,...(kind==='action'&&input&&now()-input.at<100?{inputTimestamp:input.at,eventType:input.type}:{})});
  native()?.section(t.id, name, true);
  return t;
}
function milestone(t: Trace, name: string, data = {}) {
  emit(t,name,{elapsedMs:now()-t.start,...data});
}
function finish(t: Trace) {
  if (t.ended) return;
  t.ended = true;
  milestone(t,'ACTION_END');
  native()?.section(t.id,t.name,false);
}
export function diagRun<T>(name: string, work: () => T, kind = 'action', meta: Record<string, unknown> = {}): T {
  if (!enabled) return work();
  const parent = current();
  const t = parent || start(name,kind,meta), root = !parent, sid = ++spanSeq;
  const zone = Zone.current.fork({ name:t.id, properties:{posTrace:t} });
  emit(t,'JS_OPERATION_START',{operation:name,spanId:sid,root});
  const end = (outcome:string) => { emit(t,'JS_OPERATION_END',{operation:name,spanId:sid,outcome}); if(root) {t.handlerDone=true; milestone(t,'HANDLER_END'); finish(t);} };
  return zone.run(() => {
    try {
      const value = work();
      if (value && typeof (value as any).then === 'function') return (value as any).then((result:any)=>{end('ok');return result;},(error:any)=>{end('error');throw error;});
      end('ok'); return value;
    } catch(error) {end('error');throw error;}
  });
}
export function diagState<T>(name: string, work: () => T, value?: unknown): T {
  if (!enabled) return work();
  const t = current();
  emit(t,'JS_STATE_UPDATE_START',{operation:name});
  try {
    if(t) {
      dirty.add(t.id);
      if (/(processing|loading|saving|submitting|busy|dispatching|finalizing)/i.test(name) && typeof value === 'boolean') {
        if(value)t.busy.add(name);else t.busy.delete(name);
        emit(t,'UI_BUSY_STATE',{operation:name,busy:value});
      }
    }
    return work();
  } finally {emit(t,'JS_STATE_UPDATE_END',{operation:name});}
}
export function diagLegacy(operation:string,stage:string,meta?:Record<string,unknown>) {
  const t=current(); if(!t)return;
  emit(t,'LEGACY_'+stage,{operation,...(meta ? {tableId:meta.tableId,ticketId:meta.ticketId}: {})});
  // Legacy unlock remains separate; it does not prove a presented/enabled frame.
}
function installReactHook() {
  const g=globalThis as any;
  if(g.__REACT_DEVTOOLS_GLOBAL_HOOK__) {emit(undefined,'CAPABILITY',{reactHook:'existing_not_replaced'});return;}
  let renderer=0;
  g.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,renderers:new Map(),inject(r:any){this.renderers.set(++renderer,r);return renderer;},onCommitFiberUnmount(){},onPostCommitFiberRoot(){},
    onCommitFiberRoot(_id:number,root:any){
      const hookStart=now();
      const ids=[...dirty];dirty.clear();const commit=now();
      // Include ambiguity explicitly: one batched commit may serve several actions.
      let count=0; const walk=(f:any)=>{if(!f || count>2000)return;count++;
        if((f.flags&1) && typeof f.type !== 'string') {
          const name=f.type?.displayName || f.type?.name || f.elementType?.name || 'Anonymous';
          const prev=f.alternate, props=f.memoizedProps||{}, before=prev?.memoizedProps||{};
          const changed=Object.keys(props).filter(k=>props[k]!==before[k]).map(safeName).slice(0,20);
          const data={component:safeName(name),actualDuration:f.actualDuration??null,baseDuration:f.treeBaseDuration??null,changedPropKeys:changed,stateReferenceChanged:prev?f.memoizedState!==prev.memoizedState:null,traceIds:ids,commitTs:commit};
          for(const id of ids.length?ids:[''])emit(traces.get(id),'REACT_RENDER',data);
        }
        walk(f.child);walk(f.sibling);
      };walk(root.current);
      emit(undefined,'DIAGNOSTIC_REACT_HOOK',{duration:now()-hookStart});
      for(const id of ids) {
        const t=traces.get(id);if(!t)continue;
        emit(t,'REACT_COMMIT',{traceIds:ids,ambiguous:ids.length>1});
        // A double-rAF is a post-paint opportunity, NOT a measured compositor presentation.
        requestAnimationFrame(()=>requestAnimationFrame(()=>{
          if(!t.first){t.first=true;milestone(t,'FIRST_RENDER',{measurement:'post_paint_opportunity',ambiguous:ids.length>1});}
          if(!t.unlocked && t.busy.size===0){t.unlocked=true;milestone(t,'LOCAL_UNLOCK',{measurement:'committed_no_instrumented_busy_state',ambiguous:ids.length>1});}
        }));
      }
    }};
}
function installBridge() {
  const cap=(globalThis as any).Capacitor;if(!cap?.nativePromise){emit(undefined,'CAPABILITY',{bridge:false});return;}
  const promise=cap.nativePromise.bind(cap);
  cap.nativePromise=(plugin:string,method:string,options:any)=>{
    const t=current();const sid=++spanSeq;
    emit(t,'CAPACITOR_CALL_START',{plugin,operation:method,spanId:sid});
    // Additional option keys are consumed by diagnostic hooks only, never SQL or HTTP data.
    return promise(plugin,method,{...options,_posTraceId:t?.id||'UNATTRIBUTED',_posSpanId:String(sid)}).then((result:any)=>{
      emit(t,'CAPACITOR_CALL_END',{plugin,operation:method,spanId:sid,rows:Array.isArray(result?.values)?result.values.length:null});return result;
    },(error:any)=>{emit(t,'CAPACITOR_CALL_END',{plugin,operation:method,spanId:sid,errorClass:safeName(error?.name)});throw error;});
  };
  const callback=cap.nativeCallback?.bind(cap);
  if(callback)cap.nativeCallback=(plugin:string,method:string,options:any,cb:any)=>{
    const t=current(),sid=++spanSeq;emit(t,'CAPACITOR_CALLBACK_START',{plugin,operation:method,spanId:sid});
    return callback(plugin,method,{...options,_posTraceId:t?.id||'UNATTRIBUTED',_posSpanId:String(sid)},(...args:any[])=>{emit(t,'CAPACITOR_CALLBACK',{plugin,operation:method,spanId:sid});return cb?.(...args);});
  };
}
function installNetwork() {
  const fetchOriginal=globalThis.fetch;
  globalThis.fetch=function(...args:Parameters<typeof fetch>) {
    const t=current(),sid=++spanSeq;
    // URL paths may contain customer IDs/tokens. Log method and a session-local opaque endpoint ID only.
    let endpoint='unknown';try{const u=new URL(typeof args[0]==='string'?args[0]:args[0] instanceof URL?args[0].href:args[0].url,location.href);endpoint=safeName(u.origin)+':'+hash(u.pathname);}catch{}
    emit(t,'HTTP_START',{spanId:sid,endpoint,method:args[1]?.method||'GET'});
    return fetchOriginal.apply(this,args).then(response=>{emit(t,'HTTP_HEADERS',{spanId:sid,status:response.status});return response;},error=>{emit(t,'HTTP_ERROR',{spanId:sid,errorClass:safeName(error?.name)});throw error;});
  };
  for(const method of ['json','text','arrayBuffer','blob','formData'] as const) {
    const original=Response.prototype[method] as any;
    (Response.prototype as any)[method]=function(...args:any[]){const t=current(),sid=++spanSeq;emit(t,'HTTP_BODY_START',{spanId:sid,operation:method});return original.apply(this,args).then((v:any)=>{emit(t,'HTTP_BODY_END',{spanId:sid});return v;},(e:any)=>{emit(t,'HTTP_BODY_END',{spanId:sid,error:true});throw e;});};
  }
  const send=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send=function(body?:Document|XMLHttpRequestBodyInit|null){const t=current(),sid=++spanSeq;emit(t,'XHR_START',{spanId:sid});this.addEventListener('loadend',()=>emit(t,'XHR_END',{spanId:sid,status:this.status}),{once:true});return send.call(this,body);};
}
function hash(s:string){let h=2166136261;for(const c of s)h=Math.imul(h^c.charCodeAt(0),16777619);return (h>>>0).toString(16);}
export async function installDiagnostics() {
  if(!native()?.enabled())return;
  await import('zone.js');enabled=true;session=Date.now().toString(36);
  const jsBefore=now(),boot=native().clock(),jsAfter=now();
  emit(undefined,'CLOCK_SYNC',{bootNs:boot,jsBefore,jsAfter,uncertaintyMs:jsAfter-jsBefore});
  for(const type of ['click','input','change','keydown']) document.addEventListener(type,e=>{input={at:e.timeStamp,target:e.target as HTMLElement,type:e.type};},{capture:true,passive:true});
  installReactHook();installBridge();installNetwork();
  for(const type of ['longtask','event','long-animation-frame']) {
    if(!PerformanceObserver.supportedEntryTypes.includes(type)) {emit(undefined,'CAPABILITY',{type,supported:false});continue;}
    new PerformanceObserver(list=>{for(const e of list.getEntries())emit(undefined,type.toUpperCase(),{duration:e.duration,entryName:safeName(e.name),...('processingStart' in e?{processingStart:(e as any).processingStart,processingEnd:(e as any).processingEnd,interactionId:(e as any).interactionId}:{}),scripts:(e as any).scripts?.map((s:any)=>({duration:s.duration,sourceFunctionName:safeName(s.sourceFunctionName),sourceCharPosition:s.sourceCharPosition}))},e.startTime);}).observe({type,buffered:true,...(type==='event'?{durationThreshold:16}:{})});
  }
  let last=now();const frame=(ts:number)=>{const dt=ts-last;if(dt>16.7)emit(undefined,'RAF_GAP',{duration:dt,over32:dt>32,over50:dt>50,over100:dt>100,measurement:'raf_gap_not_frame_drop'},last);last=ts;requestAnimationFrame(frame);};requestAnimationFrame(frame);
  setInterval(()=>{
    if(!pending.length)return;
    const batch=pending.splice(0,500),flushStart=now(),eventOverheadMs=observerMs;observerMs=0;
    native().events(JSON.stringify(batch));performance.clearMarks();
    emit(undefined,'DIAGNOSTIC_FLUSH',{duration:now()-flushStart,eventOverheadMs,dropped});
  },200);
  (globalThis as any).__POS_DIAGNOSTICS__={status:()=>({session,operations:seq,dropped,pending:pending.length}),mark:(name:string)=>emit(current(),safeName(name))};
  emit(undefined,'CAPABILITY',{enabled:true,session,asyncContext:'zone-es2016',firstRender:'post-paint opportunity; reconcile with FrameTimeline',localUnlock:'instrumented busy state + commit; unknown blockers not inferred'});
}

export function diagSet<T>(name:string,setter:(value:T)=>any,value:T){return diagState(name,()=>setter(value),value);}
