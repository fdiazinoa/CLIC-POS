import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';

test('legacy invoice audit remains counted and delivered after native Outbox is enabled',async()=>{
    const values=new Map<string,string>();const globals=new Map(['window','localStorage','indexedDB','navigator'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
    const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)};
    Object.defineProperties(globalThis,{window:{configurable:true,value:{setTimeout,clearTimeout,localStorage:storage,dispatchEvent:()=>true,addEventListener:()=>undefined,removeEventListener:()=>undefined}},localStorage:{configurable:true,value:storage},indexedDB:{configurable:true,value:new IDBFactory()},navigator:{configurable:true,value:{onLine:true}}});
    const restore:Array<()=>void>=[];let database:any;
    const replace=(target:any,key:string,value:any)=>{const original=target[key];target[key]=value;restore.push(()=>{target[key]=original;});};
    try{
        const [{backgroundSyncManager:worker},{db},{dbAdapter},{permissionService},{syncPolicy},{apiSyncAdapter},{durableOutboxRepository},{durableOutboxBatchSender},{setLocalSyncFeatureOverride}]=await Promise.all([import('../services/sync/BackgroundSyncManager'),import('../utils/db'),import('../services/db'),import('../services/sync/PermissionService'),import('../services/sync/SyncProfile'),import('../services/sync/ApiSyncAdapter'),import('../services/sync/DurableOutboxRepository'),import('../services/sync/DurableOutboxBatchSender'),import('../services/sync/SyncFeatureFlags')]);
        const {syncMetrics}=await import('../services/sync/SyncMetrics');
        database=dbAdapter;await database.connect();
        const config={id:'current',terminals:[{id:'POS-1',config:{}}]} as any;
        const collections=new Map<string,any>([['config',config],['invoiceAuditEvents',[]]]);
        replace(db,'get',async(name:string)=>collections.get(name)??[]);
        replace(db,'saveDocument',async(name:string,row:any)=>{const records=(collections.get(name)||[]) as any[];collections.set(name,[...records.filter(item=>item.id!==row.id),{...row}]);});
        replace(permissionService,'isMasterTerminal',()=>true);permissionService.initialize(config,'POS-1');
        replace(syncPolicy,'resolve',()=>({kind:'ERP_ACTIVE',canPushOperations:true}));replace(syncPolicy,'targetKind',()=> 'ERP_ACTIVE');
        replace(durableOutboxRepository,'isSupported',()=>true);
        replace(durableOutboxRepository,'hasPendingTrackingEvents',async()=>false);replace(durableOutboxRepository,'hasPendingReturnEvents',async()=>false);
        replace(durableOutboxRepository,'refreshMetrics',async()=>{syncMetrics.setOutboxState(0,null);});replace(durableOutboxBatchSender,'sendNext',async()=>({retrying:0}));
        replace(worker as any,'scheduleSync',()=>undefined);replace(worker as any,'yieldToOperatorUi',async()=>undefined);replace(worker as any,'pruneSyncedItems',async()=>undefined);
        setLocalSyncFeatureOverride('sqlite_outbox_v2',false);
        const event={id:'legacy-before-rollout',idempotencyKey:'legacy-before-rollout',terminalId:'POS-1',eventType:'EMAIL_REQUESTED',transactionId:'T-1',actorId:'cashier',actorName:'Cashier',occurredAt:new Date().toISOString(),syncStatus:'PENDING'};
        await db.saveDocument('invoiceAuditEvents',event as any);
        await (worker as any).updatePendingCount(['invoiceAuditEvents']);assert.equal(worker.getState().pendingCount,1);
        // This row was created without an Outbox row. The flag cannot retroactively own it.
        setLocalSyncFeatureOverride('sqlite_outbox_v2',true);
        await (worker as any).updatePendingCount(['invoiceAuditEvents']);assert.equal(worker.getState().pendingCount,1);
        const sent:string[]=[];replace(apiSyncAdapter,'pushAuditEvent',async(row:any,invoice:boolean)=>{assert.equal(invoice,true);sent.push(row.idempotencyKey);return {status:'success',results:[{eventId:row.idempotencyKey,auditId:'10000000-0000-4000-8000-000000000001',disposition:'RECORDED'}]};});
        // Exercise the actual collection sender and counter. Whole-worker browser
        // scheduling is outside this Node fixture (unrelated Vite-only catalog path).
        await (worker as any).processCollection('invoiceAuditEvents',(row:any)=>apiSyncAdapter.pushAuditEvent(row,true));
        await (worker as any).updatePendingCount(['invoiceAuditEvents']);
        assert.deepEqual(sent,['legacy-before-rollout']);
        assert.equal(collections.get('invoiceAuditEvents')[0].syncStatus,'APPLIED_ERP');assert.equal(worker.getState().pendingCount,0);
    }finally{for(const undo of restore.reverse())undo();await database?.disconnect();for(const[key,descriptor]of globals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete(globalThis as any)[key];}}
});
