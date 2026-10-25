import type {FiscalWorkflowScope} from './FiscalWorkflowV2Types';
import {fiscalWorkflowScopeKey} from './FiscalWorkflowV2Types';
import type {OfflineFiscalLocalAuthority} from './OfflineFiscalLease';
import {sha256Utf8} from '../sync/LargeMasterSyncV3Client';

/** Finite ERP-owned number authority. Neither session expiry nor a second sale budget is part of this contract. */
export interface OfflineFiscalAllocationMember {
 allocationId:string;fiscalRangeId:string;ncfType:string;prefix:string;padding:10;
 start:number;end:number;rangeStart:number;rangeEnd:number;expiryDate:string|null;
}
export interface OfflineFiscalAllocation {
 contractVersion:2;authorizationKind:'OFFLINE_FISCAL_ALLOCATION_V2';authorizationId:string;
 scope:FiscalWorkflowScope;issuerRnc:string;provider:'MSELLER';environment:0|1|2;
 issuedAt:string;bindingFingerprint:string;allocations:OfflineFiscalAllocationMember[];authorityHash:string;
}
export interface OfflineFiscalAllocationBirth {
 schemaVersion:3;authorizationKind:'OFFLINE_FISCAL_ALLOCATION_V2';authorizationId:string;authorityHash:string;
 transactionId:string;checkoutId:string;
}
export interface OfflineFiscalAllocationSelection {
 authorizationId:string;authorityHash:string;allocationId:string;fiscalRangeId:string;ncf:string;ncfType:string;
 sequence:number;bufferId:string;environment?:0|1|2;
}
export const allocationFail=(code='OFFLINE_FISCAL_ALLOCATION_INVALID'):never=>{throw Error(code);};
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
export const allocationHash=(value:Omit<OfflineFiscalAllocation,'authorityHash'>)=>sha256Utf8(JSON.stringify(canonical(value)));
export async function validateOfflineFiscalAllocation(value:OfflineFiscalAllocation,local:OfflineFiscalLocalAuthority):Promise<void>{
 if(!value||Object.keys(value).sort().join(',')!=='allocations,authorityHash,authorizationId,authorizationKind,bindingFingerprint,contractVersion,environment,issuedAt,issuerRnc,provider,scope'||value.contractVersion!==2||value.authorizationKind!=='OFFLINE_FISCAL_ALLOCATION_V2'||!uuid(value.authorizationId)
  ||!value.scope||Object.keys(value.scope).sort().join(',')!=='companyId,deviceId,storeId,tenantId,terminalId'
  ||Object.values(value.scope).some(v=>typeof v!=='string'||!v)||fiscalWorkflowScopeKey(value.scope)!==fiscalWorkflowScopeKey(local.scope)
  ||value.issuerRnc!==local.issuerRnc||value.environment!==local.environment||value.provider!=='MSELLER'
  ||!Number.isFinite(Date.parse(value.issuedAt))||!/^[a-f0-9]{64}$/.test(value.bindingFingerprint)
  ||!Array.isArray(value.allocations)||!value.allocations.length||value.allocations.length>128)allocationFail();
 const ids=new Set<string>();
 for(const member of value.allocations){
  if(Object.keys(member).sort().join(',')!=='allocationId,end,expiryDate,fiscalRangeId,ncfType,padding,prefix,rangeEnd,rangeStart,start'||!uuid(member.allocationId)||ids.has(member.allocationId)||!uuid(member.fiscalRangeId)||!/^E(?:31|32|34|44|45)$/.test(member.ncfType)
   ||member.prefix!==member.ncfType||member.padding!==10||![member.start,member.end,member.rangeStart,member.rangeEnd].every(Number.isSafeInteger)
   ||member.rangeStart<1||member.start<member.rangeStart||member.end<member.start||member.end>member.rangeEnd||member.rangeEnd>9999999999
   ||member.expiryDate!==null&&(!/^\d{4}-\d{2}-\d{2}$/.test(member.expiryDate)||new Date(member.expiryDate+'T00:00:00Z').toISOString().slice(0,10)!==member.expiryDate))allocationFail();
  if(value.allocations.some(other=>other!==member&&other.ncfType===member.ncfType&&other.start<=member.end&&other.end>=member.start))allocationFail();
  ids.add(member.allocationId);
 }
 const {authorityHash,...unsigned}=value;
 if(!/^[a-f0-9]{64}$/.test(authorityHash)||await allocationHash(unsigned)!==authorityHash)allocationFail();
}
/** Fiscal dates use the issuer's Dominican day, independent from WebView's device timezone. */
export const allocationFiscalDay=(time:number)=>new Date(time-4*3600000).toISOString().slice(0,10);
export function assertAllocationMemberTime(member:OfflineFiscalAllocationMember,time:number):void{
 if(member.expiryDate!==null&&allocationFiscalDay(time)>member.expiryDate)allocationFail('OFFLINE_FISCAL_RANGE_EXPIRED');
}
