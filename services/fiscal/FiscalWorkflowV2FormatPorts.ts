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
