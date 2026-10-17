/* Explicit online laboratory: its own Android UID/SQLite/context; never App/bootstrap. */
import input from 'lab-only-input';
import {assertLabRequest,LAB_ERP_ORIGIN} from './network-policy';
import {Capacitor} from '@capacitor/core';
import {CapacitorSQLite,SQLiteConnection} from '@capacitor-community/sqlite';
import {CapacitorSQLiteAdapter} from '../../services/db/adapters/CapacitorSQLiteAdapter';
import {LargeMasterSyncV3Runtime} from '../../services/sync/LargeMasterSyncV3Runtime';
import {LargeMasterSyncV3OperationalSession} from '../../services/sync/LargeMasterSyncV3OperationalSession';
import {transactionService} from '../../services/transactionService';
import {persistV3FinancialTransaction} from '../../services/sync/LargeMasterSyncV3FinancialCommit';
import {createAppliedReceiptReadiness} from '../../services/fiscal/FiscalAppliedReceiptV2';
import {createMSellerDispatcher,FISCAL_DISPATCH_CLAIMS,requireFiscalErpAppliedReceipt} from '../../services/fiscal/FiscalMSellerDispatch';
import {captureFiscalBoundContext} from '../../services/fiscal/FiscalBoundContext';
import {snapshotFiscalIssuance,assertFiscalIssuance} from '../../utils/fiscalIssuance';
import {validateFiscalBufferReservation} from '../../utils/fiscalBufferAuthority';
import {formatFiscalNumber} from '../../utils/fiscalNumber';
import {explicitTerminalFiscalEnvironment} from '../../utils/terminalConfigSnapshot';
import {sha256Utf8} from '../../services/sync/LargeMasterSyncV3Client';
const g=globalThis as any,origin=LAB_ERP_ORIGIN,scope=input.connection.scope,master=input.fiscalMaster;
const assert=(value:any,message:string)=>{if(!value)throw Error(message);};
const clone=(value:any)=>JSON.parse(JSON.stringify(value));
const uid=()=>crypto.randomUUID?crypto.randomUUID():[4,2,2,2,6].map((n,i)=>{const a=crypto.getRandomValues(new Uint8Array(n));if(i===2)a[0]=(a[0]&15)|64;if(i===3)a[0]=(a[0]&63)|128;return Array.from(a,v=>v.toString(16).padStart(2,'0')).join('');}).join('-');
const connections=new SQLiteConnection(CapacitorSQLite),storageKey='isolated-online-fiscal-v1';
const network:any[]=[];let adapter:any,sql:any,session:any,config:any,current:any,busy=false;
const report:any={laboratoryOnly:true,mode:'real-Android-fetch-native-SQLite-FAKE-provider',userAgent:navigator.userAgent,checks:[],network};
function emit(state:string){report.state=state;document.title=state;document.getElementById('result')!.textContent=JSON.stringify(report);console.log('FISCAL_ONLINE_QA_RESULT '+JSON.stringify(report));}
async function rows(query:string,params:any[]=[]){return(await sql.query(query,params)).values||[];}
async function put(collection:string,document:any){await adapter.saveDocument(collection,document);}
async function mark(phase:string,extra:any={}){current={...current,...extra,phase};await put('qa_online',current);report.phase=phase;}
const identity={tenantId:scope.tenantId,terminalId:scope.terminalId,deviceId:scope.deviceId,erpSyncBaseUrl:origin+'/api/sync',syncToken:input.connection.headers['x-sync-token']};
const credentials={...identity,companyId:scope.companyId,storeId:scope.storeId,deviceToken:input.connection.headers['x-device-token'],deviceTokenSource:'ERP_REGISTER',authStatus:'ERP_ACTIVE'};
const context=()=>captureFiscalBoundContext(()=>identity,()=>credentials as any);
async function request(url:any,init:any={}){
 const u=assertLabRequest(String(url),init.method||'GET');
 const entry:any={url:u.origin+u.pathname+u.search,method:init.method||'GET',bodySha256:init.body?await sha256Utf8(String(init.body)):null};network.push(entry);
 try{const response=await fetch(url,{...init,redirect:'error',credentials:'omit',cache:'no-store'});entry.status=response.status;return response;}catch(error){entry.error=String(error);throw error;}
}
async function json(path:string,method='GET',body?:any){const response=await request(origin+path,{method,headers:{...context().headers,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();assert(response.ok,'LAB_HTTP_'+response.status+'_'+JSON.stringify(value));return value;}
async function preflight(){
 assert(Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='android','REAL_ANDROID_REQUIRED');
 assert(input.connection.port===18765&&input.connection.provider==='FAKE','FAKE_ONLY');
 report.capabilities={fetch:typeof fetch,abortController:typeof AbortController,textEncoder:typeof TextEncoder,textDecoder:typeof TextDecoder,crypto:typeof crypto.subtle?.digest,hasOwn:typeof (Object as any).hasOwn};
 for(const key of ['fetch','abortController','textEncoder','textDecoder','crypto'])assert(report.capabilities[key]==='function','LAB_RUNTIME_'+key);
 report.health=await json('/__lab/health');assert(report.health.labOnly===true&&report.health.provider==='FAKE'&&report.health.productionActivation===false&&report.health.postgres==='PRIVATE_UNIX_SOCKET'&&report.health.erpHead==='4596abe930c6f582773c9c641bf23ab3376b7ee1','LAB_SERVICE_IDENTITY_MISMATCH');report.metrics=await json('/__lab/metrics');assert(Number.isSafeInteger(report.metrics.providerCalls),'LAB_METRICS_INVALID');
 let held=false;try{await requireFiscalErpAppliedReceipt({} as any);}catch(error){held=String(error).includes('FISCAL_ERP_APPLIED_RECEIPT_REQUIRED');}assert(held,'PRODUCTION_HOLD_CHANGED');
 emit('ONLINE_LAB_READY_NO_OPERATION');return clone(report);
}
async function open(name:string){const exists=await connections.isConnection(name,false);sql=exists.result?await connections.retrieveConnection(name,false):await connections.createConnection(name,false,'no-encryption',1,false);if(!(await sql.isDBOpen()).result)await sql.open();adapter=new CapacitorSQLiteAdapter();Object.assign(adapter,{db:sql,isReady:true});await adapter.initSchema();
 g.__fiscalQA={adapter,identity,session:null,db:{get:(n:string)=>adapter.getCollection(n),getDocument:(...a:any[])=>adapter.getDocument(...a),save:(...a:any[])=>adapter.saveCollection(...a),saveDocument:(...a:any[])=>adapter.saveDocument(...a),reserveTransactionNumbers:(seriesId:string,documentType:string)=>adapter.reserveFinancialNumbers({seriesId,documentType,global:true}),assertFiscalTransactionAuthority:assertAuthority}};
 report.database=name;report.sqlite=await rows('SELECT sqlite_version() version');
}
async function assertAuthority(tx:any){assertFiscalIssuance(tx);const [business,buffer,allocation,range]=await Promise.all([adapter.getDocument('config','current'),adapter.getDocument('localFiscalBuffer','online-buffer'),adapter.getDocument('fiscalAllocations',master.fiscalAllocationId),adapter.getDocument('fiscalRanges',master.fiscalRangeId)]);
 assert(tx.fiscalIssuance&&business&&buffer&&allocation&&range,'LAB_AUTHORITY_MISSING');
 const frozen={...buffer,currentNumber:tx.fiscalIssuance.sequence};validateFiscalBufferReservation({business,buffer:frozen,allocation,range,terminalId:scope.terminalId,type:'E32',ncf:tx.ncf});
 assert(buffer.currentNumber>tx.fiscalIssuance.sequence,'LAB_AUTHORITY_NOT_RESERVED');
 const expected=snapshotFiscalIssuance(business,range,allocation,frozen,tx.ncf);expected.capturedAt=tx.fiscalIssuance.capturedAt;assert(JSON.stringify(expected)===JSON.stringify(tx.fiscalIssuance),'LAB_AUTHORITY_SNAPSHOT_MISMATCH');
}
async function seed(){const {sale,ready,balance}=input.catalog,warehouse=ready.warehouseId||sale.article.activeWarehouseIds[0],binding=JSON.stringify([scope.tenantId,scope.terminalId,scope.deviceId,identity.erpSyncBaseUrl,origin]);
 const range={id:master.fiscalRangeId,type:'E32',prefix:'E32',startNumber:master.rangeStart,endNumber:master.rangeEnd,expiryDate:master.expiryDate,isActive:true};
 // Master-authorized synthetic allocation; buffer reserves two values before any source exists.
 const allocation={id:master.fiscalAllocationId,fiscalRangeId:range.id,ncfType:'E32',prefix:'E32',terminalId:scope.terminalId,reservedStart:master.allocationStart,reservedEnd:master.allocationEnd,nextNumber:master.allocationStart+2,status:'ACTIVE',metadata:{companyId:scope.companyId}};
 const fiscal={mode:'ECF',enabled:true,providerId:'MSELLER',environment:0,fiscalRanges:[range],fiscalAllocations:[allocation]};
 config={id:'current',companyInfo:{name:'Synthetic Android laboratory',rnc:master.issuerRnc},fiscalCompliance:{...fiscal},terminals:[{id:scope.terminalId,config:{erpTerminalId:scope.terminalId,currentDeviceId:scope.deviceId,erpBinding:{tenantId:scope.tenantId,companyId:scope.companyId,storeId:scope.storeId},inventoryScope:{defaultSalesWarehouseId:warehouse},fiscal,erpSnapshot:{terminal_id:scope.terminalId,fiscalMode:'ECF',resolved:{terminalFiscalConfig:{fiscal}}}}}]};
 await put('config',config);await put('fiscalRanges',range);await put('fiscalAllocations',allocation);await put('localFiscalBuffer',{id:'online-buffer',type:'E32',terminalId:scope.terminalId,allocationId:allocation.id,fiscalRangeId:range.id,prefix:'E32',startNumber:master.allocationStart,currentNumber:master.allocationStart,endNumber:master.allocationStart+1,expiryDate:range.expiryDate||''});
 await put('internalSequences',{id:'online-series',documentType:'TICKET',prefix:'LAB-',padding:6,nextNumber:1});await put('globalSequenceCounter',{id:'value',count:0});
 const version=sale.version;await sql.run('UPDATE master_v3_state SET active_sync_id=?,active_version=? WHERE singleton=1',[version.syncId,version.syncVersion],false);
 await sql.run('INSERT INTO master_v3_operational_owner VALUES(1,?,?,?)',[version.syncId,version.syncVersion,binding],false);await sql.run("INSERT INTO master_v3_inventory_state VALUES(1,?,?,?,?,?)",[ready.inventorySyncId,ready.inventorySyncVersion,ready.inventoryVersion,ready.inventoryCursor,'laboratory'],false);
 await sql.run('INSERT INTO master_v3_catalog_owners VALUES(?,?,?,?,?,?,?)',[version.syncId,version.syncVersion,binding,ready.inventorySyncId,ready.inventorySyncVersion,ready.inventoryVersion,ready.inventoryCursor],false);
 await sql.run("INSERT INTO sync_v3_sessions(sync_id,sync_version,schema_version,contract_version,status,manifest_json,created_at,updated_at) VALUES(?,?,3,2,'ACTIVE','{}','laboratory','laboratory')",[version.syncId,version.syncVersion],false);
 await sql.run('INSERT INTO master_v3_inventory_balances VALUES(?,?,?,?,?,?)',[sale.article.id,warehouse,balance.qtyOnHand,balance.qtyReserved,balance.qtyCommitted,'laboratory'],false);
 await sql.run('INSERT INTO master_v3_articles(sync_version,article_id,taxable,tax_ids_json,active,sellable,record_json) VALUES(?,?,0,?,1,1,?)',[version.syncVersion,sale.article.id,'[]',JSON.stringify({...sale.article,active:true,sellable:true})],false);
 await sql.run('INSERT INTO master_v3_tariffs(sync_version,tariff_id,active,record_json) VALUES(?,?,1,?)',[version.syncVersion,sale.tariff.id,JSON.stringify({...sale.tariff,name:'Synthetic tariff',active:true})],false);await sql.run('INSERT INTO master_v3_prices VALUES(?,?,?,?)',[version.syncVersion,sale.article.id,sale.tariff.id,sale.price],false);
 return {warehouse,binding};
}
async function restoreSession(){config=await adapter.getDocument('config','current');const ready=input.catalog.ready,runtime=await LargeMasterSyncV3Runtime.open(adapter.masterSyncV3Store);assert(runtime,'LAB_RUNTIME_MISSING');
 session=new (LargeMasterSyncV3OperationalSession as any)({runtime,inventorySyncId:ready.inventorySyncId,inventorySyncVersion:ready.inventorySyncVersion,inventoryVersion:ready.inventoryVersion,inventoryCursor:ready.inventoryCursor},current.binding,adapter.masterSyncV3Store,origin,identity);g.__fiscalQA.session=session;
}
async function reserve(){const business=await adapter.getDocument('config','current'),range=await adapter.getDocument('fiscalRanges',master.fiscalRangeId),allocation=await adapter.getDocument('fiscalAllocations',master.fiscalAllocationId),buffer=await adapter.getDocument('localFiscalBuffer','online-buffer');
 const ncf=formatFiscalNumber('E32',buffer.prefix,buffer.currentNumber);assert(ncf!==input.controlNcf,'LAB_CONTROL_ORIGINAL_REUSE');validateFiscalBufferReservation({business,buffer,allocation,range,terminalId:scope.terminalId,type:'E32',ncf});const fiscalIssuance=snapshotFiscalIssuance(business,range,allocation,buffer,ncf);
 await adapter.reserveFinancialNumbers({global:false,fiscal:{terminalId:scope.terminalId,type:'E32',ncf,expectedConfig:JSON.stringify(business),expectedBuffer:JSON.stringify(buffer),expectedAllocation:JSON.stringify(allocation),expectedRange:JSON.stringify(range)}});return {ncf,fiscalIssuance};
}
async function createSource(index:number){await mark('CREATING_SOURCE_'+index);const product=await session.withStock((await(await session.catalog(input.catalog.sale.tariff.id,current.warehouse)).get(input.catalog.sale.article.id)).product,current.warehouse);
 const fiscalEnvironment=explicitTerminalFiscalEnvironment(config.terminals[0],scope.terminalId,'MSELLER','ECF');assert(fiscalEnvironment===0,'LAB_ENVIRONMENT_NOT_EXPLICIT');const reserved=await reserve(),tx=await transactionService.createTransaction({id:uid(),documentType:'TICKET',seriesId:'online-series',terminalId:scope.terminalId,date:new Date().toISOString(),status:'COMPLETED',userId:'laboratory-user',userName:'Laboratory',...reserved,electronicNcf:reserved.ncf,ncfType:'E32',fiscalMode:'ECF',fiscalProvider:'MSELLER',fiscalEnvironment,settlementCurrencyCode:'DOP',settlementAppliedBase:100,pendingBalance:0,netAmount:100,taxAmount:0,total:100,discountAmount:0,items:[{...product,quantity:1,cartId:uid(),netAmount:100,taxAmount:0,totalAmount:100}],payments:[{id:uid(),method:'CASH' as any,amount:100,appliedAmount:100,currency:'DOP',timestamp:new Date()}]},{deferDurablePersistence:true});
 const result=await persistV3FinancialTransaction(tx,config,current.warehouse);assert(result.created,'LAB_NEW_SOURCE_ALREADY_EXISTS');const original=await adapter.getDocument('transactions',tx.id),anchors=await adapter.getFiscalAppliedSourceRows(tx.id);assert(anchors.length===2,'LAB_SOURCE_EVENT_COUNT');
 current.sources.push({id:tx.id,original,anchors,index,sourceHash:await sha256Utf8(JSON.stringify(original)),outboxHash:await sha256Utf8(JSON.stringify(anchors))});await mark('SOURCE_COMMITTED_'+index);return current.sources[current.sources.length-1];
}
async function transport(source:any){for(const type of ['SALE_POSTED','PAYMENT_POSTED']){const anchor=source.anchors.find((row:any)=>row.event_type===type);assert(anchor,'LAB_EVENT_MISSING');await mark('INBOX_INTENT_'+source.index+'_'+type);await json('/__lab/inbox','POST',{event_id:anchor.event_id,event_type:anchor.event_type,payload:JSON.parse(anchor.payload_json)});await mark('INBOX_APPLIED_'+source.index+'_'+type);}}
async function dispatch(source:any,loseAck=false){const catalog=async()=>({...session.ready.runtime.version,binding:session.binding});
 const readiness=createAppliedReceiptReadiness({pair:async(id:string)=>({transaction:await adapter.getDocument('transactions',id),history:await adapter.getDocument('transactionHistory',id)}),rows:(id:string)=>adapter.getFiscalAppliedSourceRows(id),context,catalog,fetchImpl:request,timeoutMs:15000});
 const fetchImpl=async(url:any,init:any)=>{const response=await request(url,init);if(loseAck&&init?.method==='POST'){const raw=await response.text();report.lostAckResponse={status:response.status,bodySha256:await sha256Utf8(raw),simulation:'real HTTP response consumed, then deliberate acknowledgement loss'};throw Error('LAB_INJECTED_ACK_LOST_AFTER_REAL_RESPONSE');}return response;};
 return createMSellerDispatcher({assertReady:readiness,context,get:(c:string,id:string)=>adapter.getDocument(c,id),commit:(entries:any[])=>adapter.saveDocumentsAtomically(entries),outboxRows:(id:string)=>adapter.getFiscalAppliedSourceRows(id),catalog,fetchImpl:fetchImpl as any,timeoutMs:15000})({providerId:'MSELLER',environment:0,transaction:await adapter.getDocument('transactions',source.id),credentialKey:master.issuerRnc,sequenceExpiryDate:master.expiryDate,companyInfo:{name:'Synthetic Android laboratory',rnc:master.issuerRnc,phone:'0000000000',address:'Isolated laboratory'}});
}
async function snapshot(){const financial=await rows("SELECT collection_name,doc_id,data FROM documents WHERE collection_name IN ('transactions','transactionHistory','inventoryLedger','internalSequences','globalSequenceCounter','localFiscalBuffer','fiscalDispatchClaims') ORDER BY collection_name,doc_id"),outbox=await rows('SELECT * FROM sync_outbox_v2 ORDER BY local_sequence');return{financial,outbox,financialSha256:await sha256Utf8(JSON.stringify(financial)),outboxSha256:await sha256Utf8(JSON.stringify(outbox)),quickCheck:await rows('PRAGMA quick_check')};}
async function exclusive<T>(fn:()=>Promise<T>){assert(!busy,'LAB_CONCURRENT_DRIVER_DENIED');busy=true;try{return await fn();}catch(error){report.error=String(error);report.stack=(error as any)?.stack;emit('ONLINE_LAB_HELD');throw error;}finally{busy=false;}}
async function start(){return exclusive(async()=>{assert(!localStorage.getItem(storageKey),'LAB_SESSION_EXISTS_RECOVER_ONLY');await preflight();const name='fiscal_online_'+Date.now(),exists=await connections.isDatabase(name);assert(!exists.result,'LAB_DATABASE_EXISTS_NO_RESET');await open(name);localStorage.setItem(storageKey,name);const seeded=await seed();current={id:'state',database:name,phase:'SEEDED',...seeded,sources:[],metricsBefore:await json('/__lab/metrics')};await mark('SEEDED');await restoreSession();
 for(let i=0;i<2;i++){const source=await createSource(i);await transport(source);await mark('DISPATCH_INTENT_'+i);if(i===0){source.result=await dispatch(source);assert(source.result.pending===true&&source.result.status==='PENDING','LAB_PENDING_REQUIRED');}else{let held=false;try{await dispatch(source,true);}catch(error){held=String(error).includes('FISCAL_DISPATCH_UNKNOWN_GET_ONLY');}assert(held,'LAB_LOST_ACK_NOT_HELD');source.result={state:'UNKNOWN_GET_ONLY',simulation:'lost response injected after actual server response'};}assert(await adapter.getDocument(FISCAL_DISPATCH_CLAIMS,source.id),'LAB_CLAIM_MISSING');source.metricsAfter=await json('/__lab/metrics');assert(source.metricsAfter.providerCalls===current.metricsBefore.providerCalls+i+1,'LAB_CASE_PROVIDER_COUNT');await mark('DISPATCH_FINISHED_'+i);}
 current.metricsAfter=await json('/__lab/metrics');assert(current.metricsAfter.providerCalls===current.metricsBefore.providerCalls+2,'LAB_PROVIDER_CALL_COUNT');current.beforeRestart=await snapshot();await mark('AWAIT_PROCESS_RESTART');report.session=clone(current);emit('ONLINE_READY_FOR_PROCESS_RESTART');return clone(report);});}
async function recover(){return exclusive(async()=>{await preflight();const name=localStorage.getItem(storageKey);assert(name,'LAB_NO_SESSION');await open(name);current=await adapter.getDocument('qa_online','state');assert(current?.phase==='AWAIT_PROCESS_RESTART'||current?.phase==='RESTART_VERIFIED','LAB_PARTIAL_PHASE_HELD_NO_AUTORETRY');await restoreSession();const before=await snapshot();assert(before.financialSha256===current.beforeRestart.financialSha256&&before.outboxSha256===current.beforeRestart.outboxSha256,'LAB_RESTART_STATE_CHANGED');
 for(const source of current.sources){const count=network.length;let held=false;try{await dispatch(source);}catch(error){held=String(error).includes('FISCAL_DISPATCH_UNKNOWN_GET_ONLY');}assert(held&&network.length===count,'LAB_SECOND_POST_OR_GET');assert(!(await persistV3FinancialTransaction(source.original,config,current.warehouse)).created,'LAB_FINANCIAL_REPLAY_CREATED');const anchors=await adapter.getFiscalAppliedSourceRows(source.id);assert(await sha256Utf8(JSON.stringify(anchors))===source.outboxHash,'LAB_ORIGINAL_OUTBOX_CHANGED');}
 const after=await snapshot();assert(after.financialSha256===before.financialSha256&&after.outboxSha256===before.outboxSha256,'LAB_REPLAY_CHANGED_STATE');report.metricsAfterRestart=await json('/__lab/metrics');assert(report.metricsAfterRestart.providerCalls===current.metricsAfter.providerCalls,'LAB_PROVIDER_REPLAY_COUNT');report.afterRestart=after;report.session=clone(current);await mark('RESTART_VERIFIED');emit('ONLINE_ANDROID_INTEGRATION_COMPLETED');return clone(report);});}
g.fiscalOnlineQA={preflight,start,recover,snapshot:async()=>snapshot(),report:()=>clone(report)};
// Startup performs no financial/SQLite writes. Only explicit QA.start creates sources.
preflight().catch(error=>{report.error=String(error);emit('ONLINE_PREFLIGHT_BLOCKED');});
