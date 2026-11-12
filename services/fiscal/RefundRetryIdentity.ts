import type { CartItem, RefundProcessingOptions, Transaction } from '../../types';
import { sha256Utf8 } from '../sync/LargeMasterSyncV3Client';

const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])])) : value;

/** The original's committed refund frontier separates two legitimate, identical partial returns.
 * Transient timestamps, catalog refreshes and sync flags never create a new attempt. */
export const refundRetryScopeKey=(scope:unknown)=>sha256Utf8(JSON.stringify(canonical(scope)));

export async function refundRetryIdentity(scope: unknown, original: Transaction, items: CartItem[],
  conditions: Map<string, 'SELLABLE' | 'DAMAGED'>, reason: string, options: RefundProcessingOptions) {
  const payments=options.refundPayments?.map(({timestamp, ...payment}) => payment);
  const identity={version:1,scope,originalId:original.id,
    frontier:[...new Set(original.relatedTransactions || [])].sort(),
    remoteDocument:original.erpRefundSource ? options.erpRefundAuthority?.documentAuthority : undefined};
  const scopeKey=await sha256Utf8(JSON.stringify(canonical(scope)));
  const key=await sha256Utf8(JSON.stringify(canonical(identity)));
  const fingerprint=await sha256Utf8(JSON.stringify(canonical({identity,
    items:items.map(item=>({cartId:item.cartId,id:item.id,quantity:Math.abs(item.quantity),price:item.price,
      discountAmount:item.discountAmount,discountRate:item.discountRate,variantSku:item.variantSku,
      condition:conditions.get(item.cartId) || 'SELLABLE'})).sort((a,b)=>a.cartId.localeCompare(b.cartId)),
    reason,payments,skipWalletDeposit:options.skipWalletDeposit === true,
    preparedAuthority:options.erpRefundAuthority || null})));
  return {key,scopeKey,fingerprint,transactionId:`NC-${key}`,operationId:`${key.slice(0,8)}-${key.slice(8,12)}-5${key.slice(13,16)}-a${key.slice(17,20)}-${key.slice(20,32)}`};
}

// Serializes standard refund callbacks, including double clicks, through fresh-source validation.
let processing: Promise<unknown> = Promise.resolve();
export function withRefundProcessingLock<T>(work:()=>Promise<T>):Promise<T> {
  const next=processing.then(work,work);
  processing=next.catch(()=>undefined);
  return next;
}
