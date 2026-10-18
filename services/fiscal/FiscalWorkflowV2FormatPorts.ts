import type {BusinessConfig,FiscalAllocation,FiscalDocumentCode,FiscalRangeDGII,LocalFiscalBuffer,Transaction} from '../../types';
import {snapshotFiscalIssuance} from '../../utils/fiscalIssuance';
import {formatFiscalNumber} from '../../utils/fiscalNumber';
import {validateFiscalBufferReservation} from '../../utils/fiscalBufferAuthority';
import {planNativeFiscalReceipt} from '../db/NativeFiscalReservation';
import {consumeFiscalWorkflowBirth} from '../db/FiscalWorkflowV2Store';
import {captureFiscalStatusBoundContext} from './FiscalBoundContext';
import {canonicalContent,type FormatSQL} from '../articleFormats/store';
import type {NetworkContextV2,WireEventV2} from '../articleFormats/v2';
import type {FormatPostingV2Hooks} from '../articleFormats/financialV2';
const need=(ok:unknown,code='FISCAL_WORKFLOW_FORMAT_AUTHORITY_REQUIRED'):void=>{if(!ok)throw Error(code);};
async function authority(sql:FormatSQL,context:NetworkContextV2,type:FiscalDocumentCode){
 const read=async<T>(collection:string,id:string):Promise<T>=>{const rows=await sql.query<{data:string}>('SELECT data FROM documents WHERE collection_name=? AND doc_id=?',[collection,id]);need(rows.length===1);return JSON.parse(rows[0].data);};
 const config=await read<BusinessConfig>('config','current'),buffers=await sql.query<{data:string}>("SELECT data FROM documents WHERE collection_name='localFiscalBuffer' AND json_extract(data,'$.terminalId')=? AND json_extract(data,'$.type')=? LIMIT 2",[context.scope.terminalId,type]);need(buffers.length===1);const buffer=JSON.parse(buffers[0].data) as LocalFiscalBuffer;
 const allocation=await read<FiscalAllocation>('fiscalAllocations',buffer.allocationId!),range=await read<FiscalRangeDGII>('fiscalRanges',buffer.fiscalRangeId!),ncf=formatFiscalNumber(type,buffer.prefix,buffer.currentNumber);
 const next=validateFiscalBufferReservation({business:config,terminalId:context.scope.terminalId,type,ncf,buffer,allocation,range});
 const issuance=snapshotFiscalIssuance(config,range,allocation,buffer,ncf);
 need(issuance.tenantId===context.scope.tenantId&&issuance.companyId===context.scope.companyId,'FISCAL_WORKFLOW_SCOPE_MISMATCH');return {config,buffer,next,issuance};
}
/** Read-only quotation; the exact buffer is checked and consumed only inside the format financial writer. */
export async function quoteFormatFiscalIssuance(sql:FormatSQL,context:NetworkContextV2,type:FiscalDocumentCode){
 need(sql.runExclusive,'FISCAL_WORKFLOW_NATIVE_REQUIRED');return sql.runExclusive!(async tx=>(await authority(tx,context,type)).issuance);
}
/** Reserve only a missing or exhausted local subpool through the existing fiscal allocator. No NCF is consumed here. */
export async function prepareFormatFiscalBuffer(sql:FormatSQL,context:NetworkContextV2,type:FiscalDocumentCode,reserve?:()=>Promise<LocalFiscalBuffer|null>){
 const rows=await sql.query<{data:string}>("SELECT data FROM documents WHERE collection_name='localFiscalBuffer' AND json_extract(data,'$.terminalId')=? AND json_extract(data,'$.type')=? LIMIT 2",[context.scope.terminalId,type]);
 need(rows.length<=1,'FISCAL_WORKFLOW_FORMAT_AUTHORITY_REQUIRED');const buffer=rows.length?JSON.parse(rows[0].data) as LocalFiscalBuffer:null;
 if(buffer){need(Number.isSafeInteger(buffer.currentNumber)&&Number.isSafeInteger(buffer.endNumber),'FISCAL_WORKFLOW_FORMAT_AUTHORITY_REQUIRED');if(buffer.currentNumber<=buffer.endNumber)return;}
 const allocated=await (reserve?reserve():(await import('../../utils/db')).db.requestFiscalBatch(context.scope.terminalId,type,1));need(allocated,'FISCAL_WORKFLOW_NCF_ALLOCATION_REQUIRED');
}
/** Retain the approved payment receipt and consume its native intent inside the format financial transaction. */
export async function preserveFormatPaymentReceipts(tx:FormatSQL,event:WireEventV2,transaction:Record<string,unknown>,input:Transaction['payments']){
 const retained=transaction.payments as Transaction['payments'];need(Array.isArray(retained)&&retained.length===input.length,'PAYMENT_INTENT_RECONCILIATION_REQUIRED');
 for(const wire of event.payments){
  const matches=input.filter(p=>p.id===wire.payment_id),saved=retained.filter(p=>p.id===wire.payment_id);need(matches.length===1&&saved.length===1,'PAYMENT_INTENT_RECONCILIATION_REQUIRED');const payment=matches[0],applied=Number(payment.amountApplied??payment.appliedAmount??payment.amount);
  need(Number.isFinite(applied)&&applied===Number(wire.amount)&&String(payment.method).toLowerCase()===wire.method&&(!payment.currencyCode||payment.currencyCode==='DOP'),'PAYMENT_INTENT_RECONCILIATION_REQUIRED');
  if(payment.gatewayProvider||payment.paymentIntentId){
   need(payment.paymentIntentId&&payment.gatewayIntegrationId&&payment.gatewayStatus==='APPROVED'&&payment.gatewayTransactionType==='SALE','PAYMENT_INTENT_RECONCILIATION_REQUIRED');
   const intents=await tx.query<Record<string,any>>('SELECT * FROM payment_intents_v2 WHERE intent_id=?',[payment.paymentIntentId!]);const intent=intents[0];
   need(intents.length===1&&intent.transaction_id===event.transaction_id&&intent.payment_id===payment.id&&intent.status==='AUTHORIZED'&&intent.provider===payment.gatewayProvider&&intent.integration_id===payment.gatewayIntegrationId&&intent.currency_code==='DOP'&&Number(intent.amount)===applied&&String(intent.provider_reference||'')===String(payment.gatewayReference||'')&&String(intent.authorization_code||'')===String(payment.gatewayAuthorizationCode||''),'PAYMENT_INTENT_RECONCILIATION_REQUIRED');
   await tx.executeAtomic([{statement:"UPDATE payment_intents_v2 SET status='COMMITTED',committed_at=?,updated_at=?,last_error=NULL WHERE intent_id=? AND transaction_id=? AND status='AUTHORIZED'",values:[event.occurred_at,event.occurred_at,payment.paymentIntentId!,event.transaction_id]}]);const changes=await tx.query<{n:number}>('SELECT changes() n',[]);need(changes[0]?.n===1,'PAYMENT_INTENT_RECONCILIATION_REQUIRED');
  }
  const authority={...saved[0]};Object.assign(saved[0],JSON.parse(JSON.stringify(payment)),authority,{amountOriginal:payment.amountOriginal??payment.amount,amountApplied:applied,appliedAmount:applied});
 }
}
export function createFiscalFormatHooks(readAuth=captureFiscalStatusBoundContext):FormatPostingV2Hooks{
 const current=(context:NetworkContextV2,event:WireEventV2)=>{const auth=readAuth();auth.assertCurrent();need(Date.parse(context.session_expires_at)>Date.now(),'FISCAL_WORKFLOW_SESSION_EXPIRED');for(const k of ['tenantId','companyId','storeId','terminalId','deviceId'] as const)need(auth.descriptor[k]===context.scope[k]&&event.fiscal.permit.scope[k]===context.scope[k],'FISCAL_WORKFLOW_SCOPE_MISMATCH');need(event.fiscal.permit.authorityHash===context.authority_hash);return auth;};
 return {
  async validateAuthority(_tx,context,event){current(context,event);},
  async consumeFiscalPermit(tx,birth,event,transaction){
   const permit=event.fiscal.permit,context={scope:{...permit.scope}} as NetworkContextV2;
   const active=await tx.query<{context:string}>(`SELECT s.context FROM article_format_network_active a JOIN article_format_network_sessions s USING(tenant_id,company_id,terminal_id,sync_id) WHERE a.tenant_id=? AND a.company_id=? AND a.terminal_id=? AND s.state='COMPLETE'`,[permit.scope.tenantId,permit.scope.companyId,permit.scope.terminalId]);need(active.length===1);const bound=JSON.parse(active[0].context) as NetworkContextV2,auth=current(bound,event);
   const f=await authority(tx,context,event.fiscal.ncf_type as FiscalDocumentCode),{capturedAt:_expected,...expected}=event.fiscal.fiscal_issuance,{capturedAt:_actual,...actual}=f.issuance;
   need(canonicalContent(actual)===canonicalContent(expected),'FISCAL_WORKFLOW_NCF_CHANGED');
   const receipt=await planNativeFiscalReceipt(tx.query,f.config,f.buffer,event.fiscal.ncf,{requireIssuer:true,eventId:event.event_id,transactionId:event.transaction_id,occurredAt:event.occurred_at});
   const connection={query:async(q:string,v:any[]=[])=>({values:await tx.query(q,v)}),run:async(q:string,v:any[]=[])=>tx.executeAtomic([{statement:q,values:v}]),execute:async()=>{throw Error('FISCAL_WORKFLOW_NESTED_TRANSACTION_FORBIDDEN');}};
   await consumeFiscalWorkflowBirth(connection,{checkoutId:birth.checkoutId,transactionId:birth.transactionId,birth},transaction as unknown as Transaction);
   await tx.executeAtomic([{statement:'INSERT INTO article_format_wire_write_scope VALUES(1)'},receipt.statement,{statement:"UPDATE documents SET data=?,updatedAt=? WHERE collection_name='localFiscalBuffer' AND doc_id=? AND data=?",values:[JSON.stringify(f.next),event.occurred_at,f.buffer.id,JSON.stringify(f.buffer)]}]);
   const changed=await tx.query<{n:number}>('SELECT changes() n',[]);need(Number(changed[0]?.n)===1,'FISCAL_WORKFLOW_NCF_CHANGED');await tx.executeAtomic([{statement:'DELETE FROM article_format_wire_write_scope WHERE id=1'}]);auth.assertCurrent();
  },
 };
}
