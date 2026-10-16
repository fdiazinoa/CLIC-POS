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
