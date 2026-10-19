/** Real POS callback, transaction builder, App handler and native financial writer.
 * Only authority/catalog/transport boundaries are controlled; birth and events are never supplied. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import SQLite from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {inventoryPresentationRevision} from '../services/inventoryPresentations/contract';
import {fiscalQrSvg} from '../services/fiscal/FiscalQrSvg';
import ts from 'typescript';
import assert from 'node:assert/strict';
import {snapshotFiscalIssuance} from '../utils/fiscalIssuance';
import {fiscalWorkflowScopeKey,type FiscalWorkflowPermitV2} from '../services/fiscal/FiscalWorkflowV2Types';
export async function produceFiscalWorkflowSale(seed:{permit:FiscalWorkflowPermitV2;ordinary?:boolean;ncfSequence?:number;operationId?:string;fault?:boolean;sourceFixture?:any;statePath?:string}){
 process.env.CLIC_FISCAL_PRODUCER_EXPORT='1';
 const {scenario,create,appFor}=await import('./inventoryPresentationsProducerWriter.test');
 const s=await scenario({ordinary:seed.ordinary!==false});
 try{
  if(seed.sourceFixture)await configureSourceFixture(s,seed);
  for(const k of ['tenantId','companyId','storeId','terminalId','deviceId'] as const)assert.equal(seed.permit.scope[k],s.scope[k],`Producer scope ${k}`);
  const store=s.adapter.fiscalWorkflowStore,key=fiscalWorkflowScopeKey(seed.permit.scope);
  const checkoutRef:any={current:null},operationRef={current:seed.operationId||'fixture-operation'},paymentIds=s.transaction.payments.map((p:any)=>p.id);
  const text=readFileSync(new URL('../components/POSInterface.tsx',import.meta.url),'utf8'),ast=ts.createSourceFile('POSInterface.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let arrow:ts.Expression|undefined;
  function visit(n:ts.Node){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='beforeV3PaymentEffects')arrow=n.initializer;ts.forEachChild(n,visit);}visit(ast);assert.ok(arrow);
  let network=0,permitRequests=0;const context=s.m.captureFiscalStatusBoundContext();s.m.observeFiscalWorkflowCapability(context.base,context.headers,'2');
  const client=s.m.createFiscalWorkflowV2Client({store:()=>store,readAuth:()=>context,fetchImpl:async(url:string,options:any)=>{assert.match(url,/fiscal\/workflow\/v2\/permits$/);assert.equal(options.method,'POST');permitRequests++;return {ok:true,json:async()=>({schemaVersion:2,authorityHash:(seed as any).authority?.authorityHash||seed.permit.authorityHash,permits:[seed.permit]})};}});
  await client.prefetch();
  const bindings:any={completedReservationForReceipt:async()=>null,assertCheckoutFiscalAuthority:async()=>{},hasV3ReservationCart:false,activeV3Reservation:null,selectedCustomer:null,v3Operational:{validate:async()=>{}},fiscalCompliance:{mode:'ECF'},fiscalWorkflowV2Client:client,getDefaultFiscalProvider:()=> 'MSELLER',config:s.config,activeTerminalConfig:s.config.terminals[0].config,activeRecoveredReservation:null,activeDirectV3TicketId:null,activeTable:null,processedCart:s.transaction.items,cart:s.transaction.items,fiscalCheckoutRef:checkoutRef,fiscalCheckoutOperationRef:operationRef,effectiveSelectedCustomer:null,requiredSaleFiscalType:'E32',currentFiscalCheckoutCartIdentity:()=>JSON.stringify({items:s.transaction.items,customerId:s.transaction.customerId||null,fiscalType:'E32'}),onUpdateCart:()=>{},createUuid:()=>{throw Error('Unexpected operation identity replacement');},setErrorToast:()=>{},setLargeMasterSyncV3CriticalOperation:()=>{},formatRuntime:null,db:{getDocument:(c:string,id:string)=>s.adapter.getDocument(c,id)}};
  const js=ts.transpileModule('const callback='+arrow.getText(ast)+';',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const beforePaymentEffects=new Function(...Object.keys(bindings),js+'return callback;')(...Object.values(bindings));
  const fence=await beforePaymentEffects(paymentIds);assert.ok(fence.futureCheckout);
  for(const id of paymentIds)await fence.recordPaymentEffect(id);
  const checkout=checkoutRef.current,sequence=seed.ncfSequence||seed.sourceFixture?.transaction?.fiscalIssuance?.sequence||1,ncf='E32'+String(sequence).padStart(10,'0');
  // Native reservation happens at the same caller boundary as POS handlePaymentConfirm.
  const originalIssuance=seed.sourceFixture?.transaction?.fiscalIssuance;
  const range={id:originalIssuance?.fiscalRangeId||'fixture-ecf-range',type:'E32',prefix:'E32',startNumber:originalIssuance?.rangeStart||sequence,endNumber:originalIssuance?.rangeEnd||sequence,currentGlobal:sequence-1,expiryDate:originalIssuance?.expiryDate||'2099-12-31',isActive:true};
  const allocation={id:originalIssuance?.fiscalAllocationId||'fixture-ecf-allocation',terminalId:s.scope.terminalId,fiscalRangeId:range.id,ncfType:'E32',prefix:'E32',reservedStart:originalIssuance?.allocationStart||sequence,reservedEnd:originalIssuance?.allocationEnd||sequence,nextNumber:sequence+1,status:'ACTIVE',releasedAt:null,metadata:{companyId:s.scope.companyId}};
  const buffer={id:'E32',type:'E32',prefix:'E32',currentNumber:sequence,startNumber:sequence,endNumber:sequence,expiryDate:range.expiryDate,terminalId:s.scope.terminalId,fiscalRangeId:range.id,allocationId:allocation.id};
  s.config.companyInfo={...s.config.companyInfo,rnc:seed.permit.issuerRnc};s.config.terminals[0].config.fiscal={mode:'ECF',enabled:true,fiscalRanges:[range],fiscalAllocations:[allocation]};
  const put=(c:string,row:any)=>s.f.db.prepare('INSERT OR REPLACE INTO documents VALUES(?,?,?,?,?)').run(c,row.id,JSON.stringify(row),0,'fixture');
  for(const [c,row] of [['config',s.config],['fiscalRanges',range],['fiscalAllocations',allocation],['localFiscalBuffer',buffer]] as const)put(c,row);
  const raw=(c:string,id:string)=>(s.f.db.prepare('SELECT data FROM documents WHERE collection_name=? AND doc_id=?').get(c,id) as any).data;
  const reservationsBefore=s.f.documents('nativeFiscalReservations').length;
  await s.adapter.reserveFinancialNumbers({global:false,fiscal:{terminalId:s.scope.terminalId,type:'E32',ncf,expectedConfig:raw('config','current'),expectedBuffer:raw('localFiscalBuffer','E32'),expectedAllocation:raw('fiscalAllocations',allocation.id),expectedRange:raw('fiscalRanges',range.id)}});
  const issuance=snapshotFiscalIssuance(s.config as any,range as any,allocation as any,buffer as any,ncf);
  const {created}=await create(s,{id:checkout.transactionId,fiscalWorkflowCheckoutId:checkout.checkoutId,fiscalMode:'ECF',fiscalProvider:'MSELLER',fiscalEnvironment:seed.permit.environment,ncf,ncfType:'E32',fiscalIssuance:issuance,settlementExchangeRate:1});
  if(seed.fault){const bridge=(s.adapter as any).db,run=bridge.run;bridge.run=async(q:string,v:any[],...rest:any[])=>{if(v?.[0]==='inventoryLedger')throw Error('INJECTED_FINANCIAL_FAILURE');return run(q,v,...rest);};await assert.rejects(appFor(s)(created),/INJECTED_FINANCIAL_FAILURE/);return {fault:true,sourceCount:s.f.documents('transactions').length,historyCount:s.f.documents('transactionHistory').length,eventCount:(s.f.db.prepare('SELECT count(*) n FROM sync_outbox_v2').get() as any).n,checkout:await store.readCheckout(checkout.checkoutId),permitState:(s.f.db.prepare('SELECT state FROM pos_fiscal_permits_v2').get() as any).state,reservationsBefore,reservationsAfter:s.f.documents('nativeFiscalReservations').length};}
  await appFor(s)(created);const source=s.f.documents('transactions')[0],history=s.f.documents('transactionHistory')[0];
  const events=()=>s.f.db.prepare('SELECT event_id,event_type,aggregate_id,payload_json,created_at FROM sync_outbox_v2 ORDER BY local_sequence').all() as any[];
  const firstEvents=events();await appFor(s)(created);assert.deepEqual(events(),firstEvents,'original financial commit replay');
  if(seed.statePath){assert.equal(existsSync(seed.statePath),false,'Refuse to overwrite a prior fixture');s.f.db.exec("CREATE TABLE qa_fiscal_producer_guard(marker TEXT NOT NULL);INSERT INTO qa_fiscal_producer_guard VALUES('ISOLATED_POS_WORKFLOW_PRODUCER_V1');");writeFileSync(seed.statePath,s.f.db.serialize(),{mode:0o600});}
  return {source,history,sourceSha256:createHash('sha256').update(JSON.stringify(source)).digest('hex'),statePath:seed.statePath,events:firstEvents.map(({payload_json,...rest}:any)=>({...rest,payload:JSON.parse(payload_json)})),checkout:await store.readCheckout(checkout.checkoutId),permitState:(s.f.db.prepare('SELECT state FROM pos_fiscal_permits_v2').get() as any).state,watch:await store.candidates(key,'',10),reservationsBefore,reservationsAfter:s.f.documents('nativeFiscalReservations').length,network,permitRequests};
 }finally{s.close();}
}

/** Install only synthetic catalog/authority fixtures supplied by the isolated PG runner.
 * Never copy the ERP fixture transaction ID, birth, fingerprint or already-built event payloads. */
async function configureSourceFixture(s:any,seed:any){
 const fixture=seed.sourceFixture,original=fixture.transaction,scope=seed.permit.scope,stamp=original.items[0].v3SaleAuthority;
 assert.equal(fixture.fixtureOnly,true);assert.equal(fixture.dispatchable,false);
 const g:any=globalThis,binding=stamp.binding,ready=fixture.syntheticCatalogInput.ready;
 Object.assign(s.scope,scope); // scenario scope is fixture-owned, never an operational identity.
 const config=s.config;Object.assign(config,fixture.syntheticCatalogInput.config);
 config.terminals[0]={id:scope.terminalId,config:{erpTerminalId:scope.terminalId,currentDeviceId:scope.deviceId,erpBinding:{...scope},pricing:{allowedTariffIds:[stamp.tariffId]},inventoryScope:{defaultSalesWarehouseId:fixture.warehouseId,defaultWarehouse:{id:fixture.warehouseId,erpWarehouseId:fixture.warehouseId,inventoryLocalId:scope.storeId}}}};
 const put=(c:string,row:any)=>s.f.db.prepare('INSERT OR REPLACE INTO documents VALUES(?,?,?,?,?)').run(c,row.id,JSON.stringify(row),0,'fixture');put('config',config);
 const auth=g.__qaPresentation.auth;Object.assign(auth,scope,{erpSyncBaseUrl:JSON.parse(binding)[3]});
 const baseline=JSON.stringify([binding,stamp.inventorySyncId||stamp.syncId,stamp.inventorySyncVersion??stamp.syncVersion,stamp.inventoryVersion,stamp.inventoryCursor]);
 s.f.db.prepare('UPDATE master_v3_state SET active_sync_id=?,active_version=? WHERE singleton=1').run(stamp.syncId,stamp.syncVersion);
 s.f.db.prepare('UPDATE master_v3_operational_owner SET binding=?,sync_id=?,sync_version=? WHERE singleton=1').run(binding,stamp.syncId,stamp.syncVersion);
 s.f.db.prepare('UPDATE master_v3_inventory_state SET sync_id=?,sync_version=?,inventory_version=?,cursor=? WHERE singleton=1').run(stamp.inventorySyncId||stamp.syncId,stamp.inventorySyncVersion??stamp.syncVersion,stamp.inventoryVersion,stamp.inventoryCursor);
 s.f.db.prepare('INSERT OR REPLACE INTO master_v3_catalog_owners(sync_id,sync_version,binding,inventory_sync_id,inventory_sync_version,inventory_version,inventory_cursor)VALUES(?,?,?,?,?,?,?)').run(stamp.syncId,stamp.syncVersion,binding,stamp.inventorySyncId||stamp.syncId,stamp.inventorySyncVersion??stamp.syncVersion,stamp.inventoryVersion,stamp.inventoryCursor);
 const balance=fixture.syntheticCatalogInput.balance;
 for(const line of original.items){
  s.f.db.prepare('INSERT OR REPLACE INTO master_v3_inventory_balances VALUES(?,?,?,?,?,?)').run(line.id,fixture.warehouseId,balance.qtyOnHand,balance.qtyReserved,balance.qtyCommitted,'fixture');
  s.f.db.prepare('INSERT OR REPLACE INTO master_v3_articles(sync_version,article_id,taxable,tax_ids_json,active,sellable,record_json)VALUES(?,?,?,?,?,?,?)').run(stamp.syncVersion,line.id,Number(line.taxable),JSON.stringify(line.appliedTaxIds),1,1,JSON.stringify({...line,inventoriable:line.isInventoriable,active:true,sellable:true,taxIds:line.appliedTaxIds}));
 }
 const {id:_id,displayId:_display,globalSequence:_global,seriesNumber:_series,v3Binding:_binding,v3WarehouseId:_warehouse,v3InventoryBaseline:_baseline,v3CommitFingerprint:_fingerprint,fiscalIssuance:_issuance,ncf:_ncf,electronicNcf:_electronic,fiscalWorkflowBirth:_birth,fiscalWorkflowCheckoutId:_checkout,inventoryPresentationContract:_presentationContract,...commercial}=original;
 s.transaction={...commercial,userId:'fixture-operator',userName:'Synthetic producer'};
 let presentationRuntime:any;
 if(original.items.some((line:any)=>line.inventoryPresentation!==undefined)){
  const context=fixture.presentationContext,master=fixture.presentationMaster;assert.ok(context&&master,'Authentic retained presentation context/master required');
  for(const key of ['tenantId','companyId','storeId','terminalId','deviceId'])assert.equal(context.scope[key],scope[key],'Presentation scope '+key);
  assert.equal(context.scope.warehouseId,fixture.warehouseId);assert.equal(master.contextRevision,context.contextRevision);
  config.terminals[0].config.inventoryScope.defaultWarehouse.inventoryLocalId=context.scope.localId;
  const authority={origin:new URL(JSON.parse(binding)[3]).origin,scope:context.scope,tariffIds:context.tariffIds,categories:context.categories};
  presentationRuntime=s.m.createPresentationRuntime(()=>authority,{sql:s.adapter.inventoryPresentationsSQL(),sessionId:randomUUID,fetchImpl:async(url:string)=>new Response(JSON.stringify(url.endsWith('/negotiate')?context:{schemaVersion:1,contract:'INVENTORY_PRESENTATIONS_V1',contextRevision:context.contextRevision,items:[master],checksum:await inventoryPresentationRevision([master]),nextAfter:null}),{headers:{'X-Clic-Inventory-Presentations':'1'}})});
  await presentationRuntime.client.prepare();
 }
 g.__qaPresentation.session={binding,ready,assertCurrent:async()=>{},projectConfig:async()=>config,presentationProof:async(_config:any,lines:any[])=>{assert.ok(presentationRuntime,'Presentation runtime required');return s.m.validatePresentationCart(presentationRuntime,lines);},validate:async(_config:any,lines:any[],_tariff:any,_warehouse:any,_intent:any,validated:any)=>{if(presentationRuntime)await s.m.validatePresentationCart(presentationRuntime,lines);for(const line of lines)validated?.(line,line);},stockRequirements:async(_config:any,lines:any[])=>{
  const quantities=new Map<string,number>();for(const line of lines)quantities.set(line.id,(quantities.get(line.id)||0)+s.m.presentationInventoryQuantity(line));
  return [...quantities].map(([productId,quantity])=>({baseline,productId,quantity,warehouseId:fixture.warehouseId,...(presentationRuntime?{quantityScale:4}:{})}));
 }};
 // App entry calls real writer with the configured warehouse; other boundaries stay fixture controlled.
 s.config.terminals[0].config.inventoryScope.defaultWarehouse={id:fixture.warehouseId,erpWarehouseId:fixture.warehouseId,inventoryLocalId:fixture.presentationContext?.scope.localId||scope.storeId};
}

/** Resume exactly the synthetic SQLite bytes exported by the producer; no reseeding or authority adoption. */
export async function consumeFiscalWorkflowStatus(statePath:string,dto:any,artifactPrefix?:string){
 process.env.CLIC_FISCAL_PRODUCER_EXPORT='1';const {actualModules}=await import('./inventoryPresentationsProducerWriter.test');
 const sql=new SQLite(statePath,{fileMustExist:true});let m:any;
 try{
  assert.equal((sql.prepare('SELECT marker FROM qa_fiscal_producer_guard').get() as any)?.marker,'ISOLATED_POS_WORKFLOW_PRODUCER_V1','Only isolated producer fixtures are allowed');
  m=await actualModules();const bridge={query:async(q:string,v:any[]=[])=>({values:sql.prepare(q).all(...v)}),run:async(q:string,v:any[]=[])=>({changes:sql.prepare(q).run(...v)}),execute:async(q:string)=>{sql.exec(q);}};
  const adapter=new m.CapacitorSQLiteAdapter();Object.assign(adapter,{db:bridge,isReady:true});
  const sourceRow=sql.prepare("SELECT data FROM documents WHERE collection_name='transactions' AND doc_id=?").get(dto.transactionId) as any;assert.ok(sourceRow,'Original producer source must exist');const source=JSON.parse(sourceRow.data),scope=dto.scope,binding=JSON.parse(source.v3Binding);
  const g:any=globalThis,auth={...scope,erpSyncBaseUrl:binding[3],syncToken:'QA-fixture-token',deviceToken:'QA-fixture-device',syncTokenExpiresAt:'2099-01-01',deviceTokenExpiresAt:'2020-01-01',authStatus:'AUTHENTICATED',deviceTokenSource:'ERP_REGISTER'};
  g.__qaPresentation={adapter,auth};let updatedEvents=0;g.window={dispatchEvent:(event:any)=>{if(event.type==='fiscalWorkflowUpdated')updatedEvents++;}};g.CustomEvent=class{constructor(public type:string,public detail:any){}};
  const context=m.captureFiscalStatusBoundContext();m.observeFiscalWorkflowCapability(context.base,context.headers,'2');let getCalls=0;
  const financial=()=>JSON.stringify({documents:sql.prepare("SELECT collection_name,doc_id,data FROM documents WHERE collection_name IN ('transactions','transactionHistory','inventoryLedger','nativeFiscalReservations','localFiscalBuffer','internalSequences','globalSequenceCounter') ORDER BY collection_name,doc_id").all(),outbox:sql.prepare('SELECT * FROM sync_outbox_v2 ORDER BY local_sequence').all()});
  const before=financial(),client=m.createFiscalWorkflowV2Client({store:()=>adapter.fiscalWorkflowStore,readSource:async(id:string)=>adapter.getDocument('transactions',id),readAuth:()=>context,fetchImpl:async(url:string,options:any)=>{assert.equal(options.method,'GET');assert.match(url,/fiscal\/workflow\/v2\/status\?/);getCalls++;return {ok:true,json:async()=>dto};}});
  const state=await client.consult(source.id);const display=await m.resolveFiscalPrintDisplay(source),acceptance=await m.resolveFiscalAcceptance(source),config=await adapter.getDocument('config','current');
  const escPosBase64=m.buildEscPosTicketPayload(source,config,[],display),email=m.buildReceiptEmailPayload(source,'fixture@example.invalid',config,'RD$',[],display,acceptance),svg=display?await fiscalQrSvg(display.qrUrl):null;
  assert.equal(financial(),before,'Status must preserve source/history/money/NCF/stock/outbox bytes');
  if(artifactPrefix){if(escPosBase64)writeFileSync(artifactPrefix+'.bin',Buffer.from(escPosBase64,'base64'),{mode:0o600});if(svg)writeFileSync(artifactPrefix+'.svg',svg,{mode:0o600});}
  return {state,display:display||null,acceptance:acceptance||null,escPosBase64,email,svg,getCalls,issueCalls:0,updatedEvents,sourceBeforeSha256:createHash('sha256').update(before).digest('hex'),sourceAfterSha256:createHash('sha256').update(financial()).digest('hex'),cached:await adapter.fiscalWorkflowStore.readState(source.id),artifactPrefix};
 }finally{sql.close();m?.clearFiscalWorkflowCapability();m?.dispose();delete (globalThis as any).__qaPresentation;}
}
