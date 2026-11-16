import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {nativeFixture,seedNativeFiscal,id} from './articleFormatsNativeFixture';
import {clearDeferredFiscalReservation} from '../services/fiscal/DeferredFiscalReservation';

async function fixture(t:any,type:'B01'|'B02'='B02'){
 const f=await nativeFixture(),seed=seedNativeFiscal(f);
 const put=(name:string,value:any)=>f.db.prepare('INSERT OR REPLACE INTO documents VALUES(?,?,?,?,?)').run(name,value.id,JSON.stringify(value),0,'fixture');
 const range={...seed.range,type,prefix:type},allocation={...seed.allocation,ncfType:type,prefix:type,nextNumber:2};
 const otherType:'B01'|'B02'=type==='B01'?'B02':'B01',otherRange={...range,id:id(84),type:otherType,prefix:otherType},otherAllocation={...allocation,id:id(83),fiscalRangeId:id(84),ncfType:otherType,prefix:otherType};
 const config=seed.config;config.terminals[0].config.fiscal={mode:'LEGACY_B',enabled:true,fiscalRanges:[range,otherRange],fiscalAllocations:[allocation,otherAllocation]};
 put('config',config);put('fiscalRanges',range);put('fiscalAllocations',allocation);put('fiscalRanges',otherRange);put('fiscalAllocations',otherAllocation);f.db.prepare("DELETE FROM documents WHERE collection_name='localFiscalBuffer'").run();
 const {dbAdapter}=await import('../services/db'),{db}=await import('../utils/db');
 const names=['getCollection','saveCollection','getDocument','executeSQL','reserveFinancialNumbers'] as const;
 const originals=new Map(names.map(n=>[n,(dbAdapter as any)[n]]));for(const n of names)(dbAdapter as any)[n]=(f.adapter as any)[n].bind(f.adapter);
 t.after(()=>{for(const n of names){if(originals.get(n))(dbAdapter as any)[n]=originals.get(n);else delete (dbAdapter as any)[n];}clearDeferredFiscalReservation('B0100000002');clearDeferredFiscalReservation('B0200000002');f.db.close();});
 const binding=JSON.stringify([id(1),id(4),id(50),'https://erp.invalid','https://erp.invalid']);
 const stamp={binding,warehouseId:id(5),syncId:id(60),syncVersion:32,tariffId:id(6),taxIncluded:false,inventoryVersion:4,inventoryCursor:'inventory-cursor'};
 const session={binding,ready:{runtime:{version:{syncId:id(60),syncVersion:32}}},assertCurrent:async()=>{},projectConfig:async(c:any)=>c,
  validate:async(_c:any,items:any[],_t:any,_w:any,_i:any,validated:any)=>{for(const line of items)validated?.(line,line);},
  stockRequirements:async(_c:any,items:any[])=>items.map(line=>({baseline:JSON.stringify([binding,id(60),32,4,'inventory-cursor']),productId:line.id,warehouseId:id(5),quantity:line.quantity}))};
 const fixtureState={adapter:f.adapter,db,session,configContextAcquisitions:0};
 t.after(()=>assert.equal(fixtureState.configContextAcquisitions,0,'checkout must not refresh the operational config context'));
 const global=globalThis as any;global.__atomicLegacyFixture=fixtureState;global.window={dispatchEvent:()=>{}};global.localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
 const mocks:Record<string,string>={
 '../db':'export const dbAdapter=globalThis.__atomicLegacyFixture.adapter;',
 '../../utils/db':'export const db=globalThis.__atomicLegacyFixture.db;',
 '../utils/db':'export const db=globalThis.__atomicLegacyFixture.db;',
 './SyncFeatureFlags':"export const isSyncFeatureEnabled=name=>name==='sqlite_outbox_v2';",
 './sync/SyncFeatureFlags':"export const isSyncFeatureEnabled=name=>name==='sqlite_outbox_v2';",
 './DurableOutboxRepository':'export const durableOutboxRepository={commitFinancialTransaction:input=>globalThis.__atomicLegacyFixture.adapter.commitFinancialTransaction(input)};',
 './LargeMasterSyncV3OperationalSession':'export const acquireLargeMasterSyncV3ConfigContext=async()=>{globalThis.__atomicLegacyFixture.configContextAcquisitions++;throw Error("unexpected config-context acquisition in atomic checkout fixture")};export const getLargeMasterSyncV3OperationalSession=async()=>globalThis.__atomicLegacyFixture.session;export const getLargeMasterSyncV3RetainedSession=async()=>globalThis.__atomicLegacyFixture.session;export const v3InventoryBaselineKey=(binding,s)=>JSON.stringify([binding,s.syncId,s.syncVersion,s.inventoryVersion,s.inventoryCursor]);',
 './sync/LargeMasterSyncV3OperationalSession':'export const acquireLargeMasterSyncV3ConfigContext=async()=>{globalThis.__atomicLegacyFixture.configContextAcquisitions++;throw Error("unexpected config-context acquisition in atomic checkout fixture")};export const getLargeMasterSyncV3OperationalSession=async()=>globalThis.__atomicLegacyFixture.session;',
 './CheckoutDiagnostics':'export const recordCheckoutDiagnostic=()=>{};',
 '../CheckoutDiagnostics':'export const recordCheckoutDiagnostic=()=>{};',
 };
 const bundle=await build({stdin:{contents:`export {transactionService} from './services/transactionService';export * from './services/sync/LargeMasterSyncV3FinancialCommit';`,resolveDir:new URL('..',import.meta.url).pathname,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'atomic-checkout-boundaries',setup(b){b.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'js'}));}}]});
 const module=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text+'\n//'+crypto.randomUUID()).toString('base64'));
 const reserve=(code=type)=>db.reserveFiscalNumber(code,id(4),1,undefined,undefined,undefined,true);
 const reserved=await reserve();assert.ok(reserved);
 const draft=async(name=id(71),selected=reserved)=>module.transactionService.createTransaction({id:name,documentType:'TICKET',seriesId:id(9),terminalId:id(4),date:'2026-11-15T12:00:00Z',status:'COMPLETED',userId:id(25),userName:'Fixture',fiscalMode:'LEGACY_B',ncfType:selected!.fiscalIssuance.ncfType,ncf:selected!.ncf,fiscalIssuance:selected!.fiscalIssuance,
  total:100,netAmount:100,taxAmount:0,payments:[{id:name+'-payment',method:'CASH',amount:100,timestamp:new Date('2026-11-15T12:00:00Z')}],items:[{id:id(7),cartId:name+'-line',name:'Synthetic',type:'PRODUCT',isInventoriable:true,taxable:false,appliedTaxIds:[],price:100,quantity:1,netAmount:100,taxAmount:0,totalAmount:100,v3SaleAuthority:stamp}]},{deferDurablePersistence:true,deferLegacySaleNumbering:true}).catch((error:any)=>{error.stack=error.message;throw error;});
 const state=()=>({docs:f.db.prepare('SELECT * FROM documents ORDER BY collection_name,doc_id').all(),outbox:f.db.prepare('SELECT * FROM sync_outbox_v2 ORDER BY event_id').all()});
 const commit=(tx:any)=>module.persistV3FinancialTransaction(tx,config,id(5)).catch((error:any)=>{error.stack=error.message;throw error;});
 return {...f,module,config,allocation,put,draft,reserve,state,commit,otherType};
}
for(const type of ['B01','B02'] as const)test(`${type}: draft reserves nothing; ticket, NCF, sale/history, stock and events commit together`,async t=>{
 const f=await fixture(t,type),before=f.state(),draft=await f.draft();assert.deepEqual(f.state(),before);
 assert.equal(draft.globalSequence,undefined);assert.equal(draft.displayId,undefined);assert.equal(draft.seriesNumber,undefined);
 const result=await f.commit(draft);assert.equal(result.created,true);assert.equal(result.transaction.displayId,'TCK-000001');assert.equal(result.transaction.globalSequence,1);
 assert.equal(f.documents('internalSequences').find(s=>s.id===id(9)).nextNumber,2);assert.equal(f.documents('globalSequenceCounter')[0].count,1);
 assert.equal(f.documents('fiscalAllocations').find(a=>a.id===f.allocation.id).nextNumber,3);assert.equal(f.documents('nativeFiscalReservations').length,1);
 assert.equal(f.documents('transactions').length,1);assert.equal(f.documents('transactionHistory').length,1);assert.equal(f.documents('inventoryLedger').length,1);
 assert.equal((f.db.prepare('SELECT count(*) n FROM sync_outbox_v2').get() as {n:number}).n,2);
 const after=f.state();assert.equal((await f.commit(draft)).created,false);assert.deepEqual(f.state(),after);
 assert.equal((await f.module.readV3CommittedLegacySaleReplay(draft,id(5))).displayId,'TCK-000001');
 for(const changed of [{...draft,total:101},{...draft,ncf:type+'00000003'},{...draft,seriesNumber:99},{...draft,globalSequence:99},{...draft,displayId:'foreign'},{...draft,terminalId:id(90)}])await assert.rejects(f.module.readV3CommittedLegacySaleReplay(changed,id(5)),/MISMATCH|SOURCE_INVALID/);
});
test('every failed SQL write rolls back ticket, NCF, sale and Outbox; retry has no number gap',async t=>{
 const successful=await fixture(t),tx=await successful.draft();successful.fault.writes=0;await successful.commit(tx);const count=successful.fault.writes;
 for(let write=0;write<count;write++){
  await t.test(`write ${write}`,async st=>{const f=await fixture(st),draft=await f.draft(),before=f.state();f.fault.writes=0;f.fault.failWrite=write;
   await assert.rejects(f.commit(draft),/injected-write/);assert.deepEqual(f.state(),before);f.fault.failWrite=undefined;
   const committed=await f.commit(draft);assert.equal(committed.transaction.seriesNumber,1);assert.equal(committed.transaction.ncf,draft.ncf);
  });
 }
});
test('lost successful COMMIT response replays the same final ticket and NCF without another increment',async t=>{
 const f=await fixture(t),draft=await f.draft();const bridge=(f.adapter as any).db,execute=bridge.execute;let loseResponse=true;bridge.execute=async(sql:string,...args:any[])=>{const result=await execute(sql,...args);if(loseResponse&&/^COMMIT/i.test(sql)){loseResponse=false;throw Error('lost-commit-response');}return result;};
 await assert.rejects(f.commit(draft),/lost-commit-response/);bridge.execute=execute;
 const committed=f.state();const replay=await f.commit(draft);assert.equal(replay.created,false);assert.equal(replay.transaction.seriesNumber,1);assert.deepEqual(f.state(),committed);
 await assert.rejects(f.commit({...draft,id:id(90)}),/ALREADY_ISSUED/);assert.deepEqual(f.state(),committed);
});
test('stock validation failure consumes neither sequence nor NCF',async t=>{
 const f=await fixture(t),draft=await f.draft();f.db.prepare('UPDATE master_v3_inventory_balances SET qty_on_hand=0,qty_reserved=0,qty_committed=0').run();const before=f.state();
 await assert.rejects(f.commit(draft),/STOCK_INSUFFICIENT/);assert.deepEqual(f.state(),before);
 f.db.prepare('UPDATE master_v3_inventory_balances SET qty_on_hand=137').run();assert.equal((await f.commit(draft)).transaction.seriesNumber,1);
});

test('concurrent distinct B01/B02 intents share series CAS; losing retry uses the next ticket without burning its NCF',async t=>{
 const f=await fixture(t),first=await f.draft(),other=await f.reserve(f.otherType),second=await f.draft(id(81),other);
 const attempts=await Promise.allSettled([f.commit(first),f.commit(second)]);assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
 const failed=attempts.findIndex(r=>r.status==='rejected');assert.match(String((attempts[failed] as PromiseRejectedResult).reason),/SOURCE_CHANGED|CONFLICT|CONCURRENT_FINANCIAL_UPDATE/);
 assert.equal(f.documents('nativeFiscalReservations').length,1);assert.equal(f.documents('internalSequences').find(s=>s.id===id(9)).nextNumber,2);
 const retried=await f.commit(failed===0?first:second);assert.equal(retried.transaction.seriesNumber,2);assert.equal(retried.transaction.ncf,(failed===0?first:second).ncf);
 assert.equal(f.documents('internalSequences').find(s=>s.id===id(9)).nextNumber,3);assert.equal(f.documents('globalSequenceCounter')[0].count,2);assert.equal(f.documents('nativeFiscalReservations').length,2);
});
test('the last NCF and stock unit commit once; replay succeeds after exhaustion',async t=>{
 const f=await fixture(t);const allocation={...f.allocation,reservedEnd:2};f.put('fiscalAllocations',allocation);f.config.terminals[0].config.fiscal.fiscalAllocations[0]=allocation;f.put('config',f.config);
 f.db.prepare('UPDATE master_v3_inventory_balances SET qty_on_hand=1,qty_reserved=0,qty_committed=0').run();
 const draft=await f.draft();const result=await f.commit(draft);assert.equal(result.transaction.seriesNumber,1);assert.equal(f.documents('fiscalAllocations').find(a=>a.id===allocation.id).status,'EXHAUSTED');
 assert.equal((await f.commit(draft)).created,false);assert.equal((await f.module.readV3CommittedLegacySaleReplay(draft,id(5))).seriesNumber,1);
});
test('invalid series or revoked fiscal authority fail before any numbering is consumed',async t=>{
 const f=await fixture(t),draft=await f.draft(),series=f.documents('internalSequences').find(s=>s.id===id(9));
 f.put('internalSequences',{...series,active:false});let before=f.state();await assert.rejects(f.commit(draft),/SERIES_FORBIDDEN/);assert.deepEqual(f.state(),before);
 f.put('internalSequences',series);f.put('fiscalAllocations',{...f.allocation,status:'RELEASED'});before=f.state();await assert.rejects(f.commit(draft),/FISCAL/);assert.deepEqual(f.state(),before);
});
test('opt-in cannot turn another flow or preassigned numbers into a new ordinary sale',async t=>{
 const f=await fixture(t),draft=await f.draft();for(const mutation of [{documentType:'REFUND'},{fiscalWorkflowCheckoutId:id(80)},{restaurantTableId:id(80)},{seriesNumber:1},{globalSequence:1},{displayId:'preassigned'}]){
  const before=f.state();await assert.rejects(f.module.transactionService.createTransaction({...draft,...mutation},{deferDurablePersistence:true,deferLegacySaleNumbering:true}),/LEGACY_ATOMIC/);assert.deepEqual(f.state(),before);
 }
 await assert.rejects(f.module.persistV3FinancialBatch([{transaction:draft},{transaction:{...draft,id:id(80)}}],f.config,id(5)),/LEGACY_ATOMIC/);
});
