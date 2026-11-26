import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveFiscalPrintDisplay,validateDgiiPrintEvidence,fiscalCivilDate} from '../services/fiscal/FiscalPrintEvidence';
import {fiscalStatusSourceChecksum,verifyFiscalStatusProof} from '../services/fiscal/FiscalStatusProof';
import {buildEscPosTicketPayload} from '../services/printer/EscPosFormatter';
import {buildReceiptEmailPayload} from '../services/email/receiptEmailPayload';
async function fixture(){
 const binding=JSON.stringify(['tenant','terminal','device','https://erp.invalid','https://erp.invalid']);
 const tx:any={id:'original',date:'2026-10-16T03:30:00Z',terminalId:'terminal',ncf:'E3200001021',electronicNcf:'E3200001021',ncfType:'E32',
  fiscalProvider:'MSELLER',fiscalSyncStatus:'PENDING',v3Binding:binding,v3InventoryBaseline:JSON.stringify([binding,'S',1,1,'C']),
  items:[{id:'P',cartId:'P',name:'Water',quantity:1,price:352,netAmount:352,taxAmount:0,totalAmount:352,v3SaleAuthority:{binding}}],
  payments:[{method:'CASH',amount:352}],total:352,netAmount:352,taxAmount:0};
 const scope:any={basis:'PERSISTED_SUBMISSION_INTENT',providerId:'MSELLER',environment:0,issuerRnc:'130090752',tenantId:'tenant',companyId:'company',terminalId:'terminal',deviceId:'device',storeId:'store',binding,
  sourceChecksum:await fiscalStatusSourceChecksum(tx),capturedAt:'2026-10-16T03:30:00Z'};tx.fiscalSubmissionScope=scope;
 const proof:any={schemaVersion:1,source:'ERP_SCOPED_PROVIDER_ISSUE',scope:{tenantId:'tenant',companyId:'company',terminalId:'terminal',deviceId:'device',storeId:'store'},
  document:{erpDocumentId:'erp-original',sourceTransactionId:tx.id,ncf:'E320000001021',ncfType:'E32',sourceChecksum:scope.sourceChecksum,total:352},
  issuer:{rnc:'130090752',providerId:'MSELLER',environment:0,credentialCompanyId:'company',credentialAccountRnc:'130090752'},
  environmentBasis:scope.basis,historicalEnvironment:null,lookup:{requestedNcf:tx.ncf},decision:'PENDING',observedAt:'2026-10-16T03:31:00Z',
  providerReceipt:{returnedNcf:'E320000001021',internalTrackId:'actual-track',status:'Validado',success:true,pending:true,invoiceTotal:352,
   printEvidence:{schemaVersion:1,qrUrl:'https://fc.dgii.gov.do/testecf/consultatimbrefc?RNCEmisor=130090752&ENCF=E320000001021&MontoTotal=352.00&CodigoSeguridad=NVrTbH',securityCode:'NVrTbH',signedAt:'15-10-2026 23:30:53'}}};
 tx.fiscalPrintProof=proof;return{tx,proof,scope};
}
test('authentic signed pending proof prints without falsely accepting or changing historical ncf; distinct internal QR remains',async()=>{
 const f=await fixture(),before=JSON.stringify(f.tx),display=await resolveFiscalPrintDisplay(f.tx);assert.ok(display);
 assert.equal(await verifyFiscalStatusProof(f.proof,f.scope,f.tx),false);assert.equal(display.qrUrl,f.proof.providerReceipt.printEvidence.qrUrl);
 const config:any={currencySymbol:'RD$',taxRate:0,taxes:[],receiptConfig:{showQr:true},companyInfo:{name:'Synthetic'},currencies:[]};
 const payload=Buffer.from(buildEscPosTicketPayload(f.tx,config,[],display)!,'base64').toString('utf8');
 assert.match(payload,/NVrTbH/);assert.match(payload,/15-10-2026 23:30:53/);assert.match(payload,/consultatimbrefc/);assert.match(payload,/DEVOLUCIONES/);
 const email:any=buildReceiptEmailPayload(f.tx,'fixture@example.invalid',config,'RD$',[],display);
 assert.equal(email.fiscalPrintEvidence.qrUrl,display.qrUrl);assert.equal(email.fiscalValidated,false);assert.equal(JSON.stringify(f.tx),before);
 assert.equal((buildReceiptEmailPayload(f.tx,'fixture@example.invalid',config,'RD$',[],{...display}) as any).fiscalPrintEvidence,undefined);
});
for(const [name,change] of Object.entries({host:'https://fc.dgii.gov.do.evil.invalid/testecf/consultatimbrefc',environment:'https://fc.dgii.gov.do/ecf/consultatimbrefc',scheme:'javascript:alert(1)',duplicate:'&MontoTotal=352.00',security:'&unexpected=1'}))test(`DGII print rejects ${name}`,async()=>{
 const f=await fixture(),evidence=f.proof.providerReceipt.printEvidence;
 evidence.qrUrl=name==='duplicate'||name==='security'?evidence.qrUrl+change:change+'?'+evidence.qrUrl.split('?')[1];
 assert.equal(await resolveFiscalPrintDisplay(f.tx),undefined);
});
test('print rejects foreign amount, changed financial source, wrong scope, absent signed evidence and forged plain fields',async()=>{
 for(const change of [(f:any)=>{f.proof.providerReceipt.invoiceTotal=353;},(f:any)=>{f.tx.items[0].price=1;},(f:any)=>{f.proof.scope.companyId='other';},
  (f:any)=>{delete f.proof.providerReceipt.printEvidence;},(f:any)=>{delete f.tx.fiscalPrintProof;f.tx.fiscalQrUrl='https://fc.dgii.gov.do';f.tx.fiscalSecurityCode='NVrTbH';}]){
  const f=await fixture();change(f);assert.equal(await resolveFiscalPrintDisplay(f.tx),undefined);
 }
});
test('general QR uses frozen Dominican civil date across UTC midnight and exact provider signature text',async()=>{
 const f=await fixture();f.tx.ncf=f.tx.electronicNcf='E310000001021';f.tx.ncfType='E31';f.tx.customerSnapshot={taxId:'101010101'};
 f.scope.sourceChecksum=await fiscalStatusSourceChecksum(f.tx);f.proof.document.ncf=f.proof.providerReceipt.returnedNcf=f.proof.lookup.requestedNcf=f.tx.ncf;
 f.proof.document.ncfType='E31';f.proof.document.sourceChecksum=f.scope.sourceChecksum;
 f.proof.providerReceipt.printEvidence.qrUrl='https://ecf.dgii.gov.do/testecf/ConsultaTimbre?RncEmisor=130090752&RncComprador=101010101&ENCF=E310000001021&FechaEmision=15-10-2026&MontoTotal=352.00&FechaFirma=15-10-2026%2023%3A30%3A53&CodigoSeguridad=NVrTbH';
 assert.equal(fiscalCivilDate(f.tx.date),'15-10-2026');assert.ok(await resolveFiscalPrintDisplay(f.tx));
 f.proof.providerReceipt.printEvidence.qrUrl=f.proof.providerReceipt.printEvidence.qrUrl.replace('FechaEmision=15','FechaEmision=16');assert.equal(validateDgiiPrintEvidence(f.proof,f.tx),undefined);
});

test('email accepts only verified acceptance state; stale SYNCED plus signed PENDING remains unaccepted',async()=>{
 const f=await fixture();f.tx.fiscalSyncStatus='SYNCED';let display=await resolveFiscalPrintDisplay(f.tx);assert.ok(display);
 let email:any=buildReceiptEmailPayload(f.tx,'fixture@example.invalid',undefined,'RD$',[],display);
 assert.equal(email.fiscalValidated,false);assert.equal(email.fiscalPrintEvidence.dgiiAccepted,false);
 f.proof.source='ERP_SCOPED_PROVIDER_GET';f.proof.decision='ACCEPTED';f.proof.providerReceipt.status='DGIIAceptado';f.proof.providerReceipt.pending=false;
 display=await resolveFiscalPrintDisplay(f.tx);email=buildReceiptEmailPayload(f.tx,'fixture@example.invalid',undefined,'RD$',[],display);
 assert.equal(email.fiscalValidated,true);assert.equal(email.fiscalPrintEvidence.dgiiAccepted,true);
});

test('verified accepted proof without RI still validates email; unsigned sync status never does',async()=>{
 const {resolveFiscalAcceptance}=await import('../services/fiscal/FiscalPrintEvidence');
 const f=await fixture();f.proof.source='ERP_SCOPED_PROVIDER_GET';f.proof.decision='ACCEPTED';f.proof.providerReceipt.status='DGIIAceptado';f.proof.providerReceipt.pending=false;
 delete f.proof.providerReceipt.printEvidence;f.tx.fiscalStatusProof=f.proof;delete f.tx.fiscalPrintProof;
 assert.equal(await resolveFiscalPrintDisplay(f.tx),undefined);const acceptance=await resolveFiscalAcceptance(f.tx);assert.ok(acceptance);
 const email:any=buildReceiptEmailPayload(f.tx,'fixture@example.invalid',undefined,'RD$',[],undefined,acceptance);
 assert.equal(email.fiscalValidated,true);assert.equal(email.fiscalPrintEvidence,undefined);
 const forged:any=buildReceiptEmailPayload(f.tx,'fixture@example.invalid',undefined,'RD$',[],undefined,{...acceptance});assert.equal(forged.fiscalValidated,false);
});

test('actual TicketHistory email refreshes archived persisted proof after approval instead of mailing selected stale snapshot',async()=>{
 const {readFileSync}=await import('node:fs'),{transform}=await import('esbuild');
 const source=readFileSync(new URL('../components/TicketHistory.tsx',import.meta.url),'utf8');
 const segment=source.slice(source.indexOf('   const handleSendInvoiceEmail ='),source.indexOf('   const handleFlagInvoiceForReview ='));
 const code=(await transform(segment,{loader:'ts'})).code;
 const f=await fixture(),stale={...f.tx};delete stale.fiscalPrintProof;let sent:any;const reads:string[]=[];
 const {resolveFiscalAcceptance}=await import('../services/fiscal/FiscalPrintEvidence');
 const call=new Function('f',`const {requireCurrentUser,requestApproval,db,config,users,requestReceiptEmail,recordInvoiceAuditEvent}=f;${code};return handleSendInvoiceEmail;`)({
  requireCurrentUser:()=>({id:'actor'}),requestApproval:async()=>true,db:{getDocument:async(collection:string)=>{reads.push(collection);return collection==='transactionHistory'?{...f.tx,zReportId:'Z'}:null;}},config:{currencySymbol:'RD$'},users:[],
  requestReceiptEmail:async(tx:any,email:string,config:any,currency:string,users:any[])=>{sent=buildReceiptEmailPayload(tx,email,config,currency,users,await resolveFiscalPrintDisplay(tx),await resolveFiscalAcceptance(tx));return{success:true};},recordInvoiceAuditEvent:async()=>{},
 });
 await call(stale,'fixture@example.invalid');assert.deepEqual(reads,['transactions','transactionHistory']);assert.equal(sent.fiscalPrintEvidence.qrUrl,f.proof.providerReceipt.printEvidence.qrUrl);assert.equal(sent.fiscalValidated,false);
});

async function workflowFixture({ id = 'original', terminalId = 'terminal', ncfType = 'E31' } = {}){
 const f=await fixture();delete f.tx.fiscalPrintProof;delete f.tx.fiscalSubmissionScope;
 const ncf = ncfType + '0000001021';
 Object.assign(f.tx,{id,terminalId,ncf,electronicNcf:ncf,ncfType,customerSnapshot:{name:'Original incorrecto',taxId:'BAD'},currency:'DOP',fiscalEnvironment:0,fiscalIssuance:{issuerRnc:'130090752',tenantId:'tenant',companyId:'company',terminalId}});
 if (ncfType === 'E32') f.tx.fiscalWorkflowCheckoutId = 'f46987a5-d8d9-45dc-a167-8b01f0b91d89';
 const envelope={transaction:JSON.parse(JSON.stringify(f.tx))};
 const scope={tenantId:'tenant',companyId:'company',storeId:'store',terminalId,deviceId:'device'};
 const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
 const {sha256Utf8}=await import('../services/sync/LargeMasterSyncV3Client');
 const qrUrl = ncfType === 'E32' ? f.proof.providerReceipt.printEvidence.qrUrl :
  'https://ecf.dgii.gov.do/testecf/ConsultaTimbre?RncEmisor=130090752&RncComprador=101010101&ENCF=E310000001021&FechaEmision=15-10-2026&MontoTotal=352.00&FechaFirma=15-10-2026%2023%3A30%3A53&CodigoSeguridad=NVrTbH';
 const state:any={schemaVersion:2,source:'ERP_POS_FISCAL_WORKFLOW_V2',mode:'WORKFLOW',transactionId:f.tx.id,workflowId:'permit',permitId:'permit',scope,issuerRnc:'130090752',environment:0,ncf,ncfType,currency:'DOP',exchangeRate:1,total:352,saleEventId:'event',originalSourceEnvelope:envelope,originalDigestV2:await sha256Utf8(JSON.stringify(canonical({schemaVersion:2,source:'POS_ORIGINAL_ENVELOPE_V2',scope,saleEventId:'event',payload:envelope}))),checksumV1:await fiscalStatusSourceChecksum(f.tx),observationVersion:3,draftRevision:1,decision:'ACCEPTED_CONDITIONAL',state:'ACCEPTED_CONDITIONAL',buyer:{name:'Comprador fiscal efectivo',taxId:'101010101'},canCorrect:false,observedAt:'2026-10-18T03:31:00Z',history:[],signature:{schemaVersion:1,qrUrl,securityCode:'NVrTbH',signedAt:'15-10-2026 23:30:53'}};
 return {tx:f.tx,state};
}
test('V2 verified corrected buyer reaches QR, ESC/POS and email without rewriting retained original; conditional is explicit',async()=>{
 const {fiscalWorkflowV2Client}=await import('../services/fiscal/FiscalWorkflowV2Client'),{fiscalPrintTransaction,resolveFiscalAcceptance}=await import('../services/fiscal/FiscalPrintEvidence');
 const f=await workflowFixture(),old=fiscalWorkflowV2Client.cached,before=JSON.stringify(f.tx);fiscalWorkflowV2Client.cached=async()=>f.state;
 try{const display=await resolveFiscalPrintDisplay(f.tx);assert.ok(display);assert.equal(display.dgiiConditional,true);assert.equal(display.effectiveBuyer?.taxId,'101010101');assert.equal(fiscalPrintTransaction(f.tx,display).customerSnapshot?.name,'Comprador fiscal efectivo');
 const config:any={currencySymbol:'RD$',taxRate:0,taxes:[],receiptConfig:{showQr:true},companyInfo:{name:'Synthetic'},currencies:[]};const esc=Buffer.from(buildEscPosTicketPayload(f.tx,config,[],display)!,'base64').toString('utf8');assert.match(esc,/Comprador fiscal efectivo/);assert.match(esc,/101010101/);assert.match(esc,/Aceptado condicionalmente/);assert.doesNotMatch(esc,/Original incorrecto/);
 const email:any=buildReceiptEmailPayload(f.tx,'fixture@example.invalid',config,'RD$',[],display,await resolveFiscalAcceptance(f.tx));assert.equal(email.customerName,'Comprador fiscal efectivo');assert.equal(email.customerTaxId,'101010101');assert.equal(email.fiscalValidated,true);assert.equal(JSON.stringify(f.tx),before);
 f.state.signature.qrUrl=f.state.signature.qrUrl.replace('RncComprador=101010101','RncComprador=999999999');assert.equal(await resolveFiscalPrintDisplay(f.tx),undefined);
 }finally{fiscalWorkflowV2Client.cached=old;}
});
test('print readiness deadline remains bounded when transport ignores cancellation; original stays unchanged',async()=>{
 const {fiscalWorkflowV2Client}=await import('../services/fiscal/FiscalWorkflowV2Client'),{resolveFiscalPrintReadiness}=await import('../services/fiscal/FiscalPrintEvidence');const f=await workflowFixture(),before=JSON.stringify(f.tx),old=fiscalWorkflowV2Client.cached,oldConsult=fiscalWorkflowV2Client.consult,oldEnabled=fiscalWorkflowV2Client.enabled;
 fiscalWorkflowV2Client.enabled=()=>true;fiscalWorkflowV2Client.cached=async()=>null;fiscalWorkflowV2Client.consult=()=>new Promise(()=>{});
 try{const start=Date.now();assert.equal(await resolveFiscalPrintReadiness(f.tx,{timeoutMs:25}),undefined);assert.ok(Date.now()-start<250);assert.equal(JSON.stringify(f.tx),before);}finally{fiscalWorkflowV2Client.cached=old;fiscalWorkflowV2Client.consult=oldConsult;fiscalWorkflowV2Client.enabled=oldEnabled;}
});

test('OFF print readiness and email preserve V1 proof and never consult a V2 endpoint',async()=>{const {fiscalWorkflowV2Client}=await import('../services/fiscal/FiscalWorkflowV2Client'),{resolveFiscalPrintReadiness}=await import('../services/fiscal/FiscalPrintEvidence');const old=fiscalWorkflowV2Client.consult,oldEnabled=fiscalWorkflowV2Client.enabled;let network=0;fiscalWorkflowV2Client.enabled=()=>false;fiscalWorkflowV2Client.consult=async()=>{network++;throw Error('V2_FORBIDDEN');};try{const f=await fixture(),signed=await resolveFiscalPrintReadiness(f.tx);assert.ok(signed);delete f.tx.fiscalPrintProof;const start=Date.now();assert.equal(await resolveFiscalPrintReadiness(f.tx),undefined);assert.ok(Date.now()-start<100);assert.equal((buildReceiptEmailPayload(f.tx,'fixture@example.invalid',{currencySymbol:'RD$',taxRate:0,taxes:[],receiptConfig:{showQr:true},companyInfo:{name:'Synthetic'},currencies:[]} as any,'RD$') as any).fiscalPrintEvidence,undefined);assert.equal(network,0);}finally{fiscalWorkflowV2Client.consult=old;fiscalWorkflowV2Client.enabled=oldEnabled;}});
test('retained format tax rows without a display name print safely without mutating the original',async()=>{const f=await fixture();f.tx.taxBreakdown=[{taxId:'vat',type:'VAT',rate:.18,amount:99,taxableBase:550},{taxId:'service',type:'SERVICE_CHARGE',rate:.1,amount:55,taxableBase:550}];const before=JSON.stringify(f.tx),config:any={currencySymbol:'RD$',taxRate:0,taxes:[],receiptConfig:{showQr:true},companyInfo:{name:'Synthetic'},currencies:[]};const text=Buffer.from(buildEscPosTicketPayload(f.tx,config,[])!,'base64').toString('utf8');assert.match(text,/ITBIS 18%/);assert.match(text,/Servicio 10%/);assert.equal(JSON.stringify(f.tx),before);});

async function optedInPrintFixture(t: import('node:test').TestContext) {
 const { tx, state } = await workflowFixture({
  id: 'a527e8c3-152a-4731-a6da-806bf2f40a55', terminalId: 'b0e720c2-9af1-4160-8582-a2e36a145eba', ncfType: 'E32',
 });
 const binding = { tenantId: 'tenant', storeId: 'store', terminalId: tx.terminalId };
 const storage = new Map([
  ['clic_erp_sync_tenant_id', binding.tenantId], ['clic_erp_sync_store_id', binding.storeId],
  ['clic_erp_sync_terminal_id', binding.terminalId], ['CLIC_POS_DEVICE_ID', 'device'],
 ]);
 const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
 Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null } });
 t.after(() => oldStorage
  ? Object.defineProperty(globalThis, 'localStorage', oldStorage)
  : Reflect.deleteProperty(globalThis, 'localStorage'));

 const config: any = { currencySymbol: 'RD$', companyInfo: { name: 'Synthetic' }, taxes: [], currencies: [],
  receiptConfig: { showQr: true }, terminals: [{ id: tx.terminalId, config: { msellerRealtimePrintEnabled: true, currentDeviceId: 'device' } }] };
 return { tx, state, binding, config };
}

test('opted-in ticket waits beyond the legacy budget, ignores foreign hints and prints once from authenticated V2 evidence', { timeout: 3000 }, async t => {
 const { printTicket } = await import('../utils/printer');
 const { fiscalWorkflowV2Client } = await import('../services/fiscal/FiscalWorkflowV2Client');
 const { receiveFiscalPrintHint } = await import('../services/fiscal/FiscalPrintHint');
 const { PrintRouterService } = await import('../services/printer/PrintRouterService');
 const { dbAdapter } = await import('../services/db');
 const { reserveLargeMasterSyncV3BaselineMutation } = await import('../services/sync/LargeMasterSyncV3OperationGate');
 const { tx, state, binding, config } = await optedInPrintFixture(t);
 let cached = { ...state, state: 'AWAITING_APPLICATION', decision: 'PENDING', signature: null };
 const signed = { ...cached, state: 'SIGNED_PENDING', signature: state.signature };
 let nextStatus = cached;
 const jobs: string[] = [];
 const flush = () => new Promise(resolve => setImmediate(resolve));
 let startConsult!: () => void;
 const started = new Promise<void>(resolve => { startConsult = resolve; });
 const stale = { ...tx, fiscalWorkflowCheckoutId: undefined };
 t.mock.method(dbAdapter, 'getDocument', async () => tx);
 t.mock.method(dbAdapter, 'getCollection', async () => []);
 t.mock.method(fiscalWorkflowV2Client, 'enabled', () => true);
 t.mock.method(fiscalWorkflowV2Client, 'cached', async () => cached);
 const consult = t.mock.method(fiscalWorkflowV2Client, 'consult', async (id: string) => {
  assert.equal(id, tx.id);
  startConsult();
  cached = nextStatus;
  return cached;
 });
 t.mock.method(PrintRouterService, 'routeAndPrintEscPos', async ({ escPosBase64 }: { escPosBase64: string }) => {
  jobs.push(Buffer.from(escPosBase64, 'base64').toString('utf8'));
  return true;
 });
 t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });

 const pending = printTicket(stale, config);
 assert.equal(printTicket(tx, config), pending);
 await started;
 await flush();
 assert.equal(consult.mock.callCount(), 1);
 t.mock.timers.tick(17_000);
 await flush();
 assert.equal(consult.mock.callCount(), 2);
 assert.deepEqual(jobs, []);

 const hint = { version: 1, transactionId: tx.id, ...binding };
 receiveFiscalPrintHint(hint, binding, { ...binding, terminalId: 'previous-binding' });
 receiveFiscalPrintHint({ ...hint, tenantId: 'another-tenant' }, binding, binding);
 receiveFiscalPrintHint({ ...hint, storeId: 'another-store' }, binding, binding);
 receiveFiscalPrintHint({ ...hint, transactionId: '00000000-0000-0000-0000-000000000001' }, binding, binding);
 await flush();
 assert.equal(consult.mock.callCount(), 2);

 nextStatus = signed;
 const releaseBaseline = reserveLargeMasterSyncV3BaselineMutation();
 try {
  receiveFiscalPrintHint(hint, binding, binding);
  receiveFiscalPrintHint(hint, binding, binding);
  await flush();
  assert.equal(consult.mock.callCount(), 3);
  assert.deepEqual(jobs, []);
 } finally {
  releaseBaseline();
 }
 assert.equal(await pending, true);
 assert.equal(jobs.length, 1);
 assert.match(jobs[0], /NVrTbH/);
 assert.match(jobs[0], /Pendiente de confirmacion/);

 assert.equal(await printTicket(tx, config), true);
 assert.equal(consult.mock.callCount(), 3);
 assert.deepEqual(jobs, [jobs[0], jobs[0]]);
});

test('the opted-in ticket releases expired requests during status and V3 baseline waits', { timeout: 3000 }, async t => {
 const { printTicket } = await import('../utils/printer');
 const { fiscalWorkflowV2Client } = await import('../services/fiscal/FiscalWorkflowV2Client');
 const { receiveFiscalPrintHint } = await import('../services/fiscal/FiscalPrintHint');
 const { PrintRouterService } = await import('../services/printer/PrintRouterService');
 const { dbAdapter } = await import('../services/db');
 const { reserveLargeMasterSyncV3BaselineMutation } = await import('../services/sync/LargeMasterSyncV3OperationGate');
 const { tx, state, binding, config } = await optedInPrintFixture(t);
 let startConsult!: () => void;
 const started = new Promise<void>(resolve => { startConsult = resolve; });
 let cached = { ...state, state: 'AWAITING_APPLICATION', decision: 'PENDING', signature: null };
 let attempts = 0;
 const flush = () => new Promise(resolve => setImmediate(resolve));
 t.mock.method(dbAdapter, 'getDocument', async () => tx);
 t.mock.method(dbAdapter, 'getCollection', async () => []);
 t.mock.method(fiscalWorkflowV2Client, 'enabled', () => true);
 t.mock.method(fiscalWorkflowV2Client, 'cached', async () => cached);
 t.mock.method(fiscalWorkflowV2Client, 'consult', async (id: string) => {
  assert.equal(id, tx.id);
  if (++attempts === 1) {
   startConsult();
   throw new Error('HTTP 520');
  }
  return cached;
 });
 const dispatch = t.mock.method(PrintRouterService, 'routeAndPrintEscPos', async () => true);
 t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });

 const pending = printTicket(tx, config);
 await started;
 await flush();
 t.mock.timers.tick(29_999);
 await flush();
 assert.equal(attempts, 2);
 assert.equal(dispatch.mock.callCount(), 0);
 t.mock.timers.tick(1);
 assert.equal(await pending, false);
 receiveFiscalPrintHint({ version: 1, transactionId: tx.id, ...binding }, binding, binding);
 await flush();
 assert.equal(attempts, 2);
 assert.equal(dispatch.mock.callCount(), 0);

 cached = { ...cached, state: 'SIGNED_PENDING', signature: state.signature };
 const releaseBaseline = reserveLargeMasterSyncV3BaselineMutation();
 try {
  const baselinePending = printTicket(tx, config);
  await flush();
  t.mock.timers.tick(30_000);
  assert.equal(await baselinePending, false);
  assert.equal(dispatch.mock.callCount(), 0);
 } finally {
  releaseBaseline();
 }
 await flush();
 assert.equal(dispatch.mock.callCount(), 0);

 assert.equal(await printTicket(tx, config), true);
 assert.equal(attempts, 2);
 assert.equal(dispatch.mock.callCount(), 1);
});

for (const waitForSignature of [true, false]) {
 test(`print readiness polls without relying on Realtime when the check is ${waitForSignature ? 'on' : 'off'}`, { timeout: 3000 }, async t => {
  const { fiscalWorkflowV2Client } = await import('../services/fiscal/FiscalWorkflowV2Client');
  const { resolveFiscalPrintReadiness } = await import('../services/fiscal/FiscalPrintEvidence');
  const { receiveFiscalPrintHint } = await import('../services/fiscal/FiscalPrintHint');
  const { tx, state } = await workflowFixture({ id: 'a527e8c3-152a-4731-a6da-806bf2f40a55', ncfType: 'E32' });
  let cached = { ...state, state: 'AWAITING_APPLICATION', decision: 'PENDING', signature: null };
  let attempts = 0;
  let startConsult!: () => void;
  const started = new Promise<void>(resolve => { startConsult = resolve; });
  t.mock.method(fiscalWorkflowV2Client, 'enabled', () => true);
  t.mock.method(fiscalWorkflowV2Client, 'cached', async () => cached);
  t.mock.method(fiscalWorkflowV2Client, 'consult', async () => {
   startConsult();
   if (++attempts === 2) cached = { ...cached, state: 'SIGNED_PENDING', signature: state.signature };
   return cached;
  });
  const controller = new AbortController();
  t.after(() => controller.abort());
  if (waitForSignature) t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const pending = resolveFiscalPrintReadiness(tx, { waitForSignature, signal: controller.signal });
  await started;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempts, 1);
  if (!waitForSignature) {
   receiveFiscalPrintHint({ version: 1, transactionId: tx.id, ...state.scope }, state.scope, state.scope);
   await new Promise(resolve => setImmediate(resolve));
   assert.equal(attempts, 1);
  }
  if (waitForSignature) t.mock.timers.tick(1500);
  const display = await pending;
  assert.equal(attempts, 2);
  assert.equal(display?.securityCode, state.signature.securityCode);
  assert.equal(display?.dgiiAccepted, false);
 });
}

test('MSeller print opt-in applies to E32 and E34 of the current enrolled box only', async () => {
 const { terminalUsesMSellerRealtimePrint } = await import('../services/fiscal/FiscalPrintEvidence');
 const { tx, state } = await workflowFixture({ ncfType: 'E32' });
 const scope = state.scope;
 const local = { id: 'local-box', config: { erpBinding: scope, currentDeviceId: 'device', msellerRealtimePrintEnabled: true } };
 const terminal = [local] as any;
 assert.equal(terminalUsesMSellerRealtimePrint(tx, terminal, scope, 'device'), true);
 const note = { ...tx, ncfType: 'E34', electronicNcf: 'E340000001021', terminalId: 'local-box' };
 assert.equal(terminalUsesMSellerRealtimePrint(note, terminal, scope, 'device'), true);
 assert.equal(terminalUsesMSellerRealtimePrint({ ...tx, terminalId: 'other-box' }, terminal, scope, 'device'), false);
 assert.equal(terminalUsesMSellerRealtimePrint(tx, terminal, { ...scope, storeId: 'other-store' }, 'device'), false);
 assert.equal(terminalUsesMSellerRealtimePrint(tx, terminal, scope, 'other-device'), false);
 assert.equal(terminalUsesMSellerRealtimePrint(tx, [local, local] as any, scope, 'device'), false);
 assert.equal(terminalUsesMSellerRealtimePrint({ ...tx, ncfType: 'E31' }, terminal, scope, 'device'), false);
 assert.equal(terminalUsesMSellerRealtimePrint({ ...tx, fiscalWorkflowCheckoutId: undefined }, terminal, scope, 'device'), false);
 local.config.msellerRealtimePrintEnabled = false;
 assert.equal(terminalUsesMSellerRealtimePrint(tx, terminal, scope, 'device'), false);
});
