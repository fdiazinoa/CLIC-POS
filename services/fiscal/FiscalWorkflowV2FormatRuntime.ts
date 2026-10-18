import {dbAdapter} from '../db';
import type {Transaction,CartItem,FiscalDocumentCode} from '../../types';
import {captureFiscalStatusBoundContext} from './FiscalBoundContext';
import {createFiscalFormatHooks,quoteFormatFiscalIssuance,prepareFormatFiscalBuffer} from './FiscalWorkflowV2FormatPorts';
import {prepareArticleFormatsAdaptersV2} from '../articleFormats/runtime';
import {captureInventoryV2,downloadInventoryV2,installInventoryV2} from '../articleFormats/inventoryV2';
import {prepareFormatSaleFinancialCommit,prepareFormatReturnFinancialCommit,commitFormatOwnedTransaction,returnWireLineV2} from '../articleFormats/financialV2';
import {validateWireEventV2,type WireEventV2} from '../articleFormats/v2';
import type {FormatTransport} from '../articleFormats/wire';
import {createUuid} from '../../utils/uuid';
import {fiscalWorkflowV2Client,verifyFiscalWorkflowState} from './FiscalWorkflowV2Client';
import type {FiscalWorkflowCheckoutV2,FiscalWorkflowPermitV2} from './FiscalWorkflowV2Types';
export const formatWirePermit=(p:FiscalWorkflowPermitV2)=>({schemaVersion:p.schemaVersion,permitId:p.permitId,transactionId:p.transactionId,nonce:p.nonce,createdAt:p.createdAt,expiresAt:p.expiresAt,scope:{...p.scope},issuerRnc:p.issuerRnc,environment:p.environment,authorityHash:p.authorityHash,operationKind:p.operationKind,...(p.originalReference?{originalReference:{...p.originalReference}}:{})});
const need=(ok:unknown,code='FISCAL_WORKFLOW_FORMAT_NOT_READY'):void=>{if(!ok)throw Error(code);};
export async function prepareFiscalFormatRuntime(terminalId:string){
 need(fiscalWorkflowV2Client.enabled(),'FISCAL_WORKFLOW_DISABLED');const auth=captureFiscalStatusBoundContext();auth.assertCurrent();need(dbAdapter.articleFormatFinancialSQL,'FISCAL_WORKFLOW_NATIVE_REQUIRED');const sql=dbAdapter.articleFormatFinancialSQL!(),hooks=createFiscalFormatHooks();
 const transport:FormatTransport={async request(path,body){auth.assertCurrent();need(path.startsWith('/api/sync/')&&!path.includes('..'));const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);try{const response=await fetch(new URL(path,auth.base).toString(),{method:body===undefined?'GET':'POST',headers:{...auth.headers,'X-Article-Formats-Contract':'2','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'error'});const value=await response.json();auth.assertCurrent();if(!response.ok)throw Error(value?.code||'FISCAL_WORKFLOW_FORMAT_NETWORK_UNAVAILABLE');return value;}finally{clearTimeout(timer);}}};
 const runtime=await prepareArticleFormatsAdaptersV2(sql,transport,terminalId,hooks);
 await runtime.masters.download();const capture=await captureInventoryV2(sql,runtime.context),download=await downloadInventoryV2(transport,capture);
 await installInventoryV2(sql,capture,download,async(_tx,c)=>{auth.assertCurrent();need(c.authority_hash===runtime.context.authority_hash);});
 need((await runtime.readiness()).ready);auth.assertCurrent();
 const assertCurrent=async()=>{auth.assertCurrent();need((await runtime.readiness()).ready);};
 const prepareIssuance=async(type:FiscalDocumentCode)=>{await assertCurrent();await prepareFormatFiscalBuffer(sql,runtime.context,type);auth.assertCurrent();};
 return {...runtime,sql,hooks,assertCurrent,prepareIssuance,
  async commitSale(input:{checkout:FiscalWorkflowCheckoutV2;lines:CartItem[];ncfType:FiscalDocumentCode;buyer:Record<string,unknown>;customerId?:string;payments:Transaction['payments'];seriesId:string;userId:string;userName:string}){
   await assertCurrent();const checkout=input.checkout,p=checkout.permit;need(p?.operationKind==='SALE','FISCAL_WORKFLOW_REFERENCED_PERMIT_REQUIRED');await prepareIssuance(input.ncfType);const permit=formatWirePermit(p!),issuance=await quoteFormatFiscalIssuance(sql,runtime.context,input.ncfType);
   const birth={schemaVersion:2 as const,checkoutId:checkout.checkoutId,transactionId:checkout.transactionId,permitId:permit.permitId,nonce:permit.nonce};
   const prepared=await prepareFormatSaleFinancialCommit({masters:runtime.masters,context:runtime.context,options:{seriesId:input.seriesId,userId:input.userId,userName:input.userName},permit,birth,eventId:createUuid(),occurredAt:new Date().toISOString(),fiscalIssuance:issuance as any,buyer:input.buyer,customerId:input.customerId,lines:input.lines.map(l=>({lineId:l.cartId,itemId:l.id,variantId:l.articleFormat?.variantId||null,tariffId:l.v3SaleAuthority?.tariffId||'',formatId:l.articleFormat?.id||null,quantity:String(l.quantity),discountRate:String(l.discountRate||0)})),payments:input.payments.map(p=>({payment_id:p.id!,method:String(p.method).toLowerCase() as any,amount:Math.abs(p.amount).toFixed(2)}))});
   const result=await commitFormatOwnedTransaction(sql,runtime.masters,prepared,hooks) as Transaction;void runtime.drain().catch(()=>undefined);return result;
  },
  async commitReturn(input:{operationId:string;original:Transaction;items:CartItem[];kind:'RETURN'|'VOID';modificationCode:'1'|'2'|'3';payments:WireEventV2['payments'];seriesId:string;userId:string;userName:string}){
   await assertCurrent();const original=validateWireEventV2((input.original as any).articleFormatWire),state=await fiscalWorkflowV2Client.consult(input.original.id),ack=(input.original as any).articleFormatACK;
   need(await verifyFiscalWorkflowState(input.original,state)&&state.sourceKind==='FORMAT_SOURCE_V2'&&state.signature&&['ACCEPTED','ACCEPTED_CONDITIONAL'].includes(state.decision)&&ack?.document_id===state.documentId&&typeof state.documentDate==='string'&&/^\d{4}-\d\d-\d\d$/.test(state.documentDate),'FISCAL_WORKFLOW_ORIGINAL_SIGNED_REQUIRED');
   const reference={documentId:ack.document_id,transactionId:input.original.id,ncf:state.ncf,issuerRnc:state.issuerRnc,environment:state.environment as 0|1|2,sourceChecksum:state.originalDigestV2};
   const identity=JSON.stringify({kind:input.kind,original:reference,items:input.items.map(l=>[l.cartId,Math.abs(l.quantity)]),modificationCode:input.modificationCode});const checkout=await fiscalWorkflowV2Client.reserveReferencedCheckout(identity,input.kind,reference,input.operationId);
   if(['COMMITTED','ACKNOWLEDGED'].includes(checkout.phase)){const saved=await dbAdapter.getDocument<Transaction>('transactionHistory',checkout.transactionId);need(saved);return saved!;}
   await prepareIssuance('E34');const permit=formatWirePermit(checkout.permit!);const issuance=await quoteFormatFiscalIssuance(sql,runtime.context,'E34');
   const rows=await sql.query<{original:string}>("SELECT content AS original FROM article_format_outbox WHERE tenant_id=? AND company_id=? AND json_extract(content,'$.source_event_id')=?",[runtime.context.scope.tenantId,runtime.context.scope.companyId,original.event_id]);
   const prior=rows.map(r=>validateWireEventV2(JSON.parse(r.original)));const quoted=input.items.map(item=>{const line=original.lines.find(line=>line.line_id===item.cartId);need(line,'FISCAL_WORKFLOW_ORIGINAL_UNIDENTIFIED');return returnWireLineV2(line!,prior.flatMap(e=>e.lines).filter(line=>line.source_line_id===item.cartId),String(Math.abs(item.quantity)),createUuid());});
   const quotedTotal=quoted.reduce((sum,line)=>sum+Number(line.total_amount),0),payments=input.payments.length?input.payments:[{payment_id:createUuid(),method:'cash' as const,amount:quotedTotal.toFixed(2)}];
   const prepared=prepareFormatReturnFinancialCommit({original:{...original,fiscal:{...original.fiscal,buyer_snapshot:state.buyer}},priorReturns:prior,context:runtime.context,options:{seriesId:input.seriesId,userId:input.userId,userName:input.userName},permit:permit as any,birth:{schemaVersion:2,permitId:permit.permitId,transactionId:permit.transactionId,nonce:permit.nonce,checkoutId:checkout.checkoutId},eventId:createUuid(),occurredAt:new Date().toISOString(),fiscalIssuance:issuance as any,creditNoteReference:{affected_ncf:state.ncf,affected_date:state.documentDate!,modification_code:input.modificationCode},quantities:input.items.map(l=>({sourceLineId:l.cartId,quantity:String(Math.abs(l.quantity)),lineId:createUuid()})),payments});
   const result=await commitFormatOwnedTransaction(sql,runtime.masters,prepared,hooks) as Transaction;await fiscalWorkflowV2Client.acknowledge(checkout);void runtime.drain().catch(()=>undefined);return result;
  }
 };
}
