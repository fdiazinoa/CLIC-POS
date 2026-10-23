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
 // A retained attempt selects its birth kind before any new-authority availability probe.
 // In particular, a newly downloaded/revoked V2 grant cannot replace a historical V1 paid intent.
 if(current?.phase==='EFFECT_POSSIBLE'&&!current.paymentIds.length)throw new LargeMasterSyncV3Error('FISCAL_WORKFLOW_CHECKOUT_RECONCILIATION_REQUIRED');
 if(current&&['PREPARED','EFFECT_POSSIBLE'].includes(current.phase)&&(current.allocation||current.permit?.leaseId||current.paymentIds.length)){
  if(current.offlineBindingHash!==authority.bindingHash)throw new LargeMasterSyncV3Error('FISCAL_WORKFLOW_CHECKOUT_RECONCILIATION_REQUIRED');
  const possible=current.phase==='EFFECT_POSSIBLE'&&current.paymentIds.length>0;
  if(current.allocation){
   if(current.permit?.leaseId||!store.allocationDraft)throw new LargeMasterSyncV3Error('FISCAL_WORKFLOW_CHECKOUT_RECONCILIATION_REQUIRED');
   await store.allocationDraft(current);
   return {identity,...(possible?{recovery:{checkoutId:current.checkoutId,transactionId:current.transactionId,authorizationId:current.allocation.authorizationId,cartIdentity:current.cartIdentity,paymentIds:current.paymentIds}}:{})};
  }
  if(current.permit?.leaseId){
   const lease=await store.offlineLease(authority,possible,current.permit.leaseId),effectAt=Date.parse(current.offlineEffectAt||'');
   if(lease?.leaseId===current.permit.leaseId&&(!possible||Number.isFinite(effectAt)&&effectAt>=Date.parse(lease.issuedAt)&&effectAt<Date.parse(lease.validUntil)))return {identity,...(possible?{recovery:{checkoutId:current.checkoutId,transactionId:current.transactionId,leaseId:lease.leaseId,cartIdentity:current.cartIdentity,paymentIds:current.paymentIds}}:{})};
  }
  throw new LargeMasterSyncV3Error('FISCAL_WORKFLOW_CHECKOUT_RECONCILIATION_REQUIRED');
 }
 if(await store.allocationAvailability?.(authority))return {identity};
 if(await store.offlineLease(authority))return {identity};
 throw new LargeMasterSyncV3Error('SYNC_V3_OFFLINE_AUTHORITY_REQUIRED');
}
