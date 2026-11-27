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

async function workflowFixture(checkoutId?: string, transactionId?: string){
 const f=await fixture();delete f.tx.fiscalPrintProof;delete f.tx.fiscalSubmissionScope;
 Object.assign(f.tx,{ncf:'E310000001021',electronicNcf:'E310000001021',ncfType:'E31',customerSnapshot:{name:'Original incorrecto',taxId:'BAD'},currency:'DOP',fiscalEnvironment:0,fiscalIssuance:{issuerRnc:'130090752',tenantId:'tenant',companyId:'company',terminalId:'terminal'}});
 if (checkoutId) f.tx.fiscalWorkflowCheckoutId = checkoutId;
 if (transactionId) f.tx.id = transactionId;
 const envelope={transaction:JSON.parse(JSON.stringify(f.tx))};
 const scope={tenantId:'tenant',companyId:'company',storeId:'store',terminalId:'terminal',deviceId:'device'};
 const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
 const {sha256Utf8}=await import('../services/sync/LargeMasterSyncV3Client');
 const state:any={schemaVersion:2,source:'ERP_POS_FISCAL_WORKFLOW_V2',mode:'WORKFLOW',transactionId:f.tx.id,workflowId:'permit',permitId:'permit',scope,issuerRnc:'130090752',environment:0,ncf:f.tx.ncf,ncfType:'E31',currency:'DOP',exchangeRate:1,total:352,saleEventId:'event',originalSourceEnvelope:envelope,originalDigestV2:await sha256Utf8(JSON.stringify(canonical({schemaVersion:2,source:'POS_ORIGINAL_ENVELOPE_V2',scope,saleEventId:'event',payload:envelope}))),checksumV1:await fiscalStatusSourceChecksum(f.tx),observationVersion:3,draftRevision:1,decision:'ACCEPTED_CONDITIONAL',state:'ACCEPTED_CONDITIONAL',buyer:{name:'Comprador fiscal efectivo',taxId:'101010101'},canCorrect:false,observedAt:'2026-10-18T03:31:00Z',history:[],signature:{schemaVersion:1,qrUrl:'https://ecf.dgii.gov.do/testecf/ConsultaTimbre?RncEmisor=130090752&RncComprador=101010101&ENCF=E310000001021&FechaEmision=15-10-2026&MontoTotal=352.00&FechaFirma=15-10-2026%2023%3A30%3A53&CodigoSeguridad=NVrTbH',securityCode:'NVrTbH',signedAt:'15-10-2026 23:30:53'}};
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

test('MSeller checkout only sends signed tickets to the printer and reuses the cached timbre', async t => {
 const { printTicket } = await import('../utils/printer');
 const { dbAdapter } = await import('../services/db');
 const { fiscalWorkflowV2Client } = await import('../services/fiscal/FiscalWorkflowV2Client');
 const { PrintRouterService } = await import('../services/printer/PrintRouterService');
 const { tx, state } = await workflowFixture('11ddc090-03ec-433b-996d-b62f00fde108');
 const stale = { ...tx };
 delete stale.fiscalWorkflowCheckoutId;
 const config = { currencySymbol: 'RD$', taxRate: 0, taxes: [], receiptConfig: { showQr: true }, companyInfo: { name: 'Synthetic' }, currencies: [] } as any;
 const jobs: string[] = [];
 let signatureReady = false;
 let cached: Awaited<ReturnType<typeof fiscalWorkflowV2Client.cached>> = null;

 t.mock.method(dbAdapter, 'getDocument', async () => tx);
 t.mock.method(dbAdapter, 'getCollection', async () => []);
 t.mock.method(fiscalWorkflowV2Client, 'enabled', () => true);
 t.mock.method(fiscalWorkflowV2Client, 'cached', async () => cached);
 const consult = t.mock.method(fiscalWorkflowV2Client, 'consult', async (id: string) => {
  assert.equal(id, tx.id);
  if (!signatureReady) throw new Error('FISCAL_WORKFLOW_AUTH_REQUIRED');
  cached = { ...state, decision: 'PENDING', state: 'SIGNED_PENDING' };
  return cached;
 });
 t.mock.method(PrintRouterService, 'routeAndPrintEscPos', async ({ escPosBase64 }: { escPosBase64: string }) => {
  jobs.push(Buffer.from(escPosBase64, 'base64').toString('utf8'));
  return true;
 });

 assert.equal(await printTicket(stale, config), false);
 assert.deepEqual(jobs, []);
 signatureReady = true;
 assert.equal(await printTicket(tx, config), true);
 assert.equal(await printTicket(tx, config), true);
 assert.equal(consult.mock.callCount(), 2);
 assert.equal(jobs.length, 2);
 assert.match(jobs[0], /NVrTbH/);
 assert.match(jobs[0], /Pendiente de confirmacion/);
 assert.equal(jobs[1], jobs[0]);
});

test('one print request survives both deadlines and coalesces another caller until the pending timbre arrives', async t => {
 const { printTicket, printIntegratedPaymentArtifacts } = await import('../utils/printer');
 const { dbAdapter } = await import('../services/db');
 const { fiscalWorkflowV2Client } = await import('../services/fiscal/FiscalWorkflowV2Client');
 const { PrintRouterService } = await import('../services/printer/PrintRouterService');
 const { isLargeMasterSyncV3OperationalWindowHeld, reserveLargeMasterSyncV3BaselineMutation } = await import('../services/sync/LargeMasterSyncV3OperationGate');
 const { tx, state } = await workflowFixture('21ddc090-03ec-433b-996d-b62f00fde108');
 const config = { currencySymbol: 'RD$', receiptConfig: { showQr: true }, companyInfo: { name: 'Synthetic' }, currencies: [] } as any;
 const jobs: string[] = [];
 let cached = { ...state, state: 'AWAITING_APPLICATION', decision: 'PENDING', signature: null };
 t.mock.method(dbAdapter, 'getDocument', async () => tx);
 t.mock.method(dbAdapter, 'getCollection', async () => []);
 t.mock.method(fiscalWorkflowV2Client, 'enabled', () => true);
 t.mock.method(fiscalWorkflowV2Client, 'cached', async () => cached);
 let started!: () => void;
 const startedConsult = new Promise<void>(resolve => { started = resolve; });
 const consult = t.mock.method(fiscalWorkflowV2Client, 'consult', async () => { started(); return cached; });
 t.mock.method(PrintRouterService, 'routeAndPrintEscPos', async ({ escPosBase64 }: { escPosBase64: string }) => {
  assert.equal(isLargeMasterSyncV3OperationalWindowHeld(), true);
  jobs.push(Buffer.from(escPosBase64, 'base64').toString('utf8'));
  return true;
 });
 t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });

 const request = printTicket(tx, config);
 await startedConsult;
 await new Promise(resolve => setImmediate(resolve));
 assert.equal(consult.mock.callCount(), 1);
 t.mock.timers.tick(17_000);
 await new Promise(resolve => setImmediate(resolve));
 assert.equal(isLargeMasterSyncV3OperationalWindowHeld(), false);
 assert.deepEqual(jobs, []);
 assert.equal(printTicket(tx, config), request);
 const integrated = printIntegratedPaymentArtifacts(tx, config);
 assert.equal(printIntegratedPaymentArtifacts(tx, config), integrated);
 const releaseBaseline = reserveLargeMasterSyncV3BaselineMutation();
 cached = { ...cached, signature: state.signature, state: 'SIGNED_PENDING' };
 try {
  t.mock.timers.tick(1500);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(jobs, []);
 } finally {
  releaseBaseline();
 }

 assert.equal(await request, true);
 assert.equal((await integrated).ticketPrinted, true);
 assert.equal(jobs.length, 1);
 assert.match(jobs[0], /NVrTbH/);
 assert.match(jobs[0], /Pendiente de confirmacion/);
});

test('print readiness survives a transient status error and returns a signed pending timbre', async t => {
 const { fiscalWorkflowV2Client } = await import('../services/fiscal/FiscalWorkflowV2Client');
 const { resolveFiscalPrintReadiness } = await import('../services/fiscal/FiscalPrintEvidence');
 const { tx, state } = await workflowFixture();
 let cached: Awaited<ReturnType<typeof fiscalWorkflowV2Client.cached>> = null;
 let attempts = 0;
 t.mock.method(fiscalWorkflowV2Client, 'enabled', () => true);
 t.mock.method(fiscalWorkflowV2Client, 'cached', async () => cached);
 t.mock.method(fiscalWorkflowV2Client, 'consult', async () => {
  if (++attempts === 1) throw new Error('FISCAL_WORKFLOW_UNAVAILABLE');
  cached = { ...state, decision: 'PENDING', state: 'SIGNED_PENDING' };
  return cached;
 });

 const display = await resolveFiscalPrintReadiness(tx, { timeoutMs: 6000 });
 assert.equal(attempts, 2);
 assert.equal(display?.securityCode, state.signature.securityCode);
 assert.equal(display?.dgiiAccepted, false);
});

test('a private terminal hint wakes an active print and still requires an authenticated signature', async t => {
 const { fiscalWorkflowV2Client } = await import('../services/fiscal/FiscalWorkflowV2Client');
 const { resolveFiscalPrintReadiness } = await import('../services/fiscal/FiscalPrintEvidence');
 const { receiveFiscalPrintHint } = await import('../services/fiscal/FiscalPrintHint');
 const { tx, state } = await workflowFixture('11ddc090-03ec-433b-996d-b62f00fde108', '11ddc090-03ec-433b-996d-b62f00fde109');
 const scope = { tenantId: 'tenant-a', storeId: 'store-a', terminalId: 'terminal-a' };
 const hint = { version: 1, transactionId: tx.id, ...scope };
 const controller = new AbortController();
 t.after(() => controller.abort());
 let cached: Awaited<ReturnType<typeof fiscalWorkflowV2Client.cached>> = null;
 let attempts = 0;
 let firstConsult!: () => void;
 const consulting = new Promise<void>(resolve => { firstConsult = resolve; });
 t.mock.method(fiscalWorkflowV2Client, 'enabled', () => true);
 t.mock.method(fiscalWorkflowV2Client, 'cached', async () => cached);
 t.mock.method(fiscalWorkflowV2Client, 'consult', async () => {
  if (++attempts === 1) { firstConsult(); return { ...state, signature: null }; }
  cached = { ...state, decision: 'PENDING', state: 'SIGNED_PENDING' };
  return cached;
 });
 t.mock.timers.enable({ apis: ['setTimeout'] });
 const print = resolveFiscalPrintReadiness(tx, { waitForSignature: true, signal: controller.signal });
 await consulting;
 await new Promise(resolve => setImmediate(resolve));
 assert.equal(attempts, 1);
 receiveFiscalPrintHint(hint, scope, { ...scope, terminalId: 'retired-context' });
 receiveFiscalPrintHint({ ...hint, storeId: 'another-store' }, scope, scope);
 receiveFiscalPrintHint({ ...hint, transactionId: '00000000-0000-0000-0000-000000000001' }, scope, scope);
 await new Promise(resolve => setImmediate(resolve));
 assert.equal(attempts, 1);
 receiveFiscalPrintHint(hint, scope, scope);
 receiveFiscalPrintHint(hint, scope, scope);
 await new Promise(resolve => setImmediate(resolve));
 assert.equal(attempts, 2, 'wakes without the polling timer and ignores the duplicate hint');
 assert.equal((await print)?.securityCode, state.signature.securityCode);
 assert.equal((await print)?.dgiiAccepted, false);
});

test('committed MSeller sales and returns send the existing outbox before reading print status', async t => {
 const { prepareCommittedFiscalPrint } = await import('../services/fiscal/FiscalPrintEvidence');
 const { fiscalWorkflowV2Client } = await import('../services/fiscal/FiscalWorkflowV2Client');
 const { durableOutboxBatchSender } = await import('../services/sync/DurableOutboxBatchSender');
 const operations: string[] = [];
 const { tx } = await workflowFixture('11ddc090-03ec-433b-996d-b62f00fde108');
 t.mock.method(durableOutboxBatchSender, 'sendNext', async () => { operations.push('outbox'); });
 t.mock.method(fiscalWorkflowV2Client, 'enabled', () => true);
 t.mock.method(fiscalWorkflowV2Client, 'cached', async () => null);
 t.mock.method(fiscalWorkflowV2Client, 'consult', async (id: string) => {
  operations.push(id);
  return { state: 'HELD', signature: null };
 });

 await prepareCommittedFiscalPrint({ ...tx, id: 'sale-e32', ncfType: 'E32' });
 await prepareCommittedFiscalPrint({ ...tx, id: 'return-e34', ncfType: 'E34', documentType: 'REFUND' });
 await prepareCommittedFiscalPrint({ ...tx, id: 'legacy', fiscalWorkflowCheckoutId: undefined });
 assert.deepEqual(operations, ['outbox', 'sale-e32', 'outbox', 'return-e34']);
});

test('OFF print readiness and email preserve V1 proof and never consult a V2 endpoint',async()=>{const {fiscalWorkflowV2Client}=await import('../services/fiscal/FiscalWorkflowV2Client'),{resolveFiscalPrintReadiness}=await import('../services/fiscal/FiscalPrintEvidence');const old=fiscalWorkflowV2Client.consult,oldEnabled=fiscalWorkflowV2Client.enabled;let network=0;fiscalWorkflowV2Client.enabled=()=>false;fiscalWorkflowV2Client.consult=async()=>{network++;throw Error('V2_FORBIDDEN');};try{const f=await fixture(),signed=await resolveFiscalPrintReadiness(f.tx);assert.ok(signed);delete f.tx.fiscalPrintProof;const start=Date.now();assert.equal(await resolveFiscalPrintReadiness(f.tx),undefined);assert.ok(Date.now()-start<100);assert.equal((buildReceiptEmailPayload(f.tx,'fixture@example.invalid',{currencySymbol:'RD$',taxRate:0,taxes:[],receiptConfig:{showQr:true},companyInfo:{name:'Synthetic'},currencies:[]} as any,'RD$') as any).fiscalPrintEvidence,undefined);assert.equal(network,0);}finally{fiscalWorkflowV2Client.consult=old;fiscalWorkflowV2Client.enabled=oldEnabled;}});
test('retained format tax rows without a display name print safely without mutating the original',async()=>{const f=await fixture();f.tx.taxBreakdown=[{taxId:'vat',type:'VAT',rate:.18,amount:99,taxableBase:550},{taxId:'service',type:'SERVICE_CHARGE',rate:.1,amount:55,taxableBase:550}];const before=JSON.stringify(f.tx),config:any={currencySymbol:'RD$',taxRate:0,taxes:[],receiptConfig:{showQr:true},companyInfo:{name:'Synthetic'},currencies:[]};const text=Buffer.from(buildEscPosTicketPayload(f.tx,config,[])!,'base64').toString('utf8');assert.match(text,/ITBIS 18%/);assert.match(text,/Servicio 10%/);assert.equal(JSON.stringify(f.tx),before);});
