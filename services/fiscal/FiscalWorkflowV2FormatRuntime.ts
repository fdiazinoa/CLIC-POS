import {dbAdapter} from '../db';
import type {Transaction,CartItem,FiscalDocumentCode} from '../../types';
import {captureFiscalStatusBoundContext} from './FiscalBoundContext';
import {createFiscalFormatHooks,quoteFormatFiscalIssuance} from './FiscalWorkflowV2FormatPorts';
import {prepareArticleFormatsAdaptersV2} from '../articleFormats/runtime';
import {captureInventoryV2,downloadInventoryV2,installInventoryV2} from '../articleFormats/inventoryV2';
import {prepareFormatSaleFinancialCommit,prepareFormatReturnFinancialCommit,commitFormatOwnedTransaction} from '../articleFormats/financialV2';
import {validateWireEventV2,type WireEventV2} from '../articleFormats/v2';
import type {FormatTransport} from '../articleFormats/wire';
import {createUuid} from '../../utils/uuid';
import {fiscalWorkflowV2Client,verifyFiscalWorkflowState} from './FiscalWorkflowV2Client';
import type {FiscalWorkflowCheckoutV2} from './FiscalWorkflowV2Types';
const need=(ok:unknown,code='FISCAL_WORKFLOW_FORMAT_NOT_READY'):void=>{if(!ok)throw Error(code);};
export async function prepareFiscalFormatRuntime(terminalId:string){
 const auth=captureFiscalStatusBoundContext();auth.assertCurrent();need(dbAdapter.articleFormatFinancialSQL,'FISCAL_WORKFLOW_NATIVE_REQUIRED');const sql=dbAdapter.articleFormatFinancialSQL!(),hooks=createFiscalFormatHooks();
 const transport:FormatTransport={async request(path,body){auth.assertCurrent();need(path.startsWith('/api/sync/')&&!path.includes('..'));const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);try{const response=await fetch(new URL(path,auth.base).toString(),{method:body===undefined?'GET':'POST',headers:{...auth.headers,'X-Article-Formats-Contract':'2','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'error'});const value=await response.json();auth.assertCurrent();if(!response.ok)throw Error(value?.code||'FISCAL_WORKFLOW_FORMAT_NETWORK_UNAVAILABLE');return value;}finally{clearTimeout(timer);}}};
 const runtime=await prepareArticleFormatsAdaptersV2(sql,transport,terminalId,hooks);
 await runtime.masters.download();const capture=await captureInventoryV2(sql,runtime.context),download=await downloadInventoryV2(transport,capture);
 await installInventoryV2(sql,capture,download,async(_tx,c)=>{auth.assertCurrent();need(c.authority_hash===runtime.context.authority_hash);});
 need((await runtime.readiness()).ready);auth.assertCurrent();
 const assertCurrent=async()=>{auth.assertCurrent();need((await runtime.readiness()).ready);};
 return {...runtime,sql,hooks,assertCurrent,
  async commitSale(input:{checkout:FiscalWorkflowCheckoutV2;lines:CartItem[];ncfType:FiscalDocumentCode;buyer:Record<string,unknown>;customerId?:string;payments:Transaction['payments'];seriesId:string;userId:string;userName:string}){
   await assertCurrent();const checkout=input.checkout,p=checkout.permit;need(p?.operationKind==='SALE','FISCAL_WORKFLOW_REFERENCED_PERMIT_REQUIRED');const permit=p!,issuance=await quoteFormatFiscalIssuance(sql,runtime.context,input.ncfType);
   const birth={schemaVersion:2 as const,checkoutId:checkout.checkoutId,transactionId:checkout.transactionId,permitId:permit.permitId,nonce:permit.nonce};
   const prepared=await prepareFormatSaleFinancialCommit({masters:runtime.masters,context:runtime.context,options:{seriesId:input.seriesId,userId:input.userId,userName:input.userName},permit,birth,eventId:createUuid(),occurredAt:new Date().toISOString(),fiscalIssuance:issuance as any,buyer:input.buyer,customerId:input.customerId,lines:input.lines.map(l=>({lineId:l.cartId,itemId:l.id,variantId:l.articleFormat?.variantId||null,tariffId:l.v3SaleAuthority?.tariffId||'',formatId:l.articleFormat?.id||null,quantity:String(l.quantity),discountRate:String(l.discountRate||0)})),payments:input.payments.map(p=>({payment_id:p.id!,method:String(p.method).toLowerCase() as any,amount:Math.abs(p.amount).toFixed(2)}))});
   const result=await commitFormatOwnedTransaction(sql,runtime.masters,prepared,hooks) as Transaction;void runtime.drain().catch(()=>undefined);return result;
  },
  async commitReturn(input:{original:Transaction;items:CartItem[];kind:'RETURN'|'VOID';modificationCode:'1'|'2'|'3';payments:WireEventV2['payments'];seriesId:string;userId:string;userName:string}){
   await assertCurrent();const original=validateWireEventV2((input.original as any).articleFormatWire),state=await fiscalWorkflowV2Client.consult(input.original.id),ack=(input.original as any).articleFormatACK;
   need(await verifyFiscalWorkflowState(input.original,state)&&state.sourceKind==='FORMAT_SOURCE_V2'&&state.signature&&['ACCEPTED','ACCEPTED_CONDITIONAL'].includes(state.decision)&&ack?.document_id===state.documentId&&typeof state.documentDate==='string'&&/^\d{4}-\d\d-\d\d$/.test(state.documentDate),'FISCAL_WORKFLOW_ORIGINAL_SIGNED_REQUIRED');
   const reference={documentId:ack.document_id,transactionId:input.original.id,ncf:state.ncf,issuerRnc:state.issuerRnc,environment:state.environment as 0|1|2,sourceChecksum:state.originalDigestV2};
   const identity=JSON.stringify({kind:input.kind,original:reference,items:input.items.map(l=>[l.cartId,Math.abs(l.quantity)]),modificationCode:input.modificationCode});const checkout=await fiscalWorkflowV2Client.reserveReferencedCheckout(identity,input.kind,reference);
   if(checkout.phase==='COMMITTED'){const saved=await dbAdapter.getDocument<Transaction>('transactionHistory',checkout.transactionId);need(saved);return saved!;}
   const permit=checkout.permit!;const issuance=await quoteFormatFiscalIssuance(sql,runtime.context,'E34');
   const rows=await sql.query<{original:string}>("SELECT content AS original FROM article_format_outbox WHERE tenant_id=? AND company_id=? AND json_extract(content,'$.source_event_id')=?",[runtime.context.scope.tenantId,runtime.context.scope.companyId,original.event_id]);
   const prepared=prepareFormatReturnFinancialCommit({original:{...original,fiscal:{...original.fiscal,buyer_snapshot:state.buyer}},priorReturns:rows.map(r=>JSON.parse(r.original)),context:runtime.context,options:{seriesId:input.seriesId,userId:input.userId,userName:input.userName},permit:permit as any,birth:{schemaVersion:2,permitId:permit.permitId,transactionId:permit.transactionId,nonce:permit.nonce,checkoutId:checkout.checkoutId},eventId:createUuid(),occurredAt:new Date().toISOString(),fiscalIssuance:issuance as any,creditNoteReference:{affected_ncf:state.ncf,affected_date:state.documentDate!,modification_code:input.modificationCode},quantities:input.items.map(l=>({sourceLineId:l.cartId,quantity:String(Math.abs(l.quantity)),lineId:createUuid()})),payments:input.payments});
   const result=await commitFormatOwnedTransaction(sql,runtime.masters,prepared,hooks) as Transaction;await fiscalWorkflowV2Client.acknowledge(checkout);void runtime.drain().catch(()=>undefined);return result;
  }
 };
}
