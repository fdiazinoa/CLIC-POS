import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTransactionSettlementFields} from '../utils/paymentSettlement';
import {assertDopFiscalSettlement,configuredFiscalBaseCurrency} from '../services/fiscal/DopFiscalSettlement';

const originalCases=[
 [{id:'usd',method:'CASH',amount:100,currencyCode:'USD',exchangeRate:50,amountOriginal:2}],
 [{id:'usd-over',method:'CASH',amount:120,currencyCode:'USD',exchangeRate:60,amountOriginal:2}],
 [{id:'eur',method:'CASH',amount:65,currencyCode:'EUR',exchangeRate:65,amountOriginal:1},{id:'dop',method:'CASH',amount:35,currencyCode:'DOP',exchangeRate:1,amountOriginal:35}],
 [{id:'external-card',method:'CARD',amount:100,currencyCode:'USD',exchangeRate:50,amountOriginal:2}],
 [{id:'other',method:'OTHER',amount:100,currencyCode:'USD',exchangeRate:50,amountOriginal:2}],
 [{id:'dop',method:'CASH',amount:100,currencyCode:'DOP',exchangeRate:1,amountOriginal:100}],
 [{id:'cash',method:'CASH',amount:70,currencyCode:'DOP',exchangeRate:1,amountOriginal:70},{id:'credit',method:'CREDIT',amount:30,currencyCode:'DOP',exchangeRate:1,amountOriginal:30}],
];
export function settlementCases(){return originalCases.map(payments=>({currency:'DOP',total:100,pendingBalance:payments.some(p=>p.method==='CREDIT')?30:0,...buildTransactionSettlementFields(payments as any,100,'DOP')}));}
for(const [index,source] of settlementCases().entries())test(`actual settlement helper shape ${index} remains immutable and uses captured base amounts`,()=>{
 const before=JSON.stringify(source);assert.doesNotThrow(()=>assertDopFiscalSettlement(source));assert.equal(JSON.stringify(source),before);
});
for(const issue of ['zero-rate','negative-rate','nan-rate','infinite-rate','rate-string','currency-conflict','applied-conflict','forged-original','forged-conversion','forged-change','wrong-base'] as const)test(`captured foreign tender rejects ${issue}`,()=>{
 const source:any=settlementCases()[0],p=source.payments[0];
 if(issue==='zero-rate')p.exchangeRate=p.exchange_rate=0;
 if(issue==='negative-rate')p.exchangeRate=p.exchange_rate=-1;
 if(issue==='nan-rate')p.exchangeRate=p.exchange_rate=NaN;
 if(issue==='infinite-rate')p.exchangeRate=p.exchange_rate=Infinity;
 if(issue==='rate-string')p.exchangeRate=p.exchange_rate='50';
 if(issue==='currency-conflict')p.currency_code='EUR';
 if(issue==='applied-conflict')p.appliedAmount=1;
 if(issue==='forged-original')p.amountOriginal=1;
 if(issue==='forged-conversion')p.amount=99;
 if(issue==='forged-change')p.changeAmount=p.change_amount=1;
 if(issue==='wrong-base')source.currency='USD';
 assert.throws(()=>assertDopFiscalSettlement(source),/SETTLEMENT_INVALID/);
});
test('legacy kiosk display caption is not an ISO authority and conflicting true ISO aliases still reject',()=>{
 const source:any=settlementCases()[5];source.payments[0].currency='RD$';assert.doesNotThrow(()=>assertDopFiscalSettlement(source));
 source.payments[0].currency='USD';assert.throws(()=>assertDopFiscalSettlement(source));
});
test('base proof uses actual configured POS selector, rejects conflicting base flags',()=>{
 assert.equal(configuredFiscalBaseCurrency({currencies:[{code:'DOP',isBase:true},{code:'USD'}]}),'DOP');
 assert.equal(configuredFiscalBaseCurrency({currencies:[{code:'USD'},{code:'DOP'}]}),'USD');
 assert.equal(configuredFiscalBaseCurrency({currencies:[{code:'DOP',isBase:true},{code:'USD',isBase:true}]}),undefined);
});


test('literal payment modal validates captured FX before reaching gateway or payment effects',async()=>{
 const {readFileSync}=await import('node:fs'),ts=await import('typescript');
 const source=readFileSync(new URL('../components/PaymentModal.tsx',import.meta.url),'utf8');
 const start=source.indexOf('         if(items.some(item=>item.v3SaleAuthority)&&!isRefund&&baseCurrency.code===');
 const end=source.indexOf('         setPayments(paymentsToConfirm);',start);assert.ok(start>0&&end>start);
 const js=ts.transpileModule('async function invoke(){'+source.slice(start,end)+'}',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 for(const corrupt of [false,true]){
  const payments=settlementCases()[0].payments;if(corrupt)payments[0].amountOriginal=1;
  let gateways=0;const deps:any={items:[{v3SaleAuthority:{}}],isRefund:false,baseCurrency:{code:'DOP'},config:{currencies:[{code:'DOP',isBase:true}]},assertDopFiscalSettlement,configuredFiscalBaseCurrency,effectiveTotalToPay:100,sumCreditPaymentsBase:()=>0,paymentsToConfirm:payments,measureInteractionStage:async(_trace:any,_start:any,_end:any,run:any)=>run(),trace:{},authorizePendingGatewayPayments:async(entries:any)=>{gateways++;return entries;}};
  const invoke=new Function(...Object.keys(deps),js+';return invoke;')(...Object.values(deps));
  if(corrupt){await assert.rejects(invoke(),/SETTLEMENT_INVALID/);assert.equal(gateways,0);}else{await invoke();assert.equal(gateways,1);}
 }
});

test('fiscal state verifies DOP invoice with original foreign tender without comparing tender code to invoice code',async()=>{
 const {verifyFiscalWorkflowState}=await import('../services/fiscal/FiscalWorkflowV2Client');
 const {fiscalStatusSourceChecksum}=await import('../services/fiscal/FiscalStatusProof');
 const {sha256Utf8}=await import('../services/sync/LargeMasterSyncV3Client');
 const scope={tenantId:'tenant',companyId:'company',storeId:'store',terminalId:'terminal',deviceId:'device'};
 const source:any={...settlementCases()[0],id:'tx',terminalId:'terminal',ncf:'E320000000001',ncfType:'E32',items:[],date:'2026-10-24T00:00:00Z',netAmount:100,taxAmount:0,fiscalEnvironment:0,fiscalIssuance:{issuerRnc:'101010101',tenantId:'tenant',companyId:'company',terminalId:'terminal'}};
 const envelope={transaction:structuredClone(source)};
 const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,canonical(value[k])])):value;
 const state:any={schemaVersion:2,source:'ERP_POS_FISCAL_WORKFLOW_V2',mode:'STATUS_ONLY',transactionId:source.id,scope,issuerRnc:'101010101',environment:0,ncf:source.ncf,ncfType:source.ncfType,total:100,currency:'DOP',exchangeRate:1,observationVersion:1,draftRevision:0,decision:'PENDING',observedAt:'2026-10-24T00:00:00Z',workflowId:null,permitId:null,canCorrect:false,originalSourceEnvelope:envelope,saleEventId:'event',checksumV1:await fiscalStatusSourceChecksum(source)};
 state.originalDigestV2=await sha256Utf8(JSON.stringify(canonical({schemaVersion:2,source:'POS_ORIGINAL_ENVELOPE_V2',scope,saleEventId:'event',payload:envelope})));
 assert.equal(await verifyFiscalWorkflowState(source,state),true);
 assert.equal(source.settlementCurrencyCode,'USD');
 assert.equal(await verifyFiscalWorkflowState(source,{...state,currency:'USD'}),false);
});
