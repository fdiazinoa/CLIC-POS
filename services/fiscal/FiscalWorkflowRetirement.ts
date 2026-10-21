import type {FiscalRetirementProof,FiscalRetirementReceipt,FiscalWorkflowCheckoutV2,FiscalWorkflowScope} from './FiscalWorkflowV2Types';
import {fiscalWorkflowScopeKey} from './FiscalWorkflowV2Types';
import {originalDigest} from '../recovery/OriginalCodec';

export const retirementReason='EXPIRED_PREPARED_NO_EFFECTS' as const;
export const retirementFail=():never=>{throw Error('FISCAL_WORKFLOW_RETIREMENT_RECONCILIATION_REQUIRED');};
export const isRetirementUuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const cartDigest=(identity:string)=>originalDigest(new TextEncoder().encode(identity));
export function validateRetirementProof(proof:FiscalRetirementProof):void {
 if(!proof||proof.schemaVersion!==1||proof.reason!==retirementReason||!['commandId','checkoutId','permitId','transactionId','originalOperationId'].every(k=>isRetirementUuid((proof as any)[k]))||!/^[a-f0-9]{64}$/.test(proof.cartIdentitySha256))retirementFail();
}
export function validateRetirementReceipt(receipt:FiscalRetirementReceipt,proof:FiscalRetirementProof,scope:FiscalWorkflowScope):void {
 validateRetirementProof(receipt);
 const keys=['schemaVersion','commandId','checkoutId','permitId','transactionId','originalOperationId','cartIdentitySha256','reason','scope','state','closedAt','historyId'];
 if(Object.keys(receipt).length!==keys.length||keys.some(k=>!Object.hasOwn(receipt,k))||receipt.state!=='HELD'||!isRetirementUuid(receipt.historyId)||!Number.isFinite(Date.parse(receipt.closedAt))
   ||fiscalWorkflowScopeKey(receipt.scope)!==fiscalWorkflowScopeKey(scope)||Object.keys(proof).some(k=>(receipt as any)[k]!== (proof as any)[k]))retirementFail();
}
export function isExpiredPrepared(checkout:FiscalWorkflowCheckoutV2|null,scopeKey:string):checkout is FiscalWorkflowCheckoutV2 {
 const p=checkout?.permit;
 return Boolean(checkout&&checkout.phase==='PREPARED'&&Array.isArray(checkout.paymentIds)&&checkout.paymentIds.length===0&&checkout.scopeKey===scopeKey
  &&isRetirementUuid(checkout.checkoutId)&&isRetirementUuid(checkout.operationId)&&isRetirementUuid(checkout.transactionId)&&typeof checkout.cartIdentity==='string'&&checkout.cartIdentity.length>0
  &&p?.schemaVersion===2&&p.operationKind==='SALE'&&p.originalReference===undefined&&p.transactionId===checkout.transactionId&&isRetirementUuid(p.permitId)
  &&typeof p.nonce==='string'&&p.nonce.length>0&&p.nonce.length<=100&&fiscalWorkflowScopeKey(p.scope)===scopeKey
  &&Number.isFinite(Date.parse(p.expiresAt))&&Date.parse(p.expiresAt)<=Date.now());
}
