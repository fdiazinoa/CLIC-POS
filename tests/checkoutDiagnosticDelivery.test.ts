import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { diagnosticEvent, diagnosticBytes, DiagnosticDeliveryWorker, type DeliveryDependencies, type DeliveryRow, type DeliveryState } from '../services/CheckoutDiagnosticDelivery';
import type { CheckoutDiagnosticRecord } from '../services/CheckoutDiagnostics';
const now=Date.now();
const session={id:'session',startedAt:new Date(now).toISOString(),expiresAt:new Date(now+86400000).toISOString(),terminalId:'terminal',deviceId:'device',versionName:'1.1.295',versionCode:1295};
const record=(id='record'):CheckoutDiagnosticRecord=>({id,at:new Date(now).toISOString(),stage:'CHECKOUT_OPEN',checkoutId:'checkout',session,data:{itemCount:1,total:30,lines:[{id:'product',quantity:1,price:30}]},anomaly:false});
function fixture() {
    let rows:DeliveryRow[]=[{sequence:1,session,event:diagnosticEvent(record(),1)}];
    const states=new Map<string,DeliveryState>();const calls:{path:string;body:any}[]=[];
    let clock=now;
    const deps:DeliveryDependencies={rows:async()=>rows,state:async id=>states.get(id)||{id},save:async s=>{states.set(s.id,s);},
        acknowledge:async(_batch,ids,state)=>{rows=rows.filter(r=>!ids.includes(r.event.record_id));states.set(state.id,state);},
        context:async()=>({base:'https://erp.example/api/sync',terminalId:'terminal',deviceId:'device',headers:{}}),
        post:async(_c,path,body:any)=>{calls.push({path,body});return path.endsWith('/events')?{status:202,data:{session_id:'session',acked_record_ids:body.events.map((e:any)=>e.record_id)}}:{status:201,data:{session_id:'session'}};}};
    return {deps,states,calls,get rows(){return rows;},set rows(r){rows=r;},worker:()=>new DiagnosticDeliveryWorker(deps,()=>clock,()=>0),advance:()=>{clock+=400000;}};
}
test('maps stages and trims large unicode details to ERP byte and line limits without changing counts',()=>{
 const r=record();r.data={...r.data,itemCount:100,lines:Array.from({length:100},()=>({id:'😀'.repeat(160),cartId:'😀'.repeat(160),price:30,quantity:1})),secret:'forbidden'};
 const e=diagnosticEvent(r,99);assert.equal(e.stage,'CHECKOUT_OPENED');assert.equal(e.local_sequence,99);assert.equal(e.commercial.item_count,100);assert.ok(e.commercial.lines.length<=50);assert.ok(diagnosticBytes(e)<8192);assert.equal(e.details.lines_truncated,true);assert.doesNotMatch(JSON.stringify(e),/forbidden/);
});
test('opens original session then ACKs only confirmed records',async()=>{
 const f=fixture();f.rows.push({sequence:2,session,event:diagnosticEvent(record('second'),2)});
 const post=f.deps.post;f.deps.post=async(c,p,b)=>p.endsWith('/events')?{status:202,data:{session_id:'session',acked_record_ids:['record','unknown']}}:post(c,p,b);
 await f.worker().run();assert.deepEqual(f.rows.map(r=>r.event.record_id),['second']);assert.equal(f.states.get('session')?.acked,1);assert.equal(f.calls[0].body.session_id,'session');
});
test('network failure preserves exact identities across retry and worker restart',async()=>{
 const f=fixture();let fail=true;const post=f.deps.post;f.deps.post=async(c,p,b)=>{if(p.endsWith('/events')&&fail)throw Error('offline');return post(c,p,b);};
 await f.worker().run();assert.equal(f.rows.length,1);const original=JSON.stringify(f.rows[0].event);fail=false;
 await f.worker().run();assert.equal(f.rows.length,0);assert.equal(JSON.stringify(f.calls.at(-1)!.body.events[0]),original);assert.equal(f.calls.filter(c=>c.path.endsWith('/sessions')).length,1);
});
test('429 backs off and permanent rejection retains local records without repeated transmission',async()=>{
 const f=fixture();let requests=0;f.deps.post=async()=>{requests++;return {status:429,data:{code:'RATE_LIMITED'},retryAfterMs:60000};};const worker=f.worker();
 await worker.run();await worker.run();assert.equal(requests,1);assert.equal(f.rows.length,1);
 f.advance();f.deps.post=async()=>({status:422,data:{code:'STAGE_INVALID'}});await worker.run();assert.equal(f.states.get('session')?.blocked,'STAGE_INVALID');
 f.deps.post=async()=>{throw Error('must not call')};assert.equal(await f.worker().run(),false);assert.equal(f.rows.length,1);
});
test('never sends another terminal session, expired session, or unauthenticated data',async()=>{
 for(const variant of ['identity','expired','auth']){const f=fixture();let calls=0;f.deps.post=async()=>{calls++;throw Error('not allowed')};
 if(variant==='identity')f.rows[0].session={...session,deviceId:'another'};
 if(variant==='expired')f.rows[0].session={...session,expiresAt:new Date(now-1).toISOString()};
 if(variant==='auth')f.deps.context=async()=>null;
 await f.worker().run();assert.equal(calls,0);assert.equal(f.rows.length,1);}
});
test('single flight and batch of at most 25 never drains records before ACK',async()=>{
 const f=fixture();f.rows=Array.from({length:40},(_,i)=>({sequence:i+1,session,event:diagnosticEvent(record('r'+i),i+1)}));
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r});const post=f.deps.post;f.deps.post=async(c,p,b)=>{if(p.endsWith('/events'))await gate;return post(c,p,b)};
 const w=f.worker();const pending=w.run();await new Promise(r=>setTimeout(r,0));await w.run();assert.equal(f.rows.length,40);release();await pending;assert.equal(f.rows.length,15);assert.equal(f.calls.at(-1)!.body.events.length,25);
});
test('upgrades real IndexedDB logs, persists sequence across reopen, bounds queue and preserves warnings',async()=>{
 Object.assign(globalThis,{indexedDB});
 const old=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('clic_pos_checkout_diagnostics_v1',1);r.onupgradeneeded=()=>{r.result.createObjectStore('records',{autoIncrement:true});r.result.createObjectStore('incidents',{keyPath:'id'}).createIndex('at','at');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 await new Promise<void>(resolve=>{const tx=old.transaction('records','readwrite');tx.objectStore('records').add(record('old'));tx.oncomplete=()=>resolve();});old.close();
 const m=await import('../services/CheckoutDiagnostics');await m.readCheckoutDiagnostics();
 const open=()=>new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('clic_pos_checkout_diagnostics_v1',2);r.onsuccess=()=>resolve(r.result);});
 const read=async()=>{const db=await open();const result=await new Promise<any[]>(resolve=>{const r=db.transaction('delivery').objectStore('delivery').getAll();r.onsuccess=()=>resolve(r.result);});db.close();return result;};
 const imported=await read();assert.equal(imported[0].event.record_id,'old');assert.equal(imported[0].sequence,imported[0].event.local_sequence);
 m.setCheckoutTrackingEnabled(true,session);m.recordCheckoutDiagnostic('CHECKOUT_CONFIRM',{items:[]});await m.checkoutDiagnostics.flush();
 for(let round=0;round<3;round++){for(let i=0;i<250;i++)m.recordCheckoutDiagnostic('CART_RENDER',{items:[]});await m.checkoutDiagnostics.flush();}
 const rows=await read();assert.equal(rows.length,500);assert.ok(rows.some(r=>r.event.severity==='WARN'));assert.equal(new Set(rows.map(r=>r.sequence)).size,500);assert.ok(rows.every(r=>r.sequence===r.event.local_sequence));m.setCheckoutTrackingEnabled(false);
});
