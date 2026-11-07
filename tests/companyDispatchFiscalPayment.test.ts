import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {randomUUID} from 'node:crypto';
import{nativeFixture,id}from'./articleFormatsNativeFixture';
import{LargeMasterSyncV3Runtime}from'../services/sync/LargeMasterSyncV3Runtime';
import{freezeAuthoritativeLineFiscalAmounts}from'../utils/fiscalBreakdown';
import{dispatchCommercialSource,dispatchPaymentIntents}from'../services/db/CompanyDispatchEscrowStore';
import{describeFiscalCheckoutFailure}from'../utils/fiscalCheckoutErrorMessages';
import{assertDopFiscalSettlement,configuredFiscalBaseCurrency}from'../services/fiscal/DopFiscalSettlement';
import{compileDispatchCheckoutSource}from'../services/dispatch/DispatchCheckoutSource';
import{fiscalWorkflowScopeKey}from'../services/fiscal/FiscalWorkflowV2Types';
import{getInitialConfig}from'../constants';
import{SubVertical}from'../types';
import ts from'typescript';
import{readFileSync}from'node:fs';
import{assertFormatsPostingClosed}from'../services/articleFormats/activation';
import{financialIdentity}from'../services/db/LargeMasterSyncV3FinancialRetention';
function actual(file:string,name:string,bindings:Record<string,any>){const tree=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let expression:ts.Expression|undefined;function visit(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(tree)===name)expression=node.initializer;ts.forEachChild(node,visit);}visit(tree);assert.ok(expression);return new Function(...Object.keys(bindings),ts.transpileModule('const result='+expression.getText(tree)+';return result;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(...Object.values(bindings));}
let bundle:Promise<any>;
async function modules(f:any,durable=true) {
 const globals=globalThis as any;
 globals.__dispatchFiscal={adapter:f.adapter,identity:{tenantId:id(1),terminalId:id(4),deviceId:id(50),erpSyncBaseUrl:'https://erp.invalid',syncToken:'synthetic'},session:undefined,durable,db:{get:(n:string)=>f.adapter.getCollection(n),getDocument:(...a:any[])=>f.adapter.getDocument(...a),save:(...a:any[])=>f.adapter.saveCollection(...a),saveDocument:(...a:any[])=>f.adapter.saveDocument(...a),reserveTransactionNumbers:(seriesId:string,documentType:string)=>f.adapter.reserveFinancialNumbers({seriesId,documentType:documentType as any,global:true}),assertFiscalTransactionAuthority:async()=>{}}};
 globals.window={dispatchEvent:()=>{}};
 bundle ||= build({stdin:{contents:`export {LargeMasterSyncV3OperationalSession as Session} from './services/sync/LargeMasterSyncV3OperationalSession';export {claimV3Reservation,expireV3Reservation,restoreV3ReservationReference} from './services/sync/LargeMasterSyncV3ReservationRecovery';export {persistV3FinancialTransaction,readV3CompletedReservation} from './services/sync/LargeMasterSyncV3FinancialCommit';export {transactionService} from './services/transactionService';export {transferStockToCommitted} from './utils/inventoryEngine';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',define:{'import.meta.env':'{}'},plugins:[{name:'dispatch-fiscal-existing-ports',setup(b){
 const ports:Record<string,string>={
 './db':'export const db={adjustCommittedStock:(...a)=>globalThis.__dispatchFiscal.adjustCommittedStock(...a)};',
 '../db':'export const dbAdapter=new Proxy({}, {get:(_t,k)=>{const a=globalThis.__dispatchFiscal.adapter;return typeof a[k]==="function"?a[k].bind(a):a[k];}});',
 '../../utils/db':'export const db=new Proxy({}, {get:(_t,k)=>{const d=globalThis.__dispatchFiscal.db;return typeof d[k]==="function"?d[k].bind(d):d[k];}});',
 '../utils/db':'export const db=new Proxy({}, {get:(_t,k)=>{const d=globalThis.__dispatchFiscal.db;return typeof d[k]==="function"?d[k].bind(d):d[k];}});',
 './CheckoutDiagnostics':'export const recordCheckoutDiagnostic=()=>{};',
 './sync/SyncFeatureFlags':'export const isSyncFeatureEnabled=name=>name==="sqlite_outbox_v2"&&globalThis.__dispatchFiscal.durable;',
 './sync/LargeMasterSyncV3OperationalSession':'export const getLargeMasterSyncV3OperationalSession=async()=>globalThis.__dispatchFiscal.session;export const getLargeMasterSyncV3RetainedSession=async()=>globalThis.__dispatchFiscal.session;',
 './LargeMasterSyncV3BoundTransport':'export const readLargeMasterSyncV3BoundIdentity=()=>globalThis.__dispatchFiscal.identity;export const validatedLargeMasterSyncV3ErpSyncBase=v=>v;export const createLargeMasterSyncV3BoundClient=()=>{throw Error("no network");};',
 './LargeMasterSyncV3Platform':'export const assertLargeMasterSyncV3NativeAndroid=()=>{};',
 './LargeMasterSyncV3OperationalSession':'export const getLargeMasterSyncV3OperationalSession=async()=>globalThis.__dispatchFiscal.session;export const getLargeMasterSyncV3RetainedSession=async()=>globalThis.__dispatchFiscal.session;export const v3InventoryBaselineKey=(b,s)=>JSON.stringify([b,s.inventorySyncId||s.syncId,s.inventorySyncVersion??s.syncVersion,s.inventoryVersion,s.inventoryCursor]);',
 './SyncFeatureFlags':'export const isSyncFeatureEnabled=()=>globalThis.__dispatchFiscal.durable;',
 './DurableOutboxRepository':'export const durableOutboxRepository={commitFinancialTransaction:i=>globalThis.__dispatchFiscal.adapter.commitFinancialTransaction(i)};',
 '../CheckoutDiagnostics':'export const recordCheckoutDiagnostic=()=>{};',
 };
 b.onResolve({filter:/.*/},a=>ports[a.path]?{path:a.path,namespace:'reservation'}:undefined);
 b.onLoad({filter:/.*/,namespace:'reservation'},a=>({contents:ports[a.path],loader:'js'}));
 }}]}).then(r=>import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text+'\n//# sourceURL=dispatch-fiscal-native-test.mjs').toString('base64')));
 const m=await bundle,store=f.adapter.masterSyncV3Store,runtime=await LargeMasterSyncV3Runtime.open(store);
 globals.__dispatchFiscal.session=new m.Session({runtime,inventoryVersion:4,inventoryCursor:'inventory-cursor'},(await store.getOperationalOwner())!.binding,store,'https://erp.invalid',globals.__dispatchFiscal.identity);
 return {...m,session:globals.__dispatchFiscal.session};
}

/** Desktop SQLite integration. Master/permit/quota identity inputs are declared
 * fixtures; constructor, financial builder and native transaction are production.
 * No provider, HTTP auth, ERP acceptance or native-plugin claim is made here. */
test('fiscal + inventory preparation and the existing financial writer consume once with no physical ledger',async t=>{
 (globalThis as any).localStorage={getItem:(key:string)=>key==='pos_device_id'?id(50):null,setItem:()=>{},removeItem:()=>{}};
 const f=await nativeFixture();t.after(()=>f.db.close());
 const put=(collection:string,doc:any)=>f.db.prepare('INSERT OR REPLACE INTO documents VALUES(?,?,?,?,?)').run(collection,doc.id,JSON.stringify(doc),0,'fixture');
 const config:any=getInitialConfig(SubVertical.SUPERMARKET);Object.assign(config,{id:'current',fiscalCompliance:{mode:'NONE'},currencies:[{code:'DOP',symbol:'RD$',rate:1,isBase:true,isEnabled:true}],paymentMethods:[{id:'cash',type:'CASH',name:'Efectivo',isEnabled:true}],integrations:[],taxes:[],tariffs:[{id:id(6),name:'Fixture tariff',isActive:true}],terminals:f.documents('config')[0].terminals});put('config',config);
 f.db.prepare("INSERT INTO sync_v3_sessions(sync_id,sync_version,schema_version,contract_version,status,manifest_json,created_at,updated_at) VALUES(?,32,3,2,'ACTIVE','{}','fixture','fixture')").run(id(60));
 const article=JSON.parse((f.db.prepare('SELECT record_json FROM master_v3_articles').get()as any).record_json);article.activeWarehouseIds=[id(5)];f.db.prepare('UPDATE master_v3_articles SET record_json=?').run(JSON.stringify(article));
 f.db.prepare('INSERT INTO master_v3_tariffs(sync_version,tariff_id,active,record_json) VALUES(32,?,1,?)').run(id(6),JSON.stringify({id:id(6),name:'Fixture tariff',active:true,taxIncluded:false}));f.db.prepare('INSERT INTO master_v3_prices VALUES(32,?,?,100)').run(id(7),id(6));
 const m=await modules(f),projected=await m.session.projectConfig(config),product=await m.session.withStock((await(await m.session.catalog(id(6),id(5))).get(id(7))).product,id(5));
 const item={...product,quantity:1,cartId:randomUUID(),netAmount:100,taxAmount:0,totalAmount:100};
 const binding=(await f.adapter.masterSyncV3Store.getOperationalOwner())!.binding;
 f.db.exec("INSERT INTO pos_dispatch_pool_v1 VALUES('pool','binding','generation',1,'WAREHOUSE_DISPATCH',NULL,NULL);INSERT INTO pos_dispatch_active_pool_v1 SELECT 1,'pool',binding FROM master_v3_operational_owner;INSERT INTO pos_dispatch_capture_cursor_v1 VALUES('pool',0)");f.db.prepare("INSERT INTO pos_dispatch_pool_install_v1 VALUES('pool',?,'fixture-witness','fixture-schema')").run(binding);
 const scope={tenantId:id(1),companyId:id(2),storeId:id(3),terminalId:id(4),deviceId:id(50)},master={id:id(7),tenant_id:id(1),company_id:id(2),type:'PRODUCT',taxable:false,metadata:{tariffs:[{tariffId:id(6),price:100}]}};
 const authority={id:'quota',scope:{...scope,warehouseId:id(5),bindingId:'binding',generation:'generation'},policyRevision:1,itemId:id(7),dimensions:{},catalogSource:{commercialItem:master,rawGraph:[master],tariffs:[{id:id(6),tax_included:false}],taxes:[]}};
 f.db.prepare("INSERT INTO pos_dispatch_quota_v1 VALUES('quota','pool',?,'hash',5000000,0,0,'ACTIVE')").run(JSON.stringify(authority));f.db.exec("INSERT INTO pos_dispatch_quota_delivery_v1 VALUES('quota','witness')");
 const fiscal=f.adapter.fiscalWorkflowStore,scopeKey=fiscalWorkflowScopeKey(scope),operation=await fiscal.refillOperation(scopeKey),now=Date.now();await fiscal.savePermits(scopeKey,operation,[{schemaVersion:2,permitId:id(180),transactionId:id(181),nonce:'fixture-nonce',createdAt:new Date(now).toISOString(),expiresAt:new Date(now+600000).toISOString(),scope,issuerRnc:'101010101',environment:0,authorityHash:'a'.repeat(64),operationKind:'SALE',state:'PERMIT'}]);
 const ref:any={current:null},fiscalRef:any={current:null},no=()=>{};let checkout:any,prepared:any,published:any;
 const beforeContext:any={dispatchProjection:{mode:'WAREHOUSE_DISPATCH',phase:'STABLE'},dispatchCheckoutRef:ref,dbAdapter:f.adapter,processedCart:[item],cart:[item],cartTotal:100,cartTax:0,cartTip:0,taxBreakdown:[],discountAmount:0,globalDiscount:{type:'FIXED',value:0},isTaxIncluded:false,baseCurrency:{code:'DOP'},effectiveSelectedCustomer:null,isSelectedCustomerTaxExempt:false,currentUser:{id:id(25)},defaultSalesWarehouseId:id(5),redeemedCoupon:null,config:projected,activeTerminalConfig:projected.terminals[0].config,appliedServiceTaxPolicy:{taxIds:[]},freezeAuthoritativeLineFiscalAmounts,compileDispatchCheckoutSource,dispatchCommercialSource,dispatchPaymentIntents,completedReservationForReceipt:async()=>null,resolveCommittedFiscalReceipt:async()=>null,resolveCommittedTrackingReceipt:async()=>null,assertCheckoutFiscalAuthority:async()=>{},hasV3ReservationCart:false,activeV3Reservation:null,selectedCustomer:null,v3Operational:{validate:(cart:any)=>m.session.validate(projected,cart,id(6),id(5),'SALE')},fiscalCompliance:{mode:'ECF'},fiscalWorkflowV2Client:{enabled:()=>true,offlineReady:async()=>false,pendingCheckoutInfo:async()=>null,reserveCheckout:async(cartIdentity:string,operationId:string,options:any)=>{prepared=options.dispatch;checkout=await f.adapter.prepareDispatchFiscalCheckout({...prepared,cartIdentity,operationId,fiscal:{kind:'PERMIT',scopeKey,options:{requirePermit:true,authorityHash:'a'.repeat(64)}}});return checkout;},recordPayment:(c:any,paymentId:string)=>fiscal.markPaymentPossible(c.checkoutId,paymentId)},getDefaultFiscalProvider:()=> 'MSELLER',requiredSaleFiscalType:'E32',currentFiscalCheckoutCartIdentity:()=> 'fixture-cart',terminalId:id(4),activeRecoveredReservation:null,activeDirectV3TicketId:null,activeTable:null,fiscalCheckoutRef:fiscalRef,fiscalCheckoutOperationRef:{current:null},offlineTableFiscalContextRef:{current:undefined},trackingCheckoutRef:{current:null},durableOutboxRepository:{isSupported:()=>true},createUuid:randomUUID,setLargeMasterSyncV3CriticalOperation:no,onUpdateCart:no,db:{getDocument:async()=>null},isIntermediateFractionPayment:false};
 beforeContext.resolveCommittedDispatchReceipt=actual('components/POSInterface.tsx','resolveCommittedDispatchReceipt',beforeContext);
 const before=actual('components/POSInterface.tsx','beforeV3PaymentEffects',beforeContext);
 const payment={id:randomUUID(),method:'CASH',amount:100,currencyCode:'DOP',timestamp:new Date(now)};const errors:string[]=[];let gateways=0;
 const app=actual('App.tsx','handleTransactionComplete',{dbAdapter:f.adapter,financialIdentity,assertFormatsPostingClosed,config:projected,deviceId:id(50),db:(globalThis as any).__dispatchFiscal.db,LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED:true,persistV3FinancialTransaction:m.persistV3FinancialTransaction,readV3CompletedReservation:()=>{throw Error('NO_RESERVATION_FIXTURE');},setTransactions:(update:any)=>{published=update([])[0];},setCustomers:no,syncFiscalDocument:async()=>{},backgroundSyncManager:{triggerSync:async()=>{}},console});
 const modal:any={describeFiscalCheckoutFailure,paymentRequiresGatewayAuthorization:()=>false,isCardOutcomeUnknownError:()=>false,finalizationMountedRef:{current:true},finalizationSubmissionRef:{current:false},finalizationProgressRef:{current:null},finalizationContextRef:{current:{items:[item],payments:[payment],total:100}},yieldInteractionPaint:async()=>{},recordCheckoutDiagnostic:no,items:[item],total:100,payments:[payment],isFinalizing:false,isProcessingGateway:false,isSuccessScreen:false,recoverCommittedReceipt:async()=>null,setFinalizeError:(value:string)=>{if(value)errors.push(value);},setSuccessNotice:no,setIsFinalizing:no,canFinalize:true,isCreditActionBlocked:false,beginPosInteraction:()=>({stages:{}}),expectInteractionRender:no,markInteractionStateUpdate:no,markInteractionStage:no,canFinalizeWithTypedAmount:false,workflowPaymentFenceRef:{current:null},setGatewayProgress:no,beforePaymentEffects:before,sumCreditPaymentsBase:()=>0,isOnline:false,isMaster:true,measureInteractionStage:(_t:any,_a:any,_b:any,work:any)=>work(),authorizePendingGatewayPayments:async(value:any)=>{gateways++;assert.equal((f.db.prepare('SELECT phase FROM pos_dispatch_precharge_v1 WHERE checkout_id=?').get(checkout.checkoutId)as any).phase,'EFFECT_POSSIBLE');assert.equal((await fiscal.readCheckout(checkout.checkoutId))?.phase,'EFFECT_POSSIBLE');return value;},setPayments:no,window:{setTimeout:()=>0,clearTimeout},setCompletedTransaction:no,setIsSuccessScreen:no,customer:null,isInstallmentPayment:false,voluntaryTip:0,isRefund:false,baseCurrency:{code:'DOP'},config:projected,configuredFiscalBaseCurrency,assertDopFiscalSettlement,effectiveTotalToPay:100,onConfirm:async(payments:any)=>{
  const input={...ref.current.source,id:checkout.transactionId,fiscalWorkflowCheckoutId:checkout.checkoutId,documentType:'TICKET',seriesId:id(9),terminalId:id(4),date:new Date(now).toISOString(),status:'COMPLETED',userId:id(25),userName:'Fixture',fiscalMode:'ECF',fiscalProvider:'MSELLER',ncfType:'E32',fiscalEnvironment:0,fiscalIssuance:{tenantId:id(1),companyId:id(2),terminalId:id(4)},payments};
  const transaction=await m.transactionService.createTransaction(input,{deferDurablePersistence:true});
  const finalTransaction=actual('components/POSInterface.tsx','finalTxn',{txn:transaction,dispatchCheckoutRef:ref,isRefundOnly:false,assignedSequenceId:id(9)});
  await app(finalTransaction);return published;
 }};
 await actual('components/PaymentModal.tsx','handleFinalize',modal)();assert.deepEqual(errors,[]);assert.equal(gateways,1);assert.equal(published.id,checkout.transactionId);
 assert.equal((await fiscal.readCheckout(checkout.checkoutId))?.phase,'COMMITTED');assert.equal((f.db.prepare('SELECT state FROM pos_fiscal_permits_v2').get()as any).state,'CONSUMED');assert.equal(f.documents('inventoryLedger').length,0);assert.equal((f.db.prepare('SELECT consumed_minor n FROM pos_dispatch_quota_v1').get()as any).n,1000000);
 const events=f.db.prepare('SELECT event_type,payload_json FROM sync_outbox_v2 ORDER BY local_sequence').all()as any[];assert.deepEqual(events.map(row=>row.event_type),['SALE_POSTED','PAYMENT_POSTED']);assert.equal(JSON.parse(events[0].payload_json).fiscalWorkflowBirth.checkoutId,checkout.checkoutId);assert.equal(JSON.parse(events[0].payload_json).transaction.companyDispatchSource.sequence,1);
 const beforeReplay=JSON.stringify(events);assert.equal((await m.persistV3FinancialTransaction(published,projected,id(5),{refund:false})).created,false);assert.equal(JSON.stringify(f.db.prepare('SELECT event_type,payload_json FROM sync_outbox_v2 ORDER BY local_sequence').all()),beforeReplay);
});
