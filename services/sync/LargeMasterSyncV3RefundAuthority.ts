import type { Transaction } from '../../types';
import type { DurableDocumentMutation } from '../db/DatabaseAdapter';
import { LargeMasterSyncV3Error } from './LargeMasterSyncV3Types';

export type V3FinancialIntent = 'SALE' | 'REFUND';

/** Positive refund document quantities replenish stock; they are not sale demand. */
export const requiresV3SaleAvailability = (intent: V3FinancialIntent, trackInventory: boolean,
  productAllowsNegative: boolean, terminalAllowsNegative: boolean): boolean =>
  intent === 'SALE' && trackInventory && !productAllowsNegative && !terminalAllowsNegative;

const sourceIdentity = (transaction: Transaction): string => {
  const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort()
      .filter(key => !['status', 'updatedAt', 'syncStatus', 'syncError', 'cloudSyncStatus',
        'cloudSyncError', 'cloudSyncedAt', 'relatedTransactions'].includes(key))
      .map(key => [key, canonical(value[key])])) : value;
  return JSON.stringify(canonical(transaction));
};

/** Keep the expected stored snapshot distinct from the intended refund update. */
export const buildV3RefundOriginalMutations = (
  expected: Transaction, intended: Transaction, refundId: string,
  expectedHistory: Transaction | null,
): DurableDocumentMutation[] => {
  const expectedLinks = [...new Set([...(expected.relatedTransactions || []), refundId])].sort();
  const intendedLinks = [...new Set(intended.relatedTransactions || [])].sort();
  if (!refundId || !expected.v3Binding || !expected.v3InventoryBaseline
    || expected.v3Binding !== intended.v3Binding
    || expected.v3InventoryBaseline !== intended.v3InventoryBaseline
    || sourceIdentity(expected) !== sourceIdentity(intended)
    || (expectedHistory !== null && (expectedHistory.id !== expected.id
      || expectedHistory.v3InventoryBaseline !== expected.v3InventoryBaseline
      || sourceIdentity(expectedHistory) !== sourceIdentity(expected)))
    || JSON.stringify(expectedLinks) !== JSON.stringify(intendedLinks)
    || ![expected.status, 'PARTIAL_REFUND', 'REFUNDED'].includes(intended.status)) {
    throw new LargeMasterSyncV3Error('SYNC_V3_REFUND_ORIGINAL_CHANGED');
  }
  const baseline: unknown = JSON.parse(expected.v3InventoryBaseline);
  if (!Array.isArray(baseline) || baseline.length !== 5 || baseline[0] !== expected.v3Binding
    || !expected.items.length || expected.items.some(line => !line.v3SaleAuthority
      || line.v3SaleAuthority.binding !== baseline[0]
      || line.v3SaleAuthority.syncId !== baseline[1]
      || line.v3SaleAuthority.syncVersion !== baseline[2]
      || line.v3SaleAuthority.inventoryVersion !== baseline[3]
      || line.v3SaleAuthority.inventoryCursor !== baseline[4])) {
    throw new LargeMasterSyncV3Error('SYNC_V3_REFUND_ORIGINAL_AUTHORITY_INVALID');
  }
  return [
    { collectionName: 'transactions', document: intended, expectedDocument: JSON.stringify(expected) },
    { collectionName: 'transactionHistory', document: intended,
      ...(expectedHistory ? { expectedDocument: JSON.stringify(expectedHistory) } : { requireAbsent: true }) },
  ];
};
