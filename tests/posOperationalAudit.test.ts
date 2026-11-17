import { IDBFactory } from 'fake-indexeddb';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { IndexedDBAdapter } from '../services/db/adapters/IndexedDBAdapter';
import { buildAuthorizationLog, authorizationQueueItem, persistAuthorizationLog, reconcileAuthorizationBackups, posAuditWireItem, assertPosAuditAcknowledgement } from '../services/audit/PosOperationalAudit';
import type { BusinessConfig, User } from '../types';

function browser() {
    const descriptors = new Map(['localStorage','indexedDB','window'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis,key)]));
    const values = new Map<string,string>();
    Object.defineProperties(globalThis, {
        localStorage: { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string,value: string) => values.set(key,value), removeItem: (key: string) => values.delete(key) } },
        indexedDB: { configurable: true, value: new IDBFactory() },
        window: { configurable: true, value: { setTimeout,clearTimeout } },
    });
    return () => { for (const [key,descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis,key,descriptor); else delete (globalThis as any)[key]; } };
}
const user = (id: string): User => ({ id, name: `Usuario ${id}`, pin: 'DO_NOT_SEND', role: 'cashier', isActive: true } as User);
const log = () => buildAuthorizationLog(user('cashier'), user('supervisor'), { permission: 'POS_DISCOUNT', actionDescription: 'Autorizar descuento', context: { ticketId: 'T-1', originalValue: 0, newValue: 10 } }, 'POS-1');
const config = { id: 'current', auditLogs: [], marker: 'preserve-current-state' } as unknown as BusinessConfig & { id: string };

test('browser upgrade from v27 preserves sales, Z reports and transfers and adds audit queue', async () => {
    const restore = browser();
    try {
        const old = await new Promise<IDBDatabase>((resolve,reject) => { const request = indexedDB.open('clic_pos_indexeddb',27); request.onupgradeneeded = () => { for (const name of ['config','transactions','zReports','transfers']) request.result.createObjectStore(name,{keyPath:'id'}); }; request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result); });
        await new Promise<void>((resolve,reject) => { const tx = old.transaction(['transactions','zReports','transfers'],'readwrite'); for (const name of ['transactions','zReports','transfers']) tx.objectStore(name).put({id:`preserved-${name}`,value:42}); tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error); });
        old.close();
        const database = new IndexedDBAdapter(); await database.connect();
        for (const name of ['transactions','zReports','transfers']) assert.deepEqual(await database.getDocument(name,`preserved-${name}`),{id:`preserved-${name}`,value:42});
        const entry=log(); assert.equal(await persistAuthorizationLog(database,config,entry),null);
        await database.disconnect();
        const reopened = new IndexedDBAdapter(); await reopened.connect();
        const stored = await reopened.getDocument<any>('posAuditEvents',entry.id); assert.equal(stored.syncStatus,'PENDING'); assert.equal(stored.event.id,entry.id);
        await reopened.disconnect();
    } finally { restore(); }
});

test('queue storage failure retains serialized config backups and reconciliation never resets an ACK', async () => {
    const restore = browser();
    try {
        const database = new IndexedDBAdapter(); await database.connect(); await database.saveDocument('config',config);
        const broken = { ...database, getDocument: database.getDocument.bind(database), saveDocument: async (collection: string,doc: any) => { if (collection==='posAuditEvents') throw Error('injected-queue-failure'); await database.saveDocument(collection,doc); } } as any;
        const first=log(), second=log();
        const warnings=await Promise.all([persistAuthorizationLog(broken,config,first),persistAuthorizationLog(broken,config,second)]);
        assert.ok(warnings.every(Boolean));
        const stored=await database.getDocument<any>('config','current'); assert.equal(stored.auditLogs.length,2);assert.equal(stored.marker,'preserve-current-state');
        await reconcileAuthorizationBackups(database,'POS-1');
        const acked={...authorizationQueueItem(first),syncStatus:'APPLIED_ERP'};
        await database.saveDocument('posAuditEvents',acked);
        await reconcileAuthorizationBackups(database,'POS-1');
        assert.equal((await database.getDocument<any>('posAuditEvents',first.id)).syncStatus,'APPLIED_ERP');
        assert.equal((await database.getCollection('posAuditEvents')).length,2);
        // Simulate normal retention pruning after ACK. Recovery receipts survive
        // that queue cleanup, so marked config backups cannot resurrect sent rows.
        await database.deleteDocument('posAuditEvents',first.id);
        await reconcileAuthorizationBackups(database,'POS-1');
        assert.equal(await database.getDocument('posAuditEvents',first.id),null);
        await database.disconnect();
    } finally { restore(); }
});

test('reconciliation uses atomic requireAbsent when an ACK races the preceding lookup', async () => {
    const restore=browser();
    try {
        const database=new IndexedDBAdapter();await database.connect();const entry={...log(),auditRecoveryPending:true};await database.saveDocument('config',{...config,auditLogs:[entry]});
        const raced={ getDocument:database.getDocument.bind(database), saveDocument:database.saveDocument.bind(database), saveDocumentsAtomically:async (...args:any[])=>{await database.saveDocument('posAuditEvents',{...authorizationQueueItem(entry),syncStatus:'APPLIED_ERP'});return (database.saveDocumentsAtomically as any)(...args);} } as any;
        await reconcileAuthorizationBackups(raced,'POS-1');assert.equal((await database.getDocument<any>('posAuditEvents',entry.id)).syncStatus,'APPLIED_ERP');await database.disconnect();
    }finally{restore();}
});

test('missing terminal is retained without assigning historical placeholder logs to a terminal', async () => {
    const restore=browser();
    try {
        const database=new IndexedDBAdapter();await database.connect();const entry={...log(),terminalId:''};
        assert.match(await persistAuthorizationLog(database,config,entry)||'',/pendiente/);
        await reconcileAuthorizationBackups(database,'POS-1');assert.equal((await database.getCollection('posAuditEvents')).length,0);await database.disconnect();
    }finally{restore();}
});

test('declares self/supervisor authorization without claiming applied operations or sending credentials', () => {
    const entry=log();const wire=posAuditWireItem(authorizationQueueItem(entry));
    assert.equal(wire.kind,'AUTHORIZATION');assert.equal(wire.event.actionType,'POS_DISCOUNT');
    assert.equal(JSON.stringify(wire).includes('DO_NOT_SEND'),false);assert.equal(JSON.stringify(wire).includes('simulated'),false);assert.equal(JSON.stringify(wire).includes('syncStatus'),false);
    const self=buildAuthorizationLog(user('same'),user('same'),{permission:'POS_DISCOUNT',actionDescription:'Prueba'},'POS-1');assert.equal(self.cashierId,self.supervisorId);
    const invoice={id:'invoice',idempotencyKey:'stable-invoice',terminalId:'POS-1',eventType:'EMAIL_REQUESTED',transactionId:'T-1',actorId:'a',actorName:'A',occurredAt:entry.timestamp,metadata:{token:'DO_NOT_SEND'},syncStatus:'PENDING'} as any;
    assert.equal(posAuditWireItem(invoice,true).event.idempotencyKey,'stable-invoice');assert.equal(JSON.stringify(posAuditWireItem(invoice,true)).includes('DO_NOT_SEND'),false);
});

test('old endpoint, partial receipt and missing/mismatched ACK never confirm a local row', () => {
    for(const response of [{status:'success'}, {status:'success',results:[]},{status:'success',results:[{eventId:'other',auditId:'10000000-0000-4000-8000-000000000001',disposition:'RECORDED'}]},{status:'success',results:[{eventId:'event',auditId:'10000000-0000-4000-8000-000000000001',disposition:'RECEIVED'}]}])assert.throws(()=>assertPosAuditAcknowledgement(response,'event'),/ACK_NOT_DURABLE/);
    assert.doesNotThrow(()=>assertPosAuditAcknowledgement({status:'success',results:[{eventId:'event',auditId:'10000000-0000-4000-8000-000000000001',disposition:'RECORDED'}]},'event'));
});

test('worker keeps audit after commercial queues, respects sale activity and legacy invoice ownership; hook rechecks async authorization',()=>{
    const worker=readFileSync(new URL('../services/sync/BackgroundSyncManager.ts',import.meta.url),'utf8');
    assert.ok(worker.indexOf("processCollection<any>('posAuditEvents'")>worker.indexOf("processCollection<any>('loyalty_events'"));
    assert.match(worker,/pos_operational_audit'\) && \['ERP_ACTIVE', 'POS_CLOUD_STAGING'\]\.includes\(operationalTarget.kind\) && !isPosSaleActive\(\)/);assert.match(worker,/!isSyncFeatureEnabled\('sqlite_outbox_v2'\) \|\| !durableOutboxRepository.isSupported\(\)/);
    const hook=readFileSync(new URL('../hooks/useSupervisorAuth.ts',import.meta.url),'utf8');assert.match(hook,/await persistAuthorizationLog/);assert.match(hook,/authorizationInFlight.current/);assert.match(hook,/authContextRef.current.currentUser !== currentUser/);assert.match(hook,/await logAction[\s\S]*if \(pendingRef.current !== request\) return/);
});
