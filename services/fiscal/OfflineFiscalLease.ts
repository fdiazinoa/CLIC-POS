import type {FiscalWorkflowScope,FiscalWorkflowPermitV2} from './FiscalWorkflowV2Types';
import {fiscalWorkflowScopeKey} from './FiscalWorkflowV2Types';
import {sha256Utf8} from '../sync/LargeMasterSyncV3Client';
export interface OfflineFiscalLease {
 contractVersion:1;authorizationKind:'OFFLINE_FISCAL_LEASE_V1';leaseId:string;scope:FiscalWorkflowScope;
 issuerRnc:string;provider:'MSELLER';environment:0|1|2;issuedAt:string;validUntil:string;
 authorityHash:string;saleCapacity:number;bindingFingerprint:string;
}
export interface OfflineFiscalLocalAuthority {scope:FiscalWorkflowScope;bindingHash:string;issuerRnc:string;environment:0|1|2}
export interface TableFiscalSaleContext {schemaVersion:1;kind:'TABLE_ACCOUNT';accountId:string;tableId:string;sourceSha256:string}
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export const offlineFiscalFail=(code='OFFLINE_FISCAL_LEASE_INVALID'):never=>{throw Error(code);};
export function validateOfflineFiscalLease(value:OfflineFiscalLease,authority:OfflineFiscalLocalAuthority):void {
 if(!value||!value.scope||typeof value.scope!=='object'||Object.values(value.scope).some(v=>typeof v!=='string'||!v)||value.contractVersion!==1||value.authorizationKind!=='OFFLINE_FISCAL_LEASE_V1'||!uuid(value.leaseId)
  ||fiscalWorkflowScopeKey(value.scope)!==fiscalWorkflowScopeKey(authority.scope)||value.issuerRnc!==authority.issuerRnc
  ||value.provider!=='MSELLER'||value.environment!==authority.environment||!hash(value.authorityHash)||!hash(value.bindingFingerprint)
  ||!Number.isSafeInteger(value.saleCapacity)||value.saleCapacity<1||value.saleCapacity>4096
  ||!Number.isFinite(Date.parse(value.issuedAt))||!Number.isFinite(Date.parse(value.validUntil))
  ||Date.parse(value.validUntil)<=Date.parse(value.issuedAt)||Date.parse(value.validUntil)-Date.parse(value.issuedAt)>7*86400000)offlineFiscalFail();
}
export function validateOfflineFiscalPermit(permit:FiscalWorkflowPermitV2,lease:OfflineFiscalLease):void {
 if(!permit||!permit.scope||permit.schemaVersion!==2||!uuid(permit.permitId)||!uuid(permit.transactionId)||!permit.nonce
  ||permit.leaseId!==lease.leaseId||permit.operationKind!=='SALE'||permit.originalReference!==undefined
  ||permit.state&&permit.state!=='PERMIT'||fiscalWorkflowScopeKey(permit.scope)!==fiscalWorkflowScopeKey(lease.scope)
  ||permit.issuerRnc!==lease.issuerRnc||permit.environment!==lease.environment||permit.authorityHash!==lease.authorityHash
  ||!Number.isFinite(Date.parse(permit.createdAt))||!Number.isFinite(Date.parse(permit.expiresAt))
  ||Date.parse(permit.createdAt)<Date.parse(lease.issuedAt)||Date.parse(permit.createdAt)>=Date.parse(lease.validUntil)||Date.parse(permit.expiresAt)!==Date.parse(lease.validUntil))offlineFiscalFail();
}
export function validateTableFiscalSaleContext(context:TableFiscalSaleContext):void {
 if(!context||Object.keys(context).sort().join(',')!=='accountId,kind,schemaVersion,sourceSha256,tableId'
  ||context.schemaVersion!==1||context.kind!=='TABLE_ACCOUNT'||!context.accountId?.trim()||!context.tableId?.trim()||!hash(context.sourceSha256))offlineFiscalFail('OFFLINE_FISCAL_TABLE_SOURCE_REQUIRED');
}
export const tableFiscalSourceDigest=(sourceLiteral:string)=>sha256Utf8(sourceLiteral);
