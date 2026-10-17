/* Disposable synthetic laboratory only. No App/bootstrap, provider or HTTP authority. */
import {Capacitor} from '@capacitor/core';
import {CapacitorSQLite,SQLiteConnection} from '@capacitor-community/sqlite';
import {CapacitorSQLiteAdapter} from '../../services/db/adapters/CapacitorSQLiteAdapter';
import {LargeMasterSyncV3Runtime} from '../../services/sync/LargeMasterSyncV3Runtime';
import {LargeMasterSyncV3OperationalSession} from '../../services/sync/LargeMasterSyncV3OperationalSession';
import {transactionService} from '../../services/transactionService';
import {persistV3FinancialTransaction} from '../../services/sync/LargeMasterSyncV3FinancialCommit';
import {createMSellerDispatcher,FISCAL_DISPATCH_CLAIMS} from '../../services/fiscal/FiscalMSellerDispatch';
import {captureFiscalBoundContext} from '../../services/fiscal/FiscalBoundContext';
import {validateAppliedReceiptV2,FISCAL_OUTBOX_SOURCE_SQL,fiscalOutboxSourceParams} from '../../services/fiscal/FiscalAppliedReceiptV2';
import {DURABLE_OUTBOX_SCHEMA_SQL} from '../../services/sync/DurableOutboxSchema';
import wire from '../../tests/fixtures/fiscal-applied-receipt-v2/E32-none.json';
const g=globalThis as any,clone=(v:any)=>JSON.parse(JSON.stringify(v)),id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const assert=(v:any,message:string)=>{if(!v)throw Error(message);};
const report:any={laboratoryOnly:true,network:'disabled',platform:Capacitor.getPlatform(),userAgent:navigator.userAgent,checks:[],timings:{}};
const emit=(state:string)=>{report.state=state;const text=JSON.stringify(report);document.getElementById('result')!.textContent=text;document.title=state;console.log('FISCAL_QA_RESULT '+text);};
window.fetch=async()=>{throw Error('LAB_NO_NETWORK');};
const connections=new SQLiteConnection(CapacitorSQLite);
async function connection(name:string){const has=await connections.isConnection(name,false);const sql=has.result?await connections.retrieveConnection(name,false):await connections.createConnection(name,false,'no-encryption',1,false);if(!(await sql.isDBOpen()).result)await sql.open();return sql;}
async function isolatedAdapter(name:string){const sql=await connection(name),adapter=new CapacitorSQLiteAdapter();Object.assign(adapter,{db:sql,isReady:true});await (adapter as any).initSchema();return{sql,adapter};}
async function put(sql:any,collection:string,doc:any){await sql.run('INSERT INTO documents(collection_name,doc_id,data,sort_order,updatedAt) VALUES(?,?,?,0,?)',[collection,doc.id,JSON.stringify(doc),'synthetic'],false);}
async function rows(sql:any,q:string,p:any[]=[]){return(await sql.query(q,p)).values||[];}
async function state(sql:any){return JSON.stringify({documents:await rows(sql,'SELECT * FROM documents ORDER BY collection_name,doc_id'),outbox:await rows(sql,'SELECT * FROM sync_outbox_v2 ORDER BY local_sequence')});}
function ports(adapter:any,sql:any,identity:any){g.__fiscalQA={adapter,identity,db:{get:(n:string)=>adapter.getCollection(n),getDocument:(...a:any[])=>adapter.getDocument(...a),save:(...a:any[])=>adapter.saveCollection(...a),saveDocument:(...a:any[])=>adapter.saveDocument(...a),reserveTransactionNumbers:(seriesId:string,documentType:string)=>adapter.reserveFinancialNumbers({seriesId,documentType,global:true}),assertFiscalTransactionAuthority:async()=>{}},session:null};}
async function seedFinancial(sql:any){
 const binding=JSON.stringify([id(1),id(4),id(50),'https://erp.invalid','https://erp.invalid']);
 await put(sql,'config',{id:'current',terminals:[{id:id(4),config:{erpTerminalId:id(4),currentDeviceId:id(50),erpBinding:{tenantId:id(1),companyId:id(2),storeId:id(3)},inventoryScope:{defaultSalesWarehouseId:id(5)}}}]});
 await put(sql,'internalSequences',{id:id(9),documentType:'TICKET',prefix:'TCK-',padding:6,nextNumber:1});await put(sql,'globalSequenceCounter',{id:'value',count:0});
 await sql.run('UPDATE master_v3_state SET active_sync_id=?,active_version=? WHERE singleton=1',[id(60),32],false);
 await sql.run('INSERT INTO master_v3_operational_owner VALUES(1,?,?,?)',[id(60),32,binding],false);await sql.run('INSERT INTO master_v3_inventory_state VALUES(1,?,?,?,?,?)',[id(60),32,4,'inventory-cursor','synthetic'],false);
 await sql.run("INSERT INTO sync_v3_sessions(sync_id,sync_version,schema_version,contract_version,status,manifest_json,created_at,updated_at) VALUES(?,32,3,2,'ACTIVE','{}','synthetic','synthetic')",[id(60)],false);
 await sql.run('INSERT INTO master_v3_inventory_balances VALUES(?,?,?,?,?,?)',[id(7),id(5),100000,0,0,'synthetic'],false);
 const product={id:id(7),name:'Synthetic',type:'PRODUCT',inventoriable:true,active:true,sellable:true,taxable:false,taxIds:[],variants:[],cost:35,activeWarehouseIds:[id(5)],operationalFlags:{trackInventory:true,allowNegativeStock:false}};
 await sql.run('INSERT INTO master_v3_articles(sync_version,article_id,taxable,tax_ids_json,active,sellable,record_json) VALUES(32,?,0,?,1,1,?)',[id(7),'[]',JSON.stringify(product)],false);
 await sql.run('INSERT INTO master_v3_tariffs(sync_version,tariff_id,active,record_json) VALUES(32,?,1,?)',[id(6),JSON.stringify({id:id(6),name:'Synthetic',active:true,taxIncluded:false})],false);await sql.run('INSERT INTO master_v3_prices VALUES(32,?,?,100)',[id(7),id(6)],false);
}
async function financialSession(adapter:any,sql:any){
 const identity={tenantId:id(1),terminalId:id(4),deviceId:id(50),erpSyncBaseUrl:'https://erp.invalid',syncToken:'laboratory-only'};ports(adapter,sql,identity);
 const store=adapter.masterSyncV3Store,runtime=await LargeMasterSyncV3Runtime.open(store);g.__fiscalQA.session=new (LargeMasterSyncV3OperationalSession as any)({runtime,inventoryVersion:4,inventoryCursor:'inventory-cursor'} as any,(await store.getOperationalOwner()).binding,store,'https://erp.invalid',identity);
 const session=g.__fiscalQA.session,config=await session.projectConfig(await adapter.getDocument('config','current')),product=await session.withStock((await(await session.catalog(id(6),id(5))).get(id(7))).product,id(5));return{config,product};
}
async function newCash(product:any,n:number){return transactionService.createTransaction({id:id(n),documentType:'TICKET',seriesId:id(9),terminalId:id(4),date:'2026-10-17T12:00:00Z',status:'COMPLETED',userId:id(25),userName:'Laboratory',fiscalEnvironment:0,items:[{...product,quantity:1,cartId:'cash-line',netAmount:100,taxAmount:0,totalAmount:100}],netAmount:100,taxAmount:0,total:100,payments:[{id:id(n+100000),method:'CASH' as any,amount:100,timestamp:new Date('2026-10-17T12:00:00.123Z')}]},{deferDurablePersistence:true});}
async function seedReceipt(sql:any){const original=clone(wire.originalSource.transaction),stamp=original.items[0].v3SaleAuthority,scope=wire.expectedResponse.scope;
 await sql.run('UPDATE master_v3_state SET active_sync_id=?,active_version=?',[stamp.syncId,stamp.syncVersion],false);await sql.run('INSERT INTO master_v3_operational_owner VALUES(1,?,?,?)',[stamp.syncId,stamp.syncVersion,original.v3Binding],false);
 await sql.run("INSERT INTO master_v3_inventory_state VALUES(1,?,?,?,?,'synthetic')",[stamp.inventorySyncId||stamp.syncId,stamp.inventorySyncVersion??stamp.syncVersion,stamp.inventoryVersion,stamp.inventoryCursor],false);
 await sql.run('INSERT INTO master_v3_catalog_owners VALUES(?,?,?,?,?,?,?)',[stamp.syncId,stamp.syncVersion,original.v3Binding,stamp.inventorySyncId||stamp.syncId,stamp.inventorySyncVersion??stamp.syncVersion,stamp.inventoryVersion,stamp.inventoryCursor],false);
 for(const collection of ['transactions','transactionHistory'])await put(sql,collection,original);
 await put(sql,'config',{id:'current',companyInfo:{rnc:wire.expectedResponse.issuer.rnc},terminals:[{id:scope.terminalId,config:{currentDeviceId:scope.deviceId,erpBinding:{tenantId:scope.tenantId,companyId:scope.companyId,storeId:scope.storeId}}}]});
 const row=wire.materializedSnapshot.sources[0] as any,payload=row.payload.erp_fiscal_v3_application_plan_v1.originalPayload;
 await sql.run("INSERT INTO sync_outbox_v2(event_id,event_type,aggregate_type,aggregate_id,schema_version,payload_json,status,created_at,updated_at) VALUES(?,?,'TRANSACTION',?,1,?,'PENDING','synthetic','synthetic')",[row.event_id,row.event_type,original.id,JSON.stringify(payload)],false);
}
async function receiptDispatcher(adapter:any,sql:any,commit?:any){const tx=clone(wire.originalSource.transaction),scope=wire.expectedResponse.scope,binding=JSON.parse(tx.v3Binding),identity={erpSyncBaseUrl:binding[3],tenantId:scope.tenantId,terminalId:scope.terminalId,deviceId:scope.deviceId,syncToken:'laboratory-sync'},credentials={...identity,companyId:scope.companyId,storeId:scope.storeId,deviceToken:'laboratory-device',deviceTokenSource:'ERP_REGISTER',authStatus:'ERP_ACTIVE'};
 const context=()=>captureFiscalBoundContext(()=>identity,()=>credentials as any);let posts=0;
 const input:any={providerId:'MSELLER',environment:0,transaction:tx,credentialKey:wire.expectedResponse.issuer.rnc,sequenceExpiryDate:tx.fiscalIssuance.expiryDate,companyInfo:{name:'Laboratory',rnc:wire.expectedResponse.issuer.rnc}};
 const deps:any={context,get:(n:string,k:string)=>adapter.getDocument(n,k),catalog:async()=>({syncId:tx.items[0].v3SaleAuthority.syncId,syncVersion:tx.items[0].v3SaleAuthority.syncVersion,binding:tx.v3Binding}),outboxRows:(key:string)=>adapter.getFiscalAppliedSourceRows(key),commit:commit||((entries:any[])=>adapter.saveDocumentsAtomically(entries)),assertReady:async()=>{const all=await adapter.getFiscalAppliedSourceRows(tx.id);return validateAppliedReceiptV2(clone(wire.expectedResponse),{sale:all[0],payment:null},scope,tx);},fetchImpl:async()=>{posts++;throw Error('LAB_SIMULATED_LOST_PROVIDER_ACK');}};
 return{run:()=>createMSellerDispatcher(deps)(input),posts:()=>posts};
}
async function functional(){
 assert(Capacitor.isNativePlatform()&&Capacitor.getPlatform()==='android','REAL_ANDROID_REQUIRED');
 const probe=await connection('clic_pos_native');await probe.execute('CREATE TABLE IF NOT EXISTS documents(collection_name TEXT NOT NULL,doc_id TEXT NOT NULL,data TEXT NOT NULL,sort_order INTEGER NOT NULL DEFAULT 0,updatedAt TEXT NOT NULL,PRIMARY KEY(collection_name,doc_id));',false);
 const phase=(await rows(probe,"SELECT data FROM documents WHERE collection_name='qa_lab' AND doc_id='state'"))[0];
 if(!phase){for(let n=0;n<100;n++)await put(probe,'legacySynthetic',{id:'legacy-'+n,value:n});}
 const legacyBefore=JSON.stringify(await rows(probe,"SELECT * FROM documents WHERE collection_name='legacySynthetic' ORDER BY doc_id"));await connections.closeConnection('clic_pos_native',false);
 const adapter=new CapacitorSQLiteAdapter(),cold=performance.now();await adapter.connect();report.timings.actualAdapterColdConnectMs=performance.now()-cold;const sql=(adapter as any).db;
 assert(legacyBefore===JSON.stringify(await rows(sql,"SELECT * FROM documents WHERE collection_name='legacySynthetic' ORDER BY doc_id")),'LEGACY_MIGRATION_CHANGED');report.checks.push('100 legacy synthetic rows preserved');
 report.sqliteVersion=(await rows(sql,'SELECT sqlite_version() AS version'))[0];report.quickCheck=await rows(sql,'PRAGMA quick_check');assert(report.quickCheck[0].quick_check==='ok','QUICK_CHECK');
 report.schema=await rows(sql,"SELECT type,name,sql FROM sqlite_master WHERE name LIKE 'idx_outbox_fiscal_%' OR name LIKE 'preserve_fiscal_dispatch_%' ORDER BY name");assert(report.schema.length===6,'MIGRATION_INDEX_TRIGGER_COUNT');
 if(!phase)await seedFinancial(sql);const f=await financialSession(adapter,sql);
 if(!phase){const source=await newCash(f.product,900);assert(typeof source.payments[0].timestamp==='string','DATE_NOT_ISO_BEFORE_IDENTITY');const first=await persistV3FinancialTransaction(source,f.config,id(5));assert(first.created,'FIRST_CASH_NOT_CREATED');const originalState=await state(sql);assert(!(await persistV3FinancialTransaction(source,f.config,id(5))).created,'LIVE_CONSTRUCTOR_REPLAY_FAILED');assert(await state(sql)===originalState,'LIVE_CONSTRUCTOR_REPLAY_CHANGED_DB');report.checks.push('same live constructor object replay before any JSON/reload');await put(sql,'qa_lab',{id:'source',source});}
 const source=(await adapter.getDocument<any>('qa_lab','source'))!.source,before=await state(sql),loaded=await adapter.getDocument<any>('transactions',source.id);
 for(const candidate of [source,loaded])assert(!(await persistV3FinancialTransaction(candidate,f.config,id(5))).created,'CASH_REPLAY_NOT_IDEMPOTENT');assert(await state(sql)===before,'CASH_REPLAY_CHANGED_DB');report.checks.push('actual constructor CASH ISO + original/durable replay read-only');
 for(const collection of ['transactions','transactionHistory'])assert((await adapter.getDocument<any>(collection,source.id))!.payments[0].timestamp==='2026-10-17T12:00:00.123Z','DURABLE_DATE_CHANGED');
 const cashRows=await rows(sql,'SELECT * FROM sync_outbox_v2 ORDER BY local_sequence');assert(cashRows.length===2,'CASH_EVENTS_DUPLICATED');report.cashOutbox=cashRows;
 for(const lostAck of [false,true]){
  const c=await isolatedAdapter(lostAck?'fiscal_qa_claim_ackloss':'fiscal_qa_claim');const existing=await c.adapter.getDocument(FISCAL_DISPATCH_CLAIMS,wire.originalSource.transaction.id);
  if(!existing){await seedReceipt(c.sql);const initial=await state(c.sql),run=c.sql.run.bind(c.sql);let calls=0;
   (c.sql as any).run=async(...args:any[])=>{if(++calls===2)throw Error('LAB_PRECOMMIT_FAULT');return run(...args as [any,any,any,any]);};
   let failed=false;try{await(await receiptDispatcher(c.adapter,c.sql)).run();}catch{failed=true;}finally{(c.sql as any).run=run;}
   assert(failed&&await state(c.sql)===initial,'NATIVE_ROLLBACK_FAILED');report.checks.push('native claim precommit fault rolled back '+lostAck);
   const dispatch=await receiptDispatcher(c.adapter,c.sql,lostAck?async(entries:any[])=>{await c.adapter.saveDocumentsAtomically(entries);throw Error('LAB_POSTCOMMIT_ACK_LOST');}:undefined);
   try{await dispatch.run();}catch{/* expected ambiguous simulated transport/commit ACK */}
   assert(await c.adapter.getDocument(FISCAL_DISPATCH_CLAIMS,wire.originalSource.transaction.id),'CLAIM_NOT_DURABLE');assert(dispatch.posts()===(lostAck?0:1),'POST_COUNT');
   assert(JSON.stringify(await rows(c.sql,'SELECT * FROM sync_outbox_v2 ORDER BY local_sequence'))===JSON.stringify(JSON.parse(initial).outbox),'CLAIM_CHANGED_OUTBOX');
  }
  const after=await state(c.sql),again=await receiptDispatcher(c.adapter,c.sql);let blocked=false;try{await again.run();}catch(error){blocked=String(error).includes('UNKNOWN_GET_ONLY');}assert(blocked&&again.posts()===0&&await state(c.sql)===after,'CLAIM_RETRY_NOT_GET_ONLY');report.checks.push('immutable native claim GET-only '+lostAck+(phase?' after process restart':''));
 }
 if(!phase){await put(sql,'qa_lab',{id:'state',phase:'await-process-restart',createdAt:new Date().toISOString()});emit('READY_FOR_PROCESS_RESTART');}
 else{report.checks.push('actual process reopen retained CASH source and both claims');emit('NATIVE_FUNCTIONAL_COMPLETED');}
}
const indexNames=['idx_outbox_fiscal_aggregate','idx_outbox_fiscal_transaction_alias','idx_outbox_fiscal_summary_alias'];
const percentile=(a:number[],p:number)=>[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.ceil(a.length*p)-1)];
const stats=(raw:number[])=>({n:raw.length,p50:percentile(raw,.5),p95:percentile(raw,.95),p99:percentile(raw,.99),max:Math.max(...raw),raw});
async function runPerformance(options:{mode:'base'|'candidate';session:number;n:number;seedRows:number}){
 assert(options.mode==='base'||options.mode==='candidate','MODE');assert(Number.isInteger(options.session)&&options.session>=1&&options.session<=3&&options.n===100&&options.seedRows===10000,'FIXED_SAMPLE_PROFILE');
 const name='fiscal_qa_perf_'+options.mode+'_'+options.session,has=await connections.isDatabase(name);assert(!has.result,'PERF_DATABASE_ALREADY_EXISTS_NO_RESET');
 const sql=await connection(name),adapter=new CapacitorSQLiteAdapter();Object.assign(adapter,{db:sql,isReady:true});await(adapter as any).initSchema();
 // Both synthetic fixture DBs start preindex and populated; candidate adds the real three indexes once.
 for(const index of indexNames)await sql.execute('DROP INDEX '+index+';',false);
 const payload=JSON.stringify({transaction:{id:'synthetic-foreign'},summary:{transaction_id:'synthetic-foreign'},padding:'x'.repeat(17450)}),insert="INSERT INTO sync_outbox_v2(event_id,event_type,aggregate_type,aggregate_id,schema_version,payload_json,status,created_at,updated_at) VALUES(?,'SALE_POSTED','TRANSACTION',?,1,?,'PENDING','synthetic','synthetic')";
 for(let offset=0;offset<options.seedRows;offset+=100){const set=[];for(let i=offset;i<offset+100;i++)set.push({statement:insert,values:['seed-'+i,'foreign-'+i,payload]});await sql.executeSet(set,true);}
 const migrationStart=performance.now();if(options.mode==='candidate'){for(const statement of DURABLE_OUTBOX_SCHEMA_SQL.split(';').filter(q=>indexNames.some(index=>q.includes('CREATE INDEX IF NOT EXISTS '+index))))await sql.execute(statement+';',false);}const migrationMs=performance.now()-migrationStart;
 const isolated:number[]=[],lookup:number[]=[];for(let i=0;i<105;i++){const t=performance.now();await sql.run(insert,['extra-'+i,'extra-'+i,payload],false);if(i>=5)isolated.push(performance.now()-t);}
 const plan=await rows(sql,'EXPLAIN QUERY PLAN '+FISCAL_OUTBOX_SOURCE_SQL,fiscalOutboxSourceParams('foreign-50'));
 for(let i=0;i<105;i++){const t=performance.now();await rows(sql,FISCAL_OUTBOX_SOURCE_SQL,fiscalOutboxSourceParams('foreign-50'));if(i>=5)lookup.push(performance.now()-t);}
 await seedFinancial(sql);const f=await financialSession(adapter,sql),commit:number[]=[],constructor:number[]=[];
 for(let i=0;i<105;i++){const a=performance.now(),source=await newCash(f.product,1000+i);const b=performance.now();const result=await persistV3FinancialTransaction(source,f.config,id(5));assert(result.created,'PERF_FINANCIAL_DUPLICATE');const c=performance.now();if(i>=5){constructor.push(b-a);commit.push(c-b);}}
 const counts={transactions:(await rows(sql,"SELECT count(*) n FROM documents WHERE collection_name='transactions'"))[0].n,history:(await rows(sql,"SELECT count(*) n FROM documents WHERE collection_name='transactionHistory'"))[0].n,ledger:(await rows(sql,"SELECT count(*) n FROM documents WHERE collection_name='inventoryLedger'"))[0].n,outbox:(await rows(sql,'SELECT count(*) n FROM sync_outbox_v2'))[0].n};
 assert(counts.transactions===105&&counts.history===105&&counts.ledger===105&&counts.outbox===options.seedRows+105+210,'PERF_STATE_COUNTS');
 const result={laboratoryOnly:true,profile:'native-bridge-WebView-performance.now',options,payloadBytes:new TextEncoder().encode(payload).length,migrationMs,plan,isolatedInsert:stats(isolated),lookup:stats(lookup),constructor:stats(constructor),financialCommit:stats(commit),counts,quickCheck:await rows(sql,'PRAGMA quick_check')};console.log('FISCAL_QA_PERFORMANCE '+JSON.stringify(result));document.getElementById('result')!.textContent=JSON.stringify(result);return result;
}
g.fiscalQA={runPerformance};functional().catch(error=>{report.error=String(error);report.stack=error?.stack;emit('NATIVE_FUNCTIONAL_FAILED');});
