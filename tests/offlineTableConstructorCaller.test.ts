import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,Script} from 'node:vm';
import ts from 'typescript';
import {freezeAuthoritativeLineFiscalAmounts} from '../utils/fiscalBreakdown';
import {isV3FinancialDocument,validateV3FrozenFiscalAmounts} from '../services/sync/LargeMasterSyncV3FinancialCommit';
import {validateV3FrozenLineFiscalAmounts} from '../services/sync/LargeMasterSyncV3LineSource';

// Synthetic actual Android R5 constructor input, retained to demonstrate the rejected double count.
const captured=JSON.parse(readFileSync(new URL('./fixtures/offlineTableConstructorInput.json',import.meta.url),'utf8'));
const config:any={serviceTaxPolicies:{DINE_IN:{legalTip:{enabled:true,percentage:10},taxIds:['qa-vat-001']}},taxRate:.18,taxes:[{id:'qa-vat-001',name:'ITBIS',rate:.18,type:'VAT',isActive:true}]};
const ui=readFileSync(new URL('../components/POSInterface.tsx',import.meta.url),'utf8');
const calculation=ui.slice(ui.indexOf('               const offlineTableInvoice='),ui.indexOf('               const documentConsignmentFields',ui.indexOf('               const offlineTableInvoice=')));
const constructor=readFileSync(new URL('../services/transactionService.ts',import.meta.url),'utf8');
const prefix=constructor.slice(constructor.indexOf("        recordCheckoutDiagnostic('TRANSACTION_CREATE_INPUT'"),constructor.indexOf('        if (data.customerId)',constructor.indexOf("        recordCheckoutDiagnostic('TRANSACTION_CREATE_INPUT'")));
function calculate(kind:'V1'|'V2',tip:number){
 const checkout:any={fiscalSaleContext:captured.fiscalSaleContext,...(kind==='V1'?{permit:{leaseId:'original-v1'}}:{allocation:{authorizationId:captured.fiscalAllocationAuthorizationId}})};
 const context=createContext({fiscalCheckoutRef:{current:checkout},documentTotal:654.9+tip,taxAmount:99.9,cartTip:tip,isRefundOnly:false,v3Operational:{},freezeAuthoritativeLineFiscalAmounts,contextualDocumentItems:captured.items,config,discountAmount:0,isTaxIncluded:false,activeTerminalConfig:{},isSelectedCustomerTaxExempt:false,appliedServiceTaxPolicy:{taxIds:['qa-vat-001']}});
 new Script(ts.transpileModule(calculation+'\nglobalThis.output={netAmount,documentItems,offlineTableInvoice};',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText).runInContext(context);
 const output=JSON.parse(JSON.stringify(context.output));return {...captured,payments:captured.payments.map((payment:any)=>({...payment,amount:654.9+tip,amountOriginal:654.9+tip,appliedAmount:654.9+tip,amountApplied:654.9+tip,applied_amount:654.9+tip})),items:output.documentItems,total:654.9+tip,netAmount:output.netAmount,serviceChargeAmount:tip,...(kind==='V1'?{fiscalAllocationAuthorizationId:undefined,fiscalOfflineLeaseId:'original-v1'}:{})};
}
async function validateConstructorInput(data:any){
 // Execute the actual constructor through its financial validation boundary. Cached DB/session
 // acquisition is synthetic; both fiscal validators and the caller calculation remain actual source.
 let validations=0;
 const context=createContext({data,options:{deferDurablePersistence:true},recordCheckoutDiagnostic:()=>{},assertFormatsPostingClosed:()=>{},isV3FinancialDocument,validateV3FrozenFiscalAmounts,validateV3FrozenLineFiscalAmounts,db:{assertFiscalTransactionAuthority:async()=>{},getDocument:async()=>config},getLargeMasterSyncV3OperationalSession:async()=>({projectConfig:async()=>config,validate:async()=>{validations++;return undefined;}})});
 new Script(ts.transpileModule('globalThis.invoke=async()=>{'+prefix+'return data;};',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText).runInContext(context);await (context.invoke as ()=>Promise<any>)();assert.equal(validations,1);
}
test('actual Android rejected constructor input contains double-counted legal tip',async()=>{
 assert.equal(captured.total,710.4);assert.equal(captured.netAmount,610.5);assert.equal(captured.serviceChargeAmount,55.5);assert.equal(captured.items[0].totalAmount,710.4);await assert.rejects(validateConstructorInput(captured),/FROZEN_FISCAL_INVALID/);
});
for(const kind of ['V1','V2'] as const)for(const tip of [0,55.5])test(`actual table caller ${kind} keeps legal tip ${tip} separate through constructor validation`,async()=>{
 const data=calculate(kind,tip);assert.equal(data.netAmount,555);assert.equal(data.taxAmount,99.9);assert.equal(data.serviceChargeAmount,tip);assert.equal(data.total,654.9+tip);assert.equal(data.items[0].netAmount,555);assert.equal(data.items[0].taxAmount,99.9);assert.equal(data.items[0].totalAmount,654.9);assert.equal(data.netAmount+data.taxAmount+tip,data.total);assert.equal(data.id,captured.id);assert.equal(data.fiscalWorkflowCheckoutId,captured.fiscalWorkflowCheckoutId);assert.deepEqual(data.payments.map((payment:any)=>payment.id),captured.payments.map((payment:any)=>payment.id));assert.equal(data.payments[0].amountApplied,data.total);
 await validateConstructorInput(data);
});
