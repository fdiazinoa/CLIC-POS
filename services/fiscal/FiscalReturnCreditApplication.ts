import type {Customer,Transaction} from '../../types';
import type {FiscalWorkflowScope,FiscalWorkflowStateV2} from './FiscalWorkflowV2Types';
import {assertReturnSettlementCapability,RETURN_CREDIT_PATH,returnJSON,returnNeed,sameReturn,type ReturnCapability} from './FiscalReturnV1';
import type {CreditAttempt,CreditReceipt,NativeFiscalCreditApplicationStore} from '../db/NativeFiscalCreditApplicationStore';
import {captureFiscalStatusBoundContext} from './FiscalBoundContext';
import {createFiscalReturnTransport} from './FiscalReturnConsumer';
import {fiscalWorkflowV2Client} from './FiscalWorkflowV2Client';
import {apiSyncAdapter} from '../sync/ApiSyncAdapter';
import {resolveSyncTarget} from '../sync/SyncProfile';
import {dbAdapter} from '../db';
const uuid=(v:any)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const money=(v:any)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&Number.isSafeInteger(Math.round(v*100))&&Math.abs(v*100-Math.round(v*100))<1e-6;
const scopeOf=(auth:ReturnType<typeof captureFiscalStatusBoundContext>):FiscalWorkflowScope=>{const {tenantId,companyId,storeId,terminalId,deviceId}=auth.descriptor;return{tenantId,companyId,storeId,terminalId,deviceId};};
export interface CreditTarget {sourceTransactionId:string;scope:FiscalWorkflowScope;customerId:string;invoiceId:string;sourceCustomerId:string;customer:Customer;enabled:boolean;attempt:CreditAttempt|null;}
interface Ports {
 store:()=>NativeFiscalCreditApplicationStore|undefined; context:typeof captureFiscalStatusBoundContext;
 capability:()=>Promise<ReturnCapability>; consult:(id:string)=>Promise<FiscalWorkflowStateV2>;
 customers:()=>Promise<Customer[]>; getCustomer:(id:string)=>Promise<Customer|null>; getWallet:(id:string)=>Promise<any>;getWallets:()=>Promise<any[]>;
 post:(bytes:string)=>Promise<any>; notify:()=>void;
}
const inFlight=new Map<string,Promise<{attempt:CreditAttempt;projectionPending:boolean}>>();
export function assertCreditReceipt(value:any,a:CreditAttempt):asserts value is CreditReceipt {
 const c=JSON.parse(a.commandBytes);
 returnNeed(value&&Object.keys(value).sort().join(',')==='accountingEntryId,amount,currency,customerId,destination,invoiceId,operationId,receiptEntryId,schemaVersion,walletBalance'
  &&['schemaVersion','operationId','customerId','invoiceId','amount'].every(k=>value[k]===c[k])&&value.currency==='DOP'&&value.destination==='INVOICE_DEBT'
  &&money(value.walletBalance)&&uuid(value.receiptEntryId)&&uuid(value.accountingEntryId),'FISCAL_RETURN_CREDIT_RECEIPT_INVALID');
}
export function createFiscalCreditApplicationService(ports:Ports){
 const freshCustomer=async(customerId:string,scope:FiscalWorkflowScope,auth:ReturnType<typeof captureFiscalStatusBoundContext>,provided?:Customer[],sourceCustomerId?:string,requireWallet=true)=>{
  const rows=provided||await ports.customers();auth.assertCurrent();
  const matches=rows.filter(c=>c.id===customerId);returnNeed(matches.length===1&&uuid(matches[0].id),'FISCAL_RETURN_CUSTOMER_PROJECTION_PENDING');
  const c=matches[0] as Customer&Record<string,any>;
  if(sourceCustomerId)returnNeed(c.id===sourceCustomerId||c.source_customer_id===sourceCustomerId||c.sourceCustomerId===sourceCustomerId,'FISCAL_RETURN_CUSTOMER_SCOPE_REQUIRED');
  for(const [key,value]of Object.entries(scope)){for(const name of [key,key.replace(/[A-Z]/g,m=>'_'+m.toLowerCase())])if(c[name]!==undefined)returnNeed(c[name]===value,'FISCAL_RETURN_CUSTOMER_SCOPE_REQUIRED');}
  returnNeed(money(c.currentDebt)&&(!requireWallet&&!c.wallet||c.wallet&&typeof c.wallet.id==='string'&&c.wallet.id.length>0&&c.wallet.currency==='DOP'&&c.wallet.status==='ACTIVE'&&money(c.wallet.balance)),'FISCAL_RETURN_WALLET_NOT_READY');
  return c;
 };
 const projectionInputs=async(customerId:string,scope:FiscalWorkflowScope,auth:ReturnType<typeof captureFiscalStatusBoundContext>,requireWallet=true)=>{
  const old=await ports.getCustomer(customerId),walletRows=await ports.getWallets();auth.assertCurrent();
  const fresh=await freshCustomer(customerId,scope,auth,undefined,undefined,requireWallet);auth.assertCurrent();
  const aliases=[fresh.id,fresh.source_customer_id,fresh.sourceCustomerId].filter(Boolean);
  const owned=walletRows.filter(w=>aliases.includes(w.customerId)||w.id===old?.wallet?.id);
  returnNeed(owned.length<=1&&(!owned[0]||owned[0].customerId===fresh.id),'FISCAL_RETURN_CUSTOMER_PROJECTION_PENDING');
  if(!fresh.wallet){returnNeed(!owned.length&&!old?.wallet,'FISCAL_RETURN_CUSTOMER_PROJECTION_PENDING');return{old,expectedWallet:null,fresh,wallet:null,next:{...fresh,...(old||{}),id:fresh.id,wallet:undefined,currentDebt:fresh.currentDebt}};}
  // Keep the already-linked local wallet ID; ERP's ID is an alias, never a second balance row.
  const walletId=owned[0]?.id||old?.wallet?.id||fresh.wallet.id;
  const expectedWallet=walletRows.find(w=>w.id===walletId)||null;
  returnNeed(!expectedWallet||expectedWallet.customerId===fresh.id,'FISCAL_RETURN_CUSTOMER_PROJECTION_PENDING');
  const wallet={...fresh.wallet,id:walletId,...(walletId!==fresh.wallet.id?{erpWalletId:fresh.wallet.id}:{}),customerId:fresh.id};
  return{old,expectedWallet,fresh,wallet,next:{...fresh,...(old||{}),id:fresh.id,wallet,currentDebt:fresh.currentDebt}};
 };
 const refresh=async(a:CreditAttempt,auth:ReturnType<typeof captureFiscalStatusBoundContext>)=>{
  const command=JSON.parse(a.commandBytes),p=await projectionInputs(command.customerId,a.scope,auth);
  const result=await ports.store()!.refreshProjection(a,p.old,p.expectedWallet,p.next,p.wallet,auth.assertCurrent);ports.notify();return result;
 };
 return {
  async refreshReturn(request:any){const auth=ports.context(),scope=scopeOf(auth);returnNeed(sameReturn(scope,request.scope),'FISCAL_RETURN_SCOPE_MISMATCH');
   const store=ports.store();returnNeed(store,'FISCAL_RETURN_NATIVE_REQUIRED');const p=await projectionInputs(request.customerId,scope,auth,false);
   await store!.refreshReturnProjection(request,p.old,p.expectedWallet,p.next,p.wallet,auth.assertCurrent);ports.notify();
  },
  async inspect(tx:Transaction):Promise<CreditTarget>{
   returnNeed(tx.documentType!=='REFUND'&&typeof tx.customerId==='string'&&tx.customerId.length>0&&Number(tx.pendingBalance)>0,'FISCAL_RETURN_DEBT_PROOF_REQUIRED');
   const auth=ports.context(),scope=scopeOf(auth),state=await ports.consult(tx.id);auth.assertCurrent();
   const invoiceId=state.documentId||state.originalReference?.documentId;
   returnNeed(state.transactionId===tx.id&&sameReturn(state.scope,scope)&&uuid(invoiceId)&&(!state.documentId||!state.originalReference?.documentId||state.documentId===state.originalReference.documentId),'FISCAL_RETURN_DEBT_PROOF_REQUIRED');
   const rows=await ports.customers();auth.assertCurrent();
   const matches=rows.filter(c=>c.id===tx.customerId||c.source_customer_id===tx.customerId||c.sourceCustomerId===tx.customerId);
   returnNeed(matches.length===1&&uuid(matches[0].id),'FISCAL_RETURN_CUSTOMER_SCOPE_REQUIRED');
   const customer=await freshCustomer(matches[0].id,scope,auth,rows,tx.customerId),cap=await ports.capability();auth.assertCurrent();
   let enabled=true;try{assertReturnSettlementCapability(cap,scope);}catch{enabled=false;}
   const store=ports.store();returnNeed(store,'FISCAL_RETURN_NATIVE_REQUIRED');
   return {sourceTransactionId:tx.id,scope,customerId:customer.id,invoiceId:invoiceId!,sourceCustomerId:tx.customerId!,customer,enabled,attempt:await store!.current(scope,customer.id,invoiceId!)};
  },
  async apply(target:CreditTarget,amount:number,newConsumption=false){
   const auth=ports.context(),scope=scopeOf(auth);returnNeed(sameReturn(scope,target.scope),'FISCAL_RETURN_SCOPE_MISMATCH');
   const key=returnJSON([scope,target.customerId,target.invoiceId]),pending=inFlight.get(key);if(pending)return pending;
   const work=(async()=>{
    const store=ports.store();returnNeed(store,'FISCAL_RETURN_NATIVE_REQUIRED');let a=await store!.current(scope,target.customerId,target.invoiceId);
    if(a)returnNeed(a.serverOrigin===(auth.descriptor.origin||''),'FISCAL_RETURN_SCOPE_MISMATCH');
    if(!a||newConsumption){
     assertReturnSettlementCapability(await ports.capability(),scope);auth.assertCurrent();
     returnNeed(uuid(target.customerId)&&uuid(target.invoiceId)&&money(amount)&&amount>0,'FISCAL_RETURN_SETTLEMENT_INVALID');
     const customer=await freshCustomer(target.customerId,scope,auth,undefined,target.sourceCustomerId);
     returnNeed(amount<=customer.wallet!.balance&&amount<=Number(customer.currentDebt),'FISCAL_RETURN_CREDIT_EXCEEDED');
     a=await store!.begin(scope,target.customerId,target.invoiceId,amount,newConsumption,auth.descriptor.origin||'');
    }
    auth.assertCurrent();
    if(!a.receipt){const result=await ports.post(a.commandBytes);auth.assertCurrent();assertCreditReceipt(result,a);a=await store!.complete(a,result);}
    // The receipt is durable before projection. Failure here never repeats a debit.
    try{a=await refresh(a,auth);return{attempt:a,projectionPending:false};}
    catch{return{attempt:a,projectionPending:true};}
   })();inFlight.set(key,work);try{return await work;}finally{if(inFlight.get(key)===work)inFlight.delete(key);}
  }
 };
}
const transport=createFiscalReturnTransport();
export const fiscalCreditApplicationService=createFiscalCreditApplicationService({store:()=>dbAdapter.fiscalCreditApplicationStore,context:captureFiscalStatusBoundContext,
 capability:()=>transport.capability(),consult:id=>fiscalWorkflowV2Client.consult(id),
 customers:async()=>{returnNeed(resolveSyncTarget().kind==='ERP_ACTIVE','FISCAL_RETURN_CUSTOMER_PROJECTION_PENDING');return apiSyncAdapter.pull('customers');},
 getCustomer:id=>dbAdapter.getDocument<Customer>('customers',id),getWallet:id=>dbAdapter.getDocument('wallets',id),getWallets:()=>dbAdapter.getCollection('wallets'),notify:()=>{if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('customersUpdated'));},
 post:async(bytes)=>{const auth=captureFiscalStatusBoundContext(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);try{
  auth.assertCurrent();const response=await fetch(`${auth.base}/fiscal/workflow/v2/return/credit/apply`,{method:'POST',headers:{...auth.headers,'Content-Type':'application/json'},body:bytes,signal:controller.signal,credentials:'omit',redirect:'error',cache:'no-store'});
  const text=await response.text();returnNeed(text.length<=100000,'FISCAL_RETURN_CREDIT_RECEIPT_INVALID');auth.assertCurrent();const data=JSON.parse(text);
  if(!response.ok)throw Error(typeof data.code==='string'&&/^FISCAL_RETURN_[A-Z0-9_]+$/.test(data.code)?data.code:'FISCAL_RETURN_UNAVAILABLE');return data;
 }finally{clearTimeout(timer);}}
});

let projectionRun:Promise<void>|undefined;
export function refreshPendingReturnCustomerProjections(){
 if(projectionRun)return projectionRun;
 projectionRun=(async()=>{const auth=captureFiscalStatusBoundContext(),scope=scopeOf(auth);
  const requests=await dbAdapter.getCollection<any>('fiscalReturnProjectionRequests');auth.assertCurrent();
  for(const request of requests.filter(r=>r.state==='PENDING'&&sameReturn(r.scope,scope))){try{await fiscalCreditApplicationService.refreshReturn(request);}catch{/* Durable pending projection is retried on next reconnect/start. */}}
 })().finally(()=>{projectionRun=undefined;});return projectionRun;
}
