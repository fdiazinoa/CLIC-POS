import {requiresProductStockAvailability} from '../../utils/productStockPolicy';
import { v3StockSource } from './LargeMasterSyncV3StockAuthority';
import type { Transaction } from '../../types';
import type { DurableDocumentMutation } from '../db/DatabaseAdapter';
import { LargeMasterSyncV3Error } from './LargeMasterSyncV3Types';

export type V3FinancialIntent = 'SALE' | 'REFUND';

/** Positive refund document quantities replenish stock; they are not sale demand. */
export const requiresV3SaleAvailability = (intent: V3FinancialIntent, trackInventory: boolean,
  productAllowsNegative: boolean, _terminalAllowsNegative?: boolean): boolean =>
  intent === 'SALE' && requiresProductStockAvailability({operationalFlags:{trackInventory,allowNegativeStock:productAllowsNegative}});

/**
 * Only listed root transport/status/presentation metadata is mutable. Nested line/customer/payment
 * status remains financial identity.
 *
 * `refundPendingErp`/`pendingRefundStatus` are local, write-once annulment-hold annotations added by
 * `markOriginalReturnPending` right before the return commit. They never carry commercial or fiscal
 * identity: the original keeps its real `status` and its `relatedTransactions` link until the ERP
 * ACKs the credit note (`settleOriginalReturnAnnulment`). Comparing them against the durable row used
 * to fail every electronic return with SYNC_V3_REFUND_ORIGINAL_CHANGED.
 */
const REFUND_SOURCE_MUTABLE_FIELDS = new Set([
  'status','updatedAt','syncStatus','syncError','cloudSyncStatus','cloudSyncError','cloudSyncedAt',
  'relatedTransactions','zReportId','_isArchived','syncStartedAt','syncRetryAfter','syncBlockedReason','syncBlockedAt','_forceSyncReplay',
  'fiscalResponseCode','fiscalSignedXml','fiscalQrCode','fiscalStatus','fiscalPreSubmitRecoveryAudit','fiscalSyncStatus','fiscalSyncError','fiscalSyncedAt','fiscalReferenceId',
  'fiscalResponseMessage','fiscalProviderStatus','fiscalCertifiedNcf','fiscalStatusProof','fiscalSubmissionScope',
  'fiscalLookupApproval','fiscalPrintScope','fiscalPrintProof','taxBreakdown','fiscalClassificationProjection','fiscalClassificationAttemptedAt','fiscalQrUrl','fiscalSecurityCode','fiscalSignedAt',
  'refundPendingErp','pendingRefundStatus',
]);
const canonicalRefundSource = (value: any): any => Array.isArray(value) ? value.map(canonicalRefundSource)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonicalRefundSource(value[key])])) : value;
const refundFinancialProjection = (transaction: Transaction): Record<string, unknown> =>
  canonicalRefundSource(Object.fromEntries(Object.entries(transaction).filter(([key]) => !REFUND_SOURCE_MUTABLE_FIELDS.has(key))));
export const refundFinancialSourceIdentity = (transaction: Transaction): string =>
  JSON.stringify(refundFinancialProjection(transaction));

/** Diagnostic only: key paths whose values still differ in financial identity (bounded, no secrets). */
export const refundFinancialSourceDiff = (expected: Transaction, captured: Transaction, limit = 20): string[] => {
  const left = refundFinancialProjection(expected), right = refundFinancialProjection(captured), out: string[] = [];
  const walk = (a: any, b: any, path: string): void => {
    if (out.length >= limit) return;
    if (a === b) return;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) { out.push(`${path}[] length ${a.length}≠${b.length}`); return; }
      for (let index = 0; index < a.length && out.length < limit; index++) walk(a[index], b[index], `${path}[${index}]`);
      return;
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const key of keys) {
        if (out.length >= limit) return;
        if (!(key in a)) out.push(`${path}.${key} only-captured=${describeRefundSourceValue(b[key])}`);
        else if (!(key in b)) out.push(`${path}.${key} only-expected=${describeRefundSourceValue(a[key])}`);
        else walk(a[key], b[key], `${path}.${key}`);
      }
      return;
    }
    out.push(`${path} expected=${describeRefundSourceValue(a)} captured=${describeRefundSourceValue(b)}`);
  };
  walk(left, right, '$');
  return out;
};
const describeRefundSourceValue = (value: unknown): string =>
  value === undefined ? 'undefined' : String(JSON.stringify(value)).slice(0, 120);

const throwRefundSourceChanged = (expected: Transaction, captured: Transaction): never => {
  try {
    if (typeof console !== 'undefined') {
      console.warn('[refund][identity] SYNC_V3_REFUND_ORIGINAL_CHANGED', refundFinancialSourceDiff(expected, captured));
    }
  } catch { /* diagnostics must never change the fail-closed decision */ }
  throw new LargeMasterSyncV3Error('SYNC_V3_REFUND_ORIGINAL_CHANGED');
};
export const assertRefundOriginalState=(source:Transaction):void=>{
  if(!['COMPLETED','PARTIAL_REFUND'].includes(source.status)) throw new LargeMasterSyncV3Error('SYNC_V3_REFUND_ORIGINAL_NOT_REFUNDABLE');
};
/** Commercial version is independent of mutable fiscal metadata. Never rebase a refund onto another refund. */
export const assertRefundCommercialVersion=(fresh:Transaction,captured:Transaction):void=>{
  const links=(row:Transaction)=>JSON.stringify([...new Set(row.relatedTransactions || [])].sort());
  if(fresh.status!==captured.status || links(fresh)!==links(captured)) throw new LargeMasterSyncV3Error('SYNC_V3_REFUND_ORIGINAL_CHANGED');
};
export const assertRefundFinancialSource = (expected: Transaction, captured: Transaction): void => {
  if (refundFinancialSourceIdentity(expected) !== refundFinancialSourceIdentity(captured)) throwRefundSourceChanged(expected, captured);
};

/** Keep the expected stored snapshot distinct from the intended refund update. */
export const buildV3RefundOriginalMutations = (
  expected: Transaction, intended: Transaction, refundId: string,
  expectedHistory: Transaction | null,
  originalCollection: 'transactions' | 'transactionHistory' = 'transactions',
): DurableDocumentMutation[] => {
  assertRefundOriginalState(expected);
  if(expectedHistory)assertRefundOriginalState(expectedHistory);
  const expectedLinks = [...new Set([...(expected.relatedTransactions || []), refundId])].sort();
  const intendedLinks = [...new Set(intended.relatedTransactions || [])].sort();
  const identityChanged = refundFinancialSourceIdentity(expected) !== refundFinancialSourceIdentity(intended);
  if (!refundId || !expected.v3Binding || !expected.v3InventoryBaseline
    || expected.v3Binding !== intended.v3Binding
    || expected.v3InventoryBaseline !== intended.v3InventoryBaseline
    || identityChanged
    || (expectedHistory !== null && (expectedHistory.id !== expected.id
      || expectedHistory.v3InventoryBaseline !== expected.v3InventoryBaseline
      || refundFinancialSourceIdentity(expectedHistory) !== refundFinancialSourceIdentity(expected)))
    || JSON.stringify(expectedLinks) !== JSON.stringify(intendedLinks)
    || ![expected.status, 'PARTIAL_REFUND', 'REFUNDED'].includes(intended.status)) {
    if (identityChanged) throwRefundSourceChanged(expected, intended);
    throw new LargeMasterSyncV3Error('SYNC_V3_REFUND_ORIGINAL_CHANGED');
  }
  const baseline: unknown = JSON.parse(expected.v3InventoryBaseline);
  if (!Array.isArray(baseline) || baseline.length !== 5 || baseline[0] !== expected.v3Binding
    || !expected.items.length || expected.items.some(line => !line.v3SaleAuthority
      || line.v3SaleAuthority.binding !== baseline[0]
      || v3StockSource(line.v3SaleAuthority).syncId !== baseline[1]
      || v3StockSource(line.v3SaleAuthority).syncVersion !== baseline[2]
      || line.v3SaleAuthority.inventoryVersion !== baseline[3]
      || line.v3SaleAuthority.inventoryCursor !== baseline[4])) {
    throw new LargeMasterSyncV3Error('SYNC_V3_REFUND_ORIGINAL_AUTHORITY_INVALID');
  }
  const patch = {status:intended.status,relatedTransactions:intended.relatedTransactions,syncStatus:intended.syncStatus};
  if (originalCollection === 'transactionHistory') {
    if (!expected.zReportId || !expectedHistory) throw new LargeMasterSyncV3Error('SYNC_V3_REFUND_ORIGINAL_CHANGED');
    return [{collectionName:'transactionHistory',document:{...expectedHistory,...patch},expectedDocument:JSON.stringify(expectedHistory)}];
  }
  return [
    {collectionName:'transactions',document:{...expected,...patch},expectedDocument:JSON.stringify(expected)},
    {collectionName:'transactionHistory',document:{...(expectedHistory || expected),...patch},
      ...(expectedHistory ? {expectedDocument:JSON.stringify(expectedHistory)} : {requireAbsent:true})},
  ];
};
