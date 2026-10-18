import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext, Script} from 'node:vm';
import ts from 'typescript';
import {assertNewFiscalIssuer, fiscalIssuerRnc, snapshotFiscalIssuance, assertFiscalIssuance} from '../utils/fiscalIssuance';
import {db} from '../utils/db';
import {dbAdapter} from '../services/db';
import {nativeFixture,seedNativeFiscal,id} from './articleFormatsNativeFixture';
const invalid=[undefined,'','  ','123','abc130090752','130/090752','1234567890'];
const business=(rnc:unknown)=>({companyInfo:{rnc}} as any);
function evaluate(source:string,bindings:Record<string,unknown>){
 const context=createContext({Error,...bindings});
 new Script(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText).runInContext(context);
 return context;
}
for(const rnc of invalid)test(`new E issuer rejects ${JSON.stringify(rnc)} without modifying input`,()=>{
 const value=business(rnc),before=JSON.stringify(value);
 assert.equal(fiscalIssuerRnc(value),undefined);
 for(const type of ['E31','E32','E34','E44','E45'])assert.throws(()=>assertNewFiscalIssuer(value,type),/FISCAL_ISSUER_RNC_REQUIRED/);
 assert.doesNotThrow(()=>assertNewFiscalIssuer(value,'B02'));
 assert.equal(JSON.stringify(value),before);
});
test('one parser accepts established formatted9/11 digits and historical structural snapshots remain readable',()=>{
 for(const [rnc,expected]of [['130-09075-2','130090752'],['001.123456 7 8','00112345678']]){
  assert.equal(fiscalIssuerRnc(business(rnc)),expected);assert.doesNotThrow(()=>assertNewFiscalIssuer(business(rnc),'E32'));
 }
 const range:any={id:'range',startNumber:1,endNumber:5};
 const allocation:any={id:'allocation',fiscalRangeId:'range',reservedStart:1,reservedEnd:5};
 const buffer:any={type:'E32',prefix:'E32',currentNumber:1,fiscalRangeId:'range',allocationId:'allocation',terminalId:'terminal'};
 assert.throws(()=>snapshotFiscalIssuance(business('bad'),range,allocation,buffer,'E320000000001'),/ISSUER_RNC/);
 const frozen=snapshotFiscalIssuance(business('130090752'),range,allocation,buffer,'E320000000001');
 const historical:any={ncf:frozen.ncf,ncfType:'E32',fiscalIssuance:{...frozen,issuerRnc:null}};
 const before=JSON.stringify(historical);assert.doesNotThrow(()=>assertFiscalIssuance(historical));assert.equal(JSON.stringify(historical),before);
 const legacy=snapshotFiscalIssuance(business(undefined),range,allocation,{...buffer,type:'B02',prefix:'B02'},'B0200000001');
 assert.equal(legacy.issuerRnc,null);
});

test('reservation and direct batch reject invalid persisted issuer before missing, exhausted or stale buffer writes',async()=>{
 const get=dbAdapter.getCollection,save=dbAdapter.saveCollection;
 let writes=0;const config=business('bad');
 try{
  for(const buffer of [[],[{id:'E32',currentNumber:99,endNumber:1}],[{id:'E32',allocationId:'stale'}]]){
   (dbAdapter as any).getCollection=async(name:string)=>name==='config'?[config]:name==='localFiscalBuffer'?buffer:[];
   (dbAdapter as any).saveCollection=async()=>{writes++;};
   await assert.rejects(()=>db.reserveFiscalNumber('E32','terminal'),/ISSUER_RNC/);
   await assert.rejects(()=>db.requestFiscalBatch('terminal','E32',1),/ISSUER_RNC/);
  }
  assert.equal(writes,0);
  config.companyInfo.rnc='130090752';await db.assertFiscalIssuerAuthority('E32');
  config.companyInfo.rnc='';await assert.rejects(()=>db.assertFiscalIssuerAuthority('E32'),/ISSUER_RNC/);
  await db.assertFiscalIssuerAuthority('B02');
 }finally{dbAdapter.getCollection=get;dbAdapter.saveCollection=save;}
});

test('manual add validates before changing payment or input and retains a previously authorized tender',async()=>{
 const source=readFileSync(new URL('../components/PaymentModal.tsx',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('   const handleAddPayment ='),source.indexOf('   const handleRemovePayment ='));
 let changes=0,builds=0,checks=0;let error='';
 const approved=[{id:'approved',gatewayStatus:'APPROVED',amount:10}];const before=JSON.stringify(approved);
 const context=evaluate(body+'\nglobalThis.add=handleAddPayment;',{
  inputAmount:'25',roundPaymentAmountByMethod:(n:number)=>n,activeForeignCurrencyRounding:null,
  selectedCurrency:{code:'DOP',rate:1},baseCurrency:{code:'DOP'},activePaymentMethod:{type:'CASH'},activeIsCxCCredit:false,
  activeRequiresOnline:false,isOnline:false,isMaster:true,roundToTwo:(n:number)=>n,
  validatePaymentAuthority:async()=>{checks++;throw Error('FISCAL_ISSUER_RNC_REQUIRED');},
  setFinalizeError:(e:string)=>{error=e;},buildPaymentEntry:()=>{builds++;return {};},
  setPayments:()=>{changes++;},setInputAmount:()=>{changes++;},setShouldClearInput:()=>{changes++;},
 });
 await Promise.all([context.add(),context.add()]);
 assert.equal(checks,2);assert.equal(changes,0);assert.equal(builds,0);assert.match(error,/ISSUER_RNC/);assert.equal(JSON.stringify(approved),before);
});

test('fresh issuer loss blocks typed finalization before payment entry, provider, confirmation or output',async()=>{
 const source=readFileSync(new URL('../components/PaymentModal.tsx',import.meta.url),'utf8');
 const start=source.indexOf('   const handleFinalize =');
 const end=source.indexOf('\n   const ',start+10);
 let effects=0,error='';
 const context=evaluate(source.slice(start,end)+'\nglobalThis.finalize=handleFinalize;',{
  recordCheckoutDiagnostic:()=>{},items:[],total:25,payments:[],isFinalizing:false,isProcessingGateway:false,
  canFinalize:true,isCreditActionBlocked:false,beginPosInteraction:()=>({stages:{}}),expectInteractionRender:()=>{},
  setFinalizeError:(e:string)=>{error=e;},setSuccessNotice:()=>{},setGatewayProgress:()=>{},setIsFinalizing:()=>{},markInteractionStateUpdate:()=>{},
  beforePaymentEffects:async()=>{throw Error('FISCAL_ISSUER_RNC_REQUIRED');},
  markInteractionStage:()=>{},completePosInteraction:()=>{},cancelPosInteraction:()=>{},failPosInteraction:()=>{},
  workflowPaymentFenceRef:{current:null},onConfirm:()=>{effects++;},buildPaymentEntry:()=>{effects++;},
 });
 await context.finalize();assert.equal(effects,0);assert.match(error,/ISSUER_RNC/);
});

async function electronic(){
 const f=await nativeFixture();const seed=seedNativeFiscal(f);
 const range={...seed.range,type:'E32',prefix:'E32'},allocation={...seed.allocation,ncfType:'E32',prefix:'E32'};
 const buffer={...seed.buffer,id:'E32',type:'E32',prefix:'E32'};
 const config=structuredClone(seed.config);config.terminals[0].config.fiscal={mode:'ECF',enabled:true,fiscalRanges:[range],fiscalAllocations:[allocation]};
 const put=(name:string,row:any)=>f.db.prepare('INSERT OR REPLACE INTO documents VALUES(?,?,?,?,?)').run(name,row.id,JSON.stringify(row),0,'fixture');
 for(const [name,row]of [['config',config],['fiscalRanges',range],['fiscalAllocations',allocation],['localFiscalBuffer',buffer]] as const)put(name,row);
 const raw=(name:string,key:string)=>(f.db.prepare('SELECT data FROM documents WHERE collection_name=? AND doc_id=?').get(name,key) as any).data;
 const input=()=>({global:true,seriesId:id(9),fiscal:{terminalId:id(4),type:'E32' as const,ncf:'E320000000001',expectedConfig:raw('config','current'),expectedBuffer:raw('localFiscalBuffer','E32'),expectedAllocation:raw('fiscalAllocations',allocation.id),expectedRange:raw('fiscalRanges',range.id)}});
 return {...f,config,put,input};
}
test('direct native E reservation invalid issuer and stale CAS consume no receipt, global, series or fiscal counter',async()=>{
 const f=await electronic();try{
  for(const rnc of invalid){
   f.config.companyInfo.rnc=rnc;f.put('config',f.config);const before=f.state();
   await assert.rejects(()=>f.adapter.reserveFinancialNumbers(f.input()),/NATIVE_FISCAL_ISSUER_UNPROVEN/);
   assert.deepEqual(f.state(),before);
  }
  f.config.companyInfo.rnc='130090752';f.put('config',f.config);const old=f.input();
  f.config.companyInfo.rnc='';f.put('config',f.config);const before=f.state();
  await assert.rejects(()=>f.adapter.reserveFinancialNumbers(old),/NATIVE_FISCAL_AUTHORITY_CONFLICT/);assert.deepEqual(f.state(),before);
 }finally{f.db.close();}
});
test('valid offline native E repeated click has one receipt and one increment; legacy issuer optional remains compatible',async()=>{
 const f=await electronic();try{
  const input=f.input(),results=await Promise.allSettled([f.adapter.reserveFinancialNumbers(input),f.adapter.reserveFinancialNumbers(input)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.documents('nativeFiscalReservations').length,1);
  assert.equal(f.documents('globalSequenceCounter')[0].count,1);assert.equal(f.documents('internalSequences').find((r:any)=>r.id===id(9)).nextNumber,2);
 }finally{f.db.close();}
});

test('checkout reads persisted issuer each time, including refunds, while explicit NONE/order-taker stays offline',async()=>{
 const source=readFileSync(new URL('../components/POSInterface.tsx',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('   const assertCheckoutFiscalAuthority ='),source.indexOf('   const fiscalCheckoutRef='));
 const get=dbAdapter.getCollection;let lotChecks=0;let rnc='130090752';
 try{
  (dbAdapter as any).getCollection=async()=>[business(rnc)];
  const context=evaluate(body+'\nglobalThis.check=assertCheckoutFiscalAuthority;',{
   db:{assertFiscalIssuerAuthority:db.assertFiscalIssuerAuthority,canRequestMoreNCF:async()=>{lotChecks++;return true;}},
   isOrderTakerMode:false,isFiscalModeDisabled:false,activeTerminalConfig:{fiscal:{mode:'ECF'}},terminalId:'terminal',
   processedCart:[{quantity:1}],requiredSaleFiscalType:'E32',resolveCreditNoteFiscalCode:()=> 'E34',
   fiscalCompliance:{mode:'ECF'},isTerminalFiscalReceiptRequired:(c:any)=>c.fiscal.mode!=='NONE',
  });
  await context.check();assert.equal(lotChecks,1);rnc='';
  for(const quantity of [1,-1]){context.processedCart=[{quantity}];await assert.rejects(()=>context.check(),/ISSUER_RNC/);}
  assert.equal(lotChecks,1);
  context.isFiscalModeDisabled=true;context.activeTerminalConfig.fiscal.mode='NONE';await context.check();
  context.isFiscalModeDisabled=false;context.isOrderTakerMode=true;await context.check();
 }finally{dbAdapter.getCollection=get;}
});

test('real Kiosk callback denies mandatory fiscal before provider, and nonfiscal retains existing provider route',async()=>{
 const source=readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
 const ast=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let arrow:ts.ArrowFunction|undefined;
 const visit=(node:ts.Node)=>{
  if(ts.isArrowFunction(node)&&node.body.getText(ast).startsWith('{\n              console.log(`Payment completed with'))arrow=node;
  ts.forEachChild(node,visit);
 };visit(ast);assert.ok(arrow);
 const get=dbAdapter.getCollection;let calls=0;const terminal:any={id:'kiosk',config:{fiscal:{mode:'ECF'}}};
 try{
  (dbAdapter as any).getCollection=async()=>[{terminals:[terminal]}];
  const context=evaluate('globalThis.pay='+arrow!.getText(ast)+';',{
   console:{log:()=>{},error:()=>{}},db,kioskTerminal:terminal,currentUser:{id:'user',name:'User'},users:[],
   kioskPaymentRestaurantMode:false,selectedCustomer:null,kioskTotals:{subtotal:10,tax:0,total:10},
   config:{currencies:[{isBase:true,code:'DOP'}],paymentMethods:[{id:'card',type:'CARD',integrationMode:'INTEGRATED',integrationId:'azul'}],integrations:[{id:'azul',provider:'AZUL'}]},
   internalSequences:[],mergeDocumentSeriesCollection:(a:any)=>a,resolveDocumentAssignmentId:()=> 'series',
   createKioskGatewayOrderNumber:()=> 'order',azulMcmService:{sale:async()=>{calls++;throw Error('provider-boundary');}},
  });
  await assert.rejects(()=>context.pay({id:'card',type:'CARD',label:'Card'}),/FISCAL_TERMINAL_AUTHORITY_REQUIRED/);assert.equal(calls,0);
  terminal.config.fiscal.mode='NONE';await assert.rejects(()=>context.pay({id:'card',type:'CARD',label:'Card'}),/provider-boundary/);assert.equal(calls,1);
 }finally{dbAdapter.getCollection=get;}
});
