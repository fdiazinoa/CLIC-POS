import type {FiscalWorkflowCheckoutV2,FiscalWorkflowPreparedRecovery} from './FiscalWorkflowV2Types';
import {fiscalWorkflowScopeKey} from './FiscalWorkflowV2Types';

export function hasPreparedSalePermit(checkout:FiscalWorkflowCheckoutV2,scopeKey:string,authorityHash?:string):boolean {
 const permit=checkout.permit,scope=permit?.scope;
 return Boolean(permit&&permit.schemaVersion===2&&permit.operationKind==='SALE'&&permit.transactionId===checkout.transactionId
  &&['permitId','transactionId','nonce'].every(key=>typeof (permit as any)[key]==='string'&&(permit as any)[key].trim())
  &&scope&&['tenantId','companyId','storeId','terminalId','deviceId'].every(key=>typeof (scope as any)[key]==='string'&&(scope as any)[key].trim())
  &&fiscalWorkflowScopeKey(scope)===scopeKey&&authorityHash&&permit.authorityHash===authorityHash
  &&/^[a-f0-9]{64}$/.test(permit.authorityHash)&&/^\d{9}(?:\d{2})?$/.test(permit.issuerRnc)
  &&[0,1,2].includes(permit.environment)&&Number.isFinite(Date.parse(permit.expiresAt))&&Date.parse(permit.expiresAt)>Date.now());
}

/** Complete local proof only: no identity can be inferred from a partial or malformed row. */
export function matchesPreparedRecovery(value: FiscalWorkflowCheckoutV2 | null, expected: FiscalWorkflowPreparedRecovery): boolean {
 if(!expected||typeof expected!=='object'||Array.isArray(expected)||!value)return false;
 const keys=['scopeKey','checkoutId','transactionId','operationId','cartIdentity'] as const;
 return expected.phase==='PREPARED'&&Array.isArray(expected.paymentIds)&&expected.paymentIds.length===0
  &&value.phase==='PREPARED'&&Array.isArray(value.paymentIds)&&value.paymentIds.length===0
  &&keys.every(key=>typeof expected[key]==='string'&&expected[key].trim().length>0&&value[key]===expected[key]);
}
