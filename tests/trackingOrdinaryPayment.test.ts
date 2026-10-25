import {DURABLE_OUTBOX_SCHEMA_SQL} from '../services/sync/DurableOutboxSchema';
import {financialOperationIdentity} from '../services/db/LargeMasterSyncV3FinancialRetention';
import {buildSalePostedPayload} from '../services/sync/SalePostedContract';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {CapacitorSQLiteAdapter} from '../services/db/adapters/CapacitorSQLiteAdapter';
import {TRACKING_ALLOCATION_SCHEMA,installTrackingAllocation} from '../services/db/TrackingAllocationStore';
import {TRACKING_OPERATION_SCHEMA,assertTrackingOperationReceipt} from '../services/db/TrackingCheckoutOperation';
import {v3RetainedLineFingerprint} from '../services/sync/LargeMasterSyncV3StockAuthority';
import {assertDopFiscalSettlement,configuredFiscalBaseCurrency} from '../services/fiscal/DopFiscalSettlement';
const pos=readFileSync(new URL('../components/POSInterface.tsx',import.meta.url),'utf8'),modal=readFileSync(new URL('../components/PaymentModal.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('POSInterface.tsx',pos,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let before:any;function visit(node:any){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='beforeV3PaymentEffects')before=node.initializer;ts.forEachChild(node,visit);}visit(ast);
const helperStart=pos.indexOf('   const resolveCommittedFiscalReceipt ='),helperEnd=pos.indexOf('   const beforeV3PaymentEffects ='),modalStart=modal.indexOf('   const handleFinalize ='),modalEnd=modal.indexOf('\n   const ',modalStart+10);
async function nativeFixture(){
 const sql=new DatabaseSync(':memory:');sql.exec(TRACKING_ALLOCATION_SCHEMA+TRACKING_OPERATION_SCHEMA);
 const bridge={async query(q:string,p:any[]=[]){return {values:sql.prepare(q).all(...p)};},async run(q:string,p:any[]=[]){return sql.prepare(q).run(...p);},async beginTransaction(){sql.exec('BEGIN IMMEDIATE');},async commitTransaction(){sql.exec('COMMIT');},async rollbackTransaction(){sql.exec('ROLLBACK');},async isTransactionActive(){return {result:sql.isTransaction};}};
 const adapter=new CapacitorSQLiteAdapter();Object.assign(adapter,{db:bridge,isReady:true});
 const scope={tenantId:randomUUID(),companyId:randomUUID(),storeId:randomUUID(),warehouseId:randomUUID(),terminalId:randomUUID(),deviceId:'device'};
 const a:any={...scope,schemaVersion:1,allocationId:randomUUID(),unitId:randomUUID(),itemId:randomUUID(),variantId:'',kind:'LOT',code:'LOT',lotCode:null,expiresOn:null,receivedAt:new Date(Date.now()-100000).toISOString(),issuedAt:new Date(Date.now()-10000).toISOString(),quantityMinor:1000000,quantityScale:1000000,revision:1,unitRevision:1,businessTimezone:'America/Santo_Domingo',bindingHash:'a'.repeat(64)};a.checksum=createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.keys(a).sort().map(k=>[k,a[k]])))).digest('hex');await installTrackingAllocation(bridge,a,false,0,'b'.repeat(64),{serverDeliveredMs:Date.now(),localRequestStartedMs:Date.now(),localReceivedMs:Date.now()});
 const items:any=[{id:a.itemId,cartId:'line',quantity:.125,price:100,type:'PRODUCT',isInventoriable:true,v3SaleAuthority:{warehouseId:scope.warehouseId},trackingData:[{authority:a,quantityMinor:125000,cartId:'line',itemId:a.itemId,variantId:''}]}],payments=[{id:'cash',method:'CASH',amount:12.5}];
 return {sql,bridge,adapter,scope,a,items,payments};
}
test('actual ordinary prepayment and PaymentModal finalize reserve and fence native tracking without a commercial cart mutation',async()=>{
 const {sql,adapter,scope,items,payments}=await nativeFixture();
 const ctx:any={current:{items,payments,total:12.5,inputAmount:'',voluntaryTip:0}},ref:any={current:null};let error='',confirmed=0,cartWrites=0;
 const f:any={completedReservationForReceipt:async()=>null,assertCheckoutFiscalAuthority:async()=>{},hasV3ReservationCart:false,activeV3Reservation:null,selectedCustomer:null,v3Operational:{validate:async()=>{}},fiscalCompliance:{mode:'NONE'},fiscalWorkflowV2Client:{enabled:()=>false,offlineReady:async()=>false},getDefaultFiscalProvider:()=>null,config:{},activeTerminalConfig:{},terminalId:scope.terminalId,activeRecoveredReservation:null,activeDirectV3TicketId:null,activeTable:null,processedCart:items,cart:items,fiscalCheckoutRef:{current:null},fiscalCheckoutOperationRef:{current:null},offlineTableFiscalContextRef:{current:undefined},trackingCheckoutRef:ref,dbAdapter:adapter,durableOutboxRepository:{isSupported:()=>true},trackingLocalScope:()=>scope,currentTrackingCartIdentity:()=>JSON.stringify({lineSources:items.map(v3RetainedLineFingerprint),lineQuantities:items.map((line:any)=>line.quantity),customerId:null,fiscalType:'B02',total:12.5,serviceChargeAmount:0,tableId:null,accountId:null}),createUuid:randomUUID,setLargeMasterSyncV3CriticalOperation:()=>{},onUpdateCart:()=>{cartWrites++;},db:{getDocument:async()=>null}};
 const actualBefore=new Function(...Object.keys(f),ts.transpileModule(pos.slice(helperStart,helperEnd)+'\nconst invoke='+before.getText(ast)+';return invoke;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(...Object.values(f));
 const m:any={finalizationMountedRef:{current:true},finalizationSubmissionRef:{current:false},finalizationProgressRef:{current:null},finalizationContextRef:ctx,yieldInteractionPaint:async()=>{},recordCheckoutDiagnostic:()=>{},items,total:12.5,payments,isFinalizing:false,isProcessingGateway:false,isSuccessScreen:false,recoverCommittedReceipt:async()=>null,setFinalizeError:(value:string)=>{error=value;},setSuccessNotice:()=>{},setIsFinalizing:()=>{},canFinalize:true,isCreditActionBlocked:false,beginPosInteraction:()=>({stages:{}}),expectInteractionRender:()=>{},markInteractionStateUpdate:()=>{},markInteractionStage:()=>{},canFinalizeWithTypedAmount:false,workflowPaymentFenceRef:{current:null},setGatewayProgress:()=>{},beforePaymentEffects:actualBefore,sumCreditPaymentsBase:()=>0,isOnline:true,isMaster:true,measureInteractionStage:(_trace:any,_a:any,_b:any,fn:any)=>fn(),authorizePendingGatewayPayments:async(value:any)=>value,setPayments:()=>{},window:{setTimeout,clearTimeout},voluntaryTip:0,isRefund:false,baseCurrency:{code:'DOP',symbol:'RD$',rate:1},config:{currencies:[{code:'DOP',isBase:true}]},configuredFiscalBaseCurrency,assertDopFiscalSettlement,effectiveTotalToPay:12.5,onConfirm:async()=>{confirmed++;return null;}};
 const execute=new Function(...Object.keys(m),ts.transpileModule(modal.slice(modalStart,modalEnd)+'\nreturn handleFinalize;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(...Object.values(m));await execute();
 assert.equal(cartWrites,0);assert.equal(confirmed,1);assert.doesNotMatch(error,/CONTEXT_CHANGED/);assert.equal(sql.prepare('select phase from pos_tracking_checkout_v1').get()?.phase,'EFFECT_POSSIBLE');assert.deepEqual(JSON.parse(String(sql.prepare('select payment_ids_json from pos_tracking_operations_v1').get()?.payment_ids_json)),['cash']);assert.ok(ref.current.transactionId);
});

test('ordinary tracking recovers its original native receipt after lost COMMIT ACK and restart without consuming again',async()=>{
 const f=await nativeFixture();f.sql.exec("CREATE TABLE documents(collection_name TEXT NOT NULL,doc_id TEXT NOT NULL,data TEXT NOT NULL,sort_order INTEGER,updatedAt TEXT,PRIMARY KEY(collection_name,doc_id));"+DURABLE_OUTBOX_SCHEMA_SQL);
 const transactionId=randomUUID(),checkoutId=randomUUID(),identity=JSON.stringify({lineSources:f.items.map(v3RetainedLineFingerprint),lineQuantities:f.items.map((line:any)=>line.quantity),customerId:null,fiscalType:'B02',total:12.5,serviceChargeAmount:0,tableId:null,accountId:null});
 await f.adapter.prepareTrackingCheckout(checkoutId,f.items.flatMap((line:any)=>line.trackingData),f.scope,{transactionId,cartIdentity:identity});const effectAt=await f.adapter.fenceTrackingCheckout(checkoutId,'cash');
 const source:any={id:transactionId,terminalId:f.scope.terminalId,trackingCheckoutId:checkoutId,trackingEffectAt:new Date(effectAt).toISOString(),items:f.items,payments:f.payments,customerId:null,ncfType:'B02',total:12.5,netAmount:12.5,taxAmount:0,serviceChargeAmount:0,date:new Date(effectAt).toISOString(),documentType:'TICKET',v3WarehouseId:f.scope.warehouseId};source.v3CommitFingerprint=financialOperationIdentity(source,f.scope.warehouseId,{});
 const payload=buildSalePostedPayload(source,{pos_tracking_contract_version:'1',tenant_id:f.scope.tenantId,company_id:f.scope.companyId,store_id:f.scope.storeId,terminal_id:f.scope.terminalId,device_id:f.scope.deviceId});
 const originalCommit=f.bridge.commitTransaction;f.bridge.commitTransaction=async()=>{await originalCommit();throw Error('lost native ACK');};
 await assert.rejects(f.adapter.commitFinancialTransaction({documents:[{collectionName:'transactions',document:source,requireAbsent:true},{collectionName:'transactionHistory',document:source,requireAbsent:true}],outboxEvent:{eventId:randomUUID(),eventType:'SALE_POSTED',aggregateType:'Transaction',aggregateId:source.id,schemaVersion:1,payload,createdAt:source.date},trackingCommits:[{checkoutId,transactionId,selections:f.items.flatMap((line:any)=>line.trackingData)}]}),/COMMIT_UNCERTAIN/);
 f.bridge.commitTransaction=originalCommit;const operation=await f.adapter.readTrackingCheckout(identity,f.scope);assert.equal(operation?.phase,'CONSUMED');const recovered=await f.adapter.readCommittedTrackingReceipt(operation!);assert.equal(recovered?.id,source.id);assert.equal(JSON.stringify(recovered),JSON.stringify(source));assert.equal(f.sql.prepare('select consumed_minor from pos_tracking_allocations_v1').get()?.consumed_minor,125000);assert.equal(f.sql.prepare('select count(*) n from sync_outbox_v2').get()?.n,1);
 const restart=new CapacitorSQLiteAdapter();Object.assign(restart,{db:f.bridge,isReady:true});assert.equal((await restart.readCommittedTrackingReceipt((await restart.readTrackingCheckout(identity,f.scope))!))?.id,source.id);assert.equal(f.sql.prepare('select consumed_minor from pos_tracking_allocations_v1').get()?.consumed_minor,125000);
});

test('pre-effect cancellation retires the durable operation and a fresh checkout can claim the same lot',async()=>{
 const f=await nativeFixture(),identity=JSON.stringify({lineSources:f.items.map(v3RetainedLineFingerprint),lineQuantities:f.items.map((line:any)=>line.quantity),customerId:null,fiscalType:'B02',total:12.5,serviceChargeAmount:0,tableId:null,accountId:null});
 const first=randomUUID(),second=randomUUID();
 await f.adapter.prepareTrackingCheckout(first,f.items.flatMap((line:any)=>line.trackingData),f.scope,{transactionId:randomUUID(),cartIdentity:identity});
 await f.adapter.abandonTrackingCheckout(first);
 assert.equal(await f.adapter.readTrackingCheckout(identity,f.scope),null);
 await f.adapter.prepareTrackingCheckout(second,f.items.flatMap((line:any)=>line.trackingData),f.scope,{transactionId:randomUUID(),cartIdentity:identity});
 assert.equal((await f.adapter.readTrackingCheckout(identity,f.scope))?.checkoutId,second);
 await f.adapter.fenceTrackingCheckout(second,'cash');
 await assert.rejects(f.adapter.abandonTrackingCheckout(second),/EFFECT|PAID|RECONCILIATION/);
 assert.equal((await f.adapter.readTrackingCheckout(identity,f.scope))?.phase,'EFFECT_POSSIBLE');
});

 test('tracking receipt source rejects changed quantities even when price and total stay equal', async()=>{
 const f=await nativeFixture();const identity=JSON.stringify({lineSources:f.items.map(v3RetainedLineFingerprint),lineQuantities:[.125],customerId:null,fiscalType:'B02',total:0,serviceChargeAmount:0,tableId:null,accountId:null});
 const checkoutId=randomUUID(),transactionId=randomUUID();await f.adapter.prepareTrackingCheckout(checkoutId,f.items.flatMap((line:any)=>line.trackingData),f.scope,{transactionId,cartIdentity:identity});await f.adapter.fenceTrackingCheckout(checkoutId,'cash');const operation=(await f.adapter.readTrackingCheckout(identity,f.scope))!;
 const source:any={id:transactionId,trackingCheckoutId:checkoutId,terminalId:f.scope.terminalId,ncfType:'B02',total:0,items:f.items,payments:f.payments};
 assertTrackingOperationReceipt(operation,source,identity,f.scope);
 assert.throws(()=>assertTrackingOperationReceipt(operation,{...source,items:[{...f.items[0],quantity:.25}]},identity,f.scope),/RECONCILIATION_REQUIRED/);
 });
