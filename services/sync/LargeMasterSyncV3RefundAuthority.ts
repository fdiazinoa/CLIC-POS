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

/** Only root transport/status metadata is mutable. Nested line/customer/payment status remains financial identity. */
export const refundFinancialSourceIdentity = (transaction: Transaction): string => {
  const mutable = new Set(['status','updatedAt','syncStatus','syncError','cloudSyncStatus','cloudSyncError','cloudSyncedAt',
    'relatedTransactions','zReportId','syncStartedAt','syncRetryAfter','syncBlockedReason','syncBlockedAt','_forceSyncReplay',
    'fiscalResponseCode','fiscalSignedXml','fiscalQrCode','fiscalStatus','fiscalPreSubmitRecoveryAudit','fiscalSyncStatus','fiscalSyncError','fiscalSyncedAt','fiscalReferenceId',
    'fiscalResponseMessage','fiscalProviderStatus','fiscalCertifiedNcf','fiscalStatusProof','fiscalSubmissionScope',
    'fiscalLookupApproval','fiscalPrintScope','fiscalPrintProof','fiscalClassificationProjection','fiscalClassificationAttemptedAt','fiscalQrUrl','fiscalSecurityCode','fiscalSignedAt']);
  const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
  return JSON.stringify(canonical(Object.fromEntries(Object.entries(transaction).filter(([key])=>!mutable.has(key)))));
};
export const assertRefundOriginalState=(source:Transaction):void=>{
  if(!['COMPLETED','PARTIAL_REFUND'].includes(source.status)) throw new LargeMasterSyncV3Error('SYNC_V3_REFUND_ORIGINAL_NOT_REFUNDABLE');
};
export const assertRefundFinancialSource = (expected: Transaction, captured: Transaction): void => {
  if (refundFinancialSourceIdentity(expected) !== refundFinancialSourceIdentity(captured)) throw new LargeMasterSyncV3Error('SYNC_V3_REFUND_ORIGINAL_CHANGED');
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
  if (!refundId || !expected.v3Binding || !expected.v3InventoryBaseline
    || expected.v3Binding !== intended.v3Binding
    || expected.v3InventoryBaseline !== intended.v3InventoryBaseline
    || refundFinancialSourceIdentity(expected) !== refundFinancialSourceIdentity(intended)
    || (expectedHistory !== null && (expectedHistory.id !== expected.id
      || expectedHistory.v3InventoryBaseline !== expected.v3InventoryBaseline
      || refundFinancialSourceIdentity(expectedHistory) !== refundFinancialSourceIdentity(expected)))
    || JSON.stringify(expectedLinks) !== JSON.stringify(intendedLinks)
    || ![expected.status, 'PARTIAL_REFUND', 'REFUNDED'].includes(intended.status)) {
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
