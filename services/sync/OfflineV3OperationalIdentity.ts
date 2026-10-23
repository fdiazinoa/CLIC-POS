import {resolveSyncTarget} from './SyncProfile';
import {readOfflineFiscalLocalAuthority} from '../fiscal/OfflineFiscalLeaseContext';
import {validatedLargeMasterSyncV3ErpSyncBase,type LargeMasterSyncV3BoundIdentity} from './LargeMasterSyncV3BoundTransport';
import {fiscalWorkflowScopeKey} from '../fiscal/FiscalWorkflowV2Types';
import {LargeMasterSyncV3Error} from './LargeMasterSyncV3Types';
export type V3LocalOperationalIdentity=Omit<LargeMasterSyncV3BoundIdentity,'syncToken'>&{syncToken?:string};
export interface V3OfflineOperationalAuthority {identity:V3LocalOperationalIdentity;recovery?:{checkoutId:string;transactionId:string;leaseId?:string;authorizationId?:string;cartIdentity:string;paymentIds:string[]}}

/** Cached native operation only. This identity can never be passed to an HTTP transport. */
export async function readOfflineV3OperationalAuthority():Promise<V3OfflineOperationalAuthority>{
 const authority=await readOfflineFiscalLocalAuthority(),target=resolveSyncTarget();
 if(target.kind!=='ERP_ACTIVE'||target.useLocalTarget||!target.baseUrl||target.terminalId!==authority.scope.terminalId)throw new LargeMasterSyncV3Error('SYNC_V3_ERP_BINDING_REQUIRED');
 const {dbAdapter}=await import('../db'),store=dbAdapter.fiscalWorkflowStore;
 if(!store?.offlineLease)throw new LargeMasterSyncV3Error('SYNC_V3_OFFLINE_AUTHORITY_REQUIRED');
 const identity={tenantId:authority.scope.tenantId,terminalId:authority.scope.terminalId,deviceId:authority.scope.deviceId,erpSyncBaseUrl:validatedLargeMasterSyncV3ErpSyncBase(target.baseUrl)};
 const current=await store.currentCheckout(fiscalWorkflowScopeKey(authority.scope));
 if(current?.allocation&&current.phase==='EFFECT_POSSIBLE'&&current.paymentIds.length&&current.offlineBindingHash===authority.bindingHash){
  await store.allocationDraft?.(current);return {identity,recovery:{checkoutId:current.checkoutId,transactionId:current.transactionId,authorizationId:current.allocation.authorizationId,cartIdentity:current.cartIdentity,paymentIds:current.paymentIds}};
 }
 if(await store.allocationAvailability?.(authority))return {identity};
 if(current?.phase==='EFFECT_POSSIBLE'&&Array.isArray(current.paymentIds)&&current.paymentIds.length>0&&current.permit?.leaseId&&current.offlineBindingHash===authority.bindingHash){
  const lease=await store.offlineLease(authority,true,current.permit.leaseId),effectAt=Date.parse(current.offlineEffectAt||'');
  if(lease&&Number.isFinite(effectAt)&&effectAt>=Date.parse(lease.issuedAt)&&effectAt<Date.parse(lease.validUntil))return {identity,recovery:{checkoutId:current.checkoutId,transactionId:current.transactionId,leaseId:lease.leaseId,cartIdentity:current.cartIdentity,paymentIds:current.paymentIds}};
 }
 if(await store.offlineLease(authority))return {identity};
 throw new LargeMasterSyncV3Error('SYNC_V3_OFFLINE_AUTHORITY_REQUIRED');
}
