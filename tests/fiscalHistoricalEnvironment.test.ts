import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import SQLite from 'better-sqlite3';
import {build,transform} from 'esbuild';
import {nativeFixture,id} from './articleFormatsNativeFixture';
import {LargeMasterSyncV3Runtime} from '../services/sync/LargeMasterSyncV3Runtime';
import {explicitTerminalFiscalEnvironment,applyTerminalConfigSnapshot} from '../utils/terminalConfigSnapshot';
import {DEFAULT_TERMINAL_CONFIG} from '../constants';
import {financialOperationIdentity,financialIdentity} from '../services/db/LargeMasterSyncV3FinancialRetention';
import {buildPaymentPostedPayload} from '../services/sync/SalePostedContract';
import {fiscalStatusSourceChecksum} from '../services/fiscal/FiscalStatusProof';

const raw=(environment:any)=>({terminal_id:id(4),fiscalMode:'ECF',resolved:{terminalFiscalConfig:{fiscal:{providerId:'MSELLER',mode:'ECF',enabled:true,environment}}}});
const terminal=(snapshot:any)=>({id:id(4),config:{erpSnapshot:snapshot,fiscal:{providerId:'MSELLER',environment:0}}});
const capture=(snapshot:any,provider='MSELLER',mode='ECF')=>explicitTerminalFiscalEnvironment(terminal(snapshot),id(4),provider,mode);
for(const value of [0,1,2])test('strict original numeric environment '+value,()=>{const snapshot=raw(value),before=JSON.stringify(snapshot);assert.equal(capture(snapshot),value);assert.equal(JSON.stringify(snapshot),before);});
for(const value of [undefined,null,false,true,'','0','1',NaN,3,-1,Infinity])test('invalid or absent raw environment '+String(value)+' stays absent',()=>assert.equal(capture(raw(value)),undefined));
test('environment aliases must be own numeric and agree; raw snapshot/terminal/mode/provider/disable/error guards',()=>{
 const snapshot:any=raw(1),record=snapshot.resolved.terminalFiscalConfig.fiscal;record.ambiente=1;assert.equal(capture(snapshot),1);record.ambiente=2;assert.equal(capture(snapshot),undefined);delete record.environment;assert.equal(capture(snapshot),2);record.ambiente='2';assert.equal(capture(snapshot),undefined);
 for(const mutate of [(s:any)=>s.terminal_id='other',(s:any)=>delete s.terminal_id,(s:any)=>s.resolution_error='error',(s:any)=>s.resolved.terminalFiscalConfig.fiscal.enabled=false,(s:any)=>s.resolved.terminalFiscalConfig.canIssueFiscalDocuments=false,(s:any)=>s.fiscalMode='LEGACY_B',(s:any)=>s.resolved.terminalFiscalConfig.fiscal.mode='LEGACY_B',(s:any)=>s.resolved.terminalFiscalConfig.fiscal.provider_id='DIGIFACT']){const s=raw(0);mutate(s);assert.equal(capture(s),undefined);}
 assert.equal(capture(undefined),undefined);assert.equal(capture(raw(0),'DIGIFACT'),undefined);assert.equal(capture(raw(0),'MSELLER','LEGACY_B'),undefined);assert.equal(explicitTerminalFiscalEnvironment(terminal(raw(0)),'other','MSELLER','ECF'),undefined);
 const inherited:any=Object.create({environment:0});inherited.providerId='MSELLER';inherited.mode='ECF';const s:any=raw(0);s.resolved.terminalFiscalConfig.fiscal=inherited;assert.equal(capture(s),undefined);
});
test('single authoritative record precedence never borrows environment or provider from lower records',()=>{
 const s:any=raw(2);s.resolved.fiscal={providerId:'MSELLER',mode:'ECF',environment:1};s.config={fiscal:{providerId:'MSELLER',mode:'ECF',environment:0}};
 s.resolved.terminalFiscalConfig.providerId='MSELLER';s.resolved.terminalFiscalConfig.mode='ECF';assert.equal(capture(s),undefined);
 s.resolved.terminalFiscalConfig.environment=0;assert.equal(capture(s),0);s.resolved.terminalFiscalConfig.providerId='DIGIFACT';assert.equal(capture(s),undefined);
 delete s.resolved.terminalFiscalConfig;assert.equal(capture(s),1);delete s.resolved.fiscal;assert.equal(capture(s),0);
});
let bundle:Promise<any>;
async function modules(f:any,durable=true) {
 const globals=globalThis as any;
 globals.__fiscalEnvironment={adapter:f.adapter,identity:{tenantId:id(1),terminalId:id(4),deviceId:id(50),erpSyncBaseUrl:'https://erp.invalid',syncToken:'synthetic'},session:undefined,durable,db:{get:(n:string)=>f.adapter.getCollection(n),getDocument:(...a:any[])=>f.adapter.getDocument(...a),save:(...a:any[])=>f.adapter.saveCollection(...a),saveDocument:(...a:any[])=>f.adapter.saveDocument(...a),reserveTransactionNumbers:(seriesId:string,documentType:string)=>f.adapter.reserveFinancialNumbers({seriesId,documentType,global:true}),assertFiscalTransactionAuthority:async()=>{}}};
 globals.localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};globals.window={dispatchEvent:()=>{}};
 bundle ||= build({stdin:{contents:`export {LargeMasterSyncV3OperationalSession as Session} from './services/sync/LargeMasterSyncV3OperationalSession';export {persistV3FinancialTransaction} from './services/sync/LargeMasterSyncV3FinancialCommit';export {transactionService} from './services/transactionService';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',define:{'import.meta.env':'{}'},plugins:[{name:'native-fiscal-environment',setup(b){
 const ports:Record<string,string>={
 './db':'export const db={adjustCommittedStock:(...a)=>globalThis.__fiscalEnvironment.adjustCommittedStock(...a)};',
 '../db':'export const dbAdapter=new Proxy({}, {get:(_t,k)=>{const a=globalThis.__fiscalEnvironment.adapter;return typeof a[k]==="function"?a[k].bind(a):a[k];}});',
 '../../utils/db':'export const db=new Proxy({}, {get:(_t,k)=>{const d=globalThis.__fiscalEnvironment.db;return typeof d[k]==="function"?d[k].bind(d):d[k];}});',
 '../utils/db':'export const db=new Proxy({}, {get:(_t,k)=>{const d=globalThis.__fiscalEnvironment.db;return typeof d[k]==="function"?d[k].bind(d):d[k];}});',
 './sync/SyncManager':'export const syncManager={broadcastChange:async()=>{}};',
 './CheckoutDiagnostics':'export const recordCheckoutDiagnostic=()=>{};',
 './sync/SyncFeatureFlags':'export const isSyncFeatureEnabled=name=>name==="sqlite_outbox_v2"&&globalThis.__fiscalEnvironment.durable;',
 './sync/LargeMasterSyncV3OperationalSession':'export const getLargeMasterSyncV3OperationalSession=async()=>globalThis.__fiscalEnvironment.session;',
 './LargeMasterSyncV3BoundTransport':'export const readLargeMasterSyncV3BoundIdentity=()=>globalThis.__fiscalEnvironment.identity;export const validatedLargeMasterSyncV3ErpSyncBase=v=>v;export const createLargeMasterSyncV3BoundClient=()=>{throw Error("no network");};',
 './LargeMasterSyncV3Platform':'export const assertLargeMasterSyncV3NativeAndroid=()=>{};',
 './LargeMasterSyncV3OperationalSession':'export const getLargeMasterSyncV3OperationalSession=async()=>globalThis.__fiscalEnvironment.session;export const v3InventoryBaselineKey=(b,s)=>JSON.stringify([b,s.inventorySyncId||s.syncId,s.inventorySyncVersion??s.syncVersion,s.inventoryVersion,s.inventoryCursor]);',
 './SyncFeatureFlags':'export const isSyncFeatureEnabled=()=>globalThis.__fiscalEnvironment.durable;',
 './DurableOutboxRepository':'export const durableOutboxRepository={commitFinancialTransaction:i=>globalThis.__fiscalEnvironment.adapter.commitFinancialTransaction(i)};',
 '../CheckoutDiagnostics':'export const recordCheckoutDiagnostic=()=>{};',
 };
 b.onResolve({filter:/.*/},a=>ports[a.path]?{path:a.path,namespace:'fiscal-environment'}:undefined);
 b.onLoad({filter:/.*/,namespace:'fiscal-environment'},a=>({contents:ports[a.path],loader:'js'}));
 }}]}).then(r=>import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text+'\n//# sourceURL=environment-native-test.mjs').toString('base64')));
 const m=await bundle,store=f.adapter.masterSyncV3Store,runtime=await LargeMasterSyncV3Runtime.open(store);
 globals.__fiscalEnvironment.session=new m.Session({runtime,inventoryVersion:4,inventoryCursor:'inventory-cursor'},(await store.getOperationalOwner())!.binding,store,'https://erp.invalid',globals.__fiscalEnvironment.identity);
 return {...m,session:globals.__fiscalEnvironment.session};
}

async function directFixture(file?:string,seed=true){
 const f=await nativeFixture(file?new SQLite(file):undefined,seed);
 if(seed){
 f.db.prepare("INSERT INTO sync_v3_sessions(sync_id,sync_version,schema_version,contract_version,status,manifest_json,created_at,updated_at) VALUES(?,32,3,2,'ACTIVE','{}','fixture','fixture')").run(id(60));
 const article=JSON.parse((f.db.prepare('SELECT record_json FROM master_v3_articles').get() as any).record_json);article.activeWarehouseIds=[id(5)];f.db.prepare('UPDATE master_v3_articles SET record_json=?').run(JSON.stringify(article));
 f.db.prepare('INSERT INTO master_v3_tariffs(sync_version,tariff_id,active,record_json) VALUES(32,?,1,?)').run(id(6),JSON.stringify({id:id(6),name:'Synthetic',active:true,taxIncluded:false}));f.db.prepare('INSERT INTO master_v3_prices VALUES(32,?,?,100)').run(id(7),id(6));
 }
 const m=await modules(f),config=await m.session.projectConfig(f.documents('config')[0]);
 const product=await m.session.withStock((await(await m.session.catalog(id(6),id(5))).get(id(7))).product,id(5));
 return {...f,...m,config,product};
}
for(const cash of [false,true])for(const value of [0,1,2,undefined])test('real constructor native first commit '+(cash?'CASH replay':'NONE replay')+' preserves environment '+String(value),async()=>{
 const f=await directFixture();try{
  const environment=capture(value===undefined?{terminal_id:id(4),fiscalMode:'ECF',resolved:{terminalFiscalConfig:{fiscal:{providerId:'MSELLER',mode:'ECF'}}}}:raw(value));
  const data:any={id:id(85),documentType:'TICKET',seriesId:id(9),terminalId:id(4),date:'2026-10-17T12:00:00Z',status:'COMPLETED',userId:id(25),userName:'Synthetic',items:[{...f.product,quantity:1,cartId:'new-line',netAmount:100,taxAmount:0,totalAmount:100}],netAmount:100,taxAmount:0,total:100,payments:cash?[{id:id(86),method:'CASH',amount:100,timestamp:'2026-10-17T12:00:00Z'}]:[],...(environment!==undefined?{fiscalEnvironment:environment}:{})};
  const transaction=await f.transactionService.createTransaction(data,{deferDurablePersistence:true});assert.equal(Object.hasOwn(transaction,'fiscalEnvironment'),value!==undefined);assert.equal(transaction.fiscalEnvironment,value);
  const beforeChecksum=await fiscalStatusSourceChecksum(transaction),fingerprint=financialOperationIdentity(transaction,id(5),{});
  if(value!==undefined){const other={...transaction,fiscalEnvironment:(value+1)%3};assert.notEqual(financialOperationIdentity(other,id(5),{}),fingerprint);assert.equal(await fiscalStatusSourceChecksum(other),beforeChecksum);}
  const result=await f.persistV3FinancialTransaction(transaction,f.config,id(5));assert.equal(result.created,true);assert.equal(result.transaction.fiscalEnvironment,value);
  for(const collection of ['transactions','transactionHistory']){const row=f.documents(collection)[0];assert.equal(Object.hasOwn(row,'fiscalEnvironment'),value!==undefined);assert.equal(row.fiscalEnvironment,value);assert.equal(row.v3CommitFingerprint,fingerprint);}
  const rows=f.db.prepare('SELECT * FROM sync_outbox_v2 ORDER BY local_sequence').all() as any[];const sale=JSON.parse(rows.find(r=>r.event_type==='SALE_POSTED').payload_json),paymentRow=rows.find(r=>r.event_type==='PAYMENT_POSTED');
  assert.equal(Object.hasOwn(sale.transaction,'fiscalEnvironment'),value!==undefined);assert.equal(sale.transaction.fiscalEnvironment,value);assert.equal(sale.transaction.v3CommitFingerprint,fingerprint);
  if(cash){const payment=JSON.parse(paymentRow.payload_json),expected=buildPaymentPostedPayload(result.transaction,{paymentIntentIds:[]});assert.deepEqual(payment,expected);assert.equal(Object.hasOwn(payment,'fiscalEnvironment'),false);assert.equal(Object.hasOwn(payment.summary,'fiscalEnvironment'),false);}else assert.equal(paymentRow,undefined);
  const persisted=f.db.prepare('SELECT * FROM documents ORDER BY collection_name,doc_id').all();const serialized=JSON.stringify(rows);
  const currentSnapshot=raw(2);assert.equal(capture(currentSnapshot),2);if(cash){assert.equal(typeof transaction.payments[0].timestamp,'string');assert.equal(financialIdentity(await f.adapter.getDocument('transactions',transaction.id)),financialIdentity(transaction));}assert.equal((await f.persistV3FinancialTransaction(transaction,f.config,id(5))).created,false);assert.deepEqual(f.db.prepare('SELECT * FROM documents ORDER BY collection_name,doc_id').all(),persisted);assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM sync_outbox_v2 ORDER BY local_sequence').all()),serialized);
 }finally{f.db.close();}
});
test('ordinary checkout capture scope excludes returns/recovery/reservation/table/marketplace and preserves explicit zero',async()=>{
 const source=readFileSync(new URL('../components/POSInterface.tsx',import.meta.url),'utf8');const start=source.indexOf('const newDirectFiscalEnvironment ='),end=source.indexOf('const txn =',start);assert.ok(start>0);const expression=source.slice(start,end).replace('const newDirectFiscalEnvironment =','').trim().replace(/;$/,'');
 const vars=['fiscalCheckoutRef','offlineTableInvoice','v3Operational','hasReturns','activeV3Reservation','activeRecoveredReservation','activeDirectV3TicketId','activeTable','activeOrderId','uberRecoveredOrder','finalNcfType','activeTerminal','terminalId','getDefaultFiscalProvider','config','activeTerminalConfig','fiscalCompliance','explicitTerminalFiscalEnvironment'];
 const fn=new Function(...vars,(await transform('return ('+expression+');',{loader:'ts'})).code);
 const run=(patch:any={})=>{const values:any={fiscalCheckoutRef:{current:null},offlineTableInvoice:false,v3Operational:{},hasReturns:false,activeV3Reservation:null,activeRecoveredReservation:null,activeDirectV3TicketId:null,activeTable:null,activeOrderId:null,uberRecoveredOrder:null,finalNcfType:'E32',activeTerminal:terminal(raw(0)),terminalId:id(4),getDefaultFiscalProvider:()=> 'MSELLER',config:{},activeTerminalConfig:{},fiscalCompliance:{mode:'ECF'},explicitTerminalFiscalEnvironment,...patch};return fn(...vars.map(k=>values[k]));};
 for(const code of ['E31','E32','E44','E45'])assert.equal(run({finalNcfType:code}),0);
 for(const key of ['hasReturns','activeV3Reservation','activeRecoveredReservation','activeDirectV3TicketId','activeTable','activeOrderId','uberRecoveredOrder'])assert.equal(run({[key]:true}),undefined);
 assert.equal(run({v3Operational:null}),undefined);for(const code of ['E34','B01',undefined])assert.equal(run({finalNcfType:code}),undefined);
 assert.ok(source.indexOf('fiscalEnvironment: newDirectFiscalEnvironment',start)>end);assert.equal((source.match(/explicitTerminalFiscalEnvironment\(activeTerminal/g)||[]).length,1);
});
test('real constructor omits own invalid/null/inherited environment without defaulting normalized config',async()=>{
 const f=await directFixture();try{
  const base:any={documentType:'TICKET',seriesId:id(9),terminalId:id(4),items:[],total:0,payments:[],userId:id(25),userName:'Synthetic'};
  for(const value of [undefined,null,false,'0',NaN,3]){const result=await f.transactionService.createTransaction({...base,fiscalEnvironment:value},{deferDurablePersistence:true});assert.equal(Object.hasOwn(result,'fiscalEnvironment'),false);assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(result)),'fiscalEnvironment'),false);}
  const inherited=Object.assign(Object.create({fiscalEnvironment:0}),base);const result=await f.transactionService.createTransaction(inherited,{deferDurablePersistence:true});assert.equal(Object.hasOwn(result,'fiscalEnvironment'),false);
 }finally{f.db.close();}
});

test('actual sanitized ERP snapshot retains explicit provenance while normalized missing environment0 cannot authorize capture',()=>{
 for(const present of [true,false]){
  const snapshot:any=raw(0);snapshot.resolved.terminalFiscalConfig.fiscal.authToken='synthetic-redacted';if(!present)delete snapshot.resolved.terminalFiscalConfig.fiscal.environment;
  const base:any={companyInfo:{name:'Synthetic'},fiscalCompliance:{mode:'ECF',defaultProvider:'MSELLER',allowLegacyFallback:false,providers:[]},terminals:[{id:id(4),name:'Synthetic',config:structuredClone(DEFAULT_TERMINAL_CONFIG)}]};
  const result=applyTerminalConfigSnapshot(base,{terminalId:id(4),incomingSnapshot:snapshot}),current=result.config.terminals[0];
  assert.equal(current.config.fiscal.environment,0);assert.equal(explicitTerminalFiscalEnvironment(current,id(4),'MSELLER','ECF'),present?0:undefined);assert.doesNotMatch(JSON.stringify(current.config.erpSnapshot),/synthetic-redacted/);
 }
});
for(const value of [0,1,2,undefined])test('actual CASH Date constructor survives SQLite close/new adapter replay with environment '+String(value),async()=>{
 const directory=mkdtempSync(join(tmpdir(),'pos-date-restart-')),file=join(directory,'synthetic.sqlite');let f=await directFixture(file);try{
  const rawTimestamp=new Date('2026-10-17T12:00:00.123Z');const data:any={id:id(95),documentType:'TICKET',seriesId:id(9),terminalId:id(4),date:'2026-10-17T12:00:00Z',status:'COMPLETED',userId:id(25),userName:'Synthetic',items:[{...f.product,quantity:1,cartId:'date-line',netAmount:100,taxAmount:0,totalAmount:100}],netAmount:100,taxAmount:0,total:100,payments:[{id:id(96),method:'CASH',amount:100,timestamp:rawTimestamp}],...(value!==undefined?{fiscalEnvironment:value}:{})};
  const source=await f.transactionService.createTransaction(data,{deferDurablePersistence:true});assert.strictEqual(data.payments[0].timestamp,rawTimestamp);assert.equal(source.payments[0].timestamp,rawTimestamp.toISOString());
  const first=await f.persistV3FinancialTransaction(source,f.config,id(5));assert.equal(first.created,true);
  const state=()=>JSON.stringify({docs:f.db.prepare('SELECT * FROM documents ORDER BY collection_name,doc_id').all(),outbox:f.db.prepare('SELECT * FROM sync_outbox_v2 ORDER BY local_sequence').all()});const before=state();const checksum=await fiscalStatusSourceChecksum(first.transaction);const fingerprint=first.transaction.v3CommitFingerprint;
  f.db.close();f=await directFixture(file,false);const loaded=await f.adapter.getDocument('transactions',source.id);assert.equal(await fiscalStatusSourceChecksum(loaded),checksum);assert.equal(loaded.v3CommitFingerprint,fingerprint);assert.equal(loaded.payments[0].timestamp,rawTimestamp.toISOString());
  for(const candidate of [source,loaded])assert.equal((await f.persistV3FinancialTransaction(candidate,f.config,id(5))).created,false);assert.equal(state(),before);
  const rows=f.db.prepare('SELECT event_type,payload_json FROM sync_outbox_v2 ORDER BY local_sequence').all() as any[];assert.equal(rows.length,2);for(const row of rows){const payload=JSON.parse(row.payload_json);assert.equal((payload.transaction?.payments||payload.payments)[0].timestamp,rawTimestamp.toISOString());}
 }finally{f.db.close();rmSync(directory,{recursive:true,force:true});}
});
test('actual constructor preserves raw ISO literal and legacy Date shape, rejects invalid new V3 timestamp',async()=>{
 const f=await directFixture();try{const base:any={id:id(95),documentType:'TICKET',seriesId:id(9),terminalId:id(4),date:'2026-10-17T12:00:00Z',status:'COMPLETED',userId:id(25),userName:'Synthetic',items:[{...f.product,quantity:1,cartId:'date-line',netAmount:100,taxAmount:0,totalAmount:100}],netAmount:100,taxAmount:0,total:100};
  const raw='2026-10-17T08:00:00-04:00',payment={id:id(96),method:'CASH',amount:100,timestamp:raw};const created=await f.transactionService.createTransaction({...base,payments:[payment]},{deferDurablePersistence:true});assert.equal(created.payments[0].timestamp,raw);
  const second=await f.transactionService.createTransaction({...base,payments:[{...payment,timestamp:new Date('2026-10-17T12:00:01Z')}]},{deferDurablePersistence:true});assert.notEqual(financialOperationIdentity(created,id(5),{}),financialOperationIdentity(second,id(5),{}));
  await assert.rejects(()=>f.transactionService.createTransaction({...base,payments:[{...payment,timestamp:new Date(NaN)}]},{deferDurablePersistence:true}),/PAYMENT_TIMESTAMP_INVALID/);
  const legacy=await f.transactionService.createTransaction({...base,items:[],payments:[payment]},{deferDurablePersistence:true});assert.ok(legacy.payments[0].timestamp instanceof Date);
 }finally{f.db.close();}
});

test('historical malformed Date fingerprint stays immutable and rejected without read-time rewriting',async()=>{
 const f=await directFixture();try{const source:any={id:id(95),documentType:'TICKET',seriesId:id(9),terminalId:id(4),date:'2026-10-17T12:00:00Z',status:'COMPLETED',userId:id(25),userName:'Synthetic',items:[{...f.product,quantity:1,cartId:'date-line',netAmount:100,taxAmount:0,totalAmount:100}],netAmount:100,taxAmount:0,total:100,payments:[{id:id(96),method:'CASH',amount:100,timestamp:new Date('2026-10-17T12:00:00Z')}]};
  // Freeze the old canonical Date shape explicitly; never recompute historical bytes from a Date.
  const oldFingerprint=financialOperationIdentity({...source,payments:source.payments.map((payment:any)=>({...payment,timestamp:{}}))},id(5),{}),stored={...source,v3CommitFingerprint:oldFingerprint};
  for(const collection of ['transactions','transactionHistory'])f.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)').run(collection,source.id,JSON.stringify(stored),0,'historical-fixture');
  const before=JSON.stringify(f.db.prepare('SELECT * FROM documents ORDER BY collection_name,doc_id').all()),loaded=await f.adapter.getDocument('transactions',source.id);await assert.rejects(()=>f.persistV3FinancialTransaction(loaded,f.config,id(5)),/DUPLICATE_TRANSACTION_MISMATCH/);assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM documents ORDER BY collection_name,doc_id').all()),before);assert.equal(f.db.prepare('SELECT count(*) n FROM sync_outbox_v2').get().n,0);
 }finally{f.db.close();}
});
