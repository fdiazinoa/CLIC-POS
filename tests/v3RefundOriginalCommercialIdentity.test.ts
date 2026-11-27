import test from 'node:test';
import assert from 'node:assert/strict';
import type { Transaction } from '../types';
import {
  assertRefundFinancialSource,
  buildV3RefundOriginalMutations,
  refundFinancialSourceDiff,
  refundFinancialSourceIdentity,
} from '../services/sync/LargeMasterSyncV3RefundAuthority';
import { decideFiscalReturnPrint, markOriginalReturnPending } from '../services/fiscal/ReturnFiscalState';

const stamp = { binding: 'binding', warehouseId: 'W', syncId: 'S', syncVersion: 2,
  tariffId: 'T', taxIncluded: true, inventoryVersion: 4, inventoryCursor: 'C' };
const original = (): Transaction => ({
  id: 'sale', status: 'COMPLETED', terminalId: 'terminal', date: '2026-11-24T18:39:42.000Z',
  documentType: 'SALE', ncf: 'E320000006019', electronicNcf: 'E320000006019', ncfType: 'E32',
  fiscalMode: 'ECF', fiscalProvider: 'MSELLER', fiscalEnvironment: 0,
  fiscalIssuance: { issuerRnc: '130090752', ncf: 'E320000006019', expiryDate: '2027-12-31' },
  total: 118, netAmount: 100, taxAmount: 18, discountAmount: 0,
  v3Binding: 'binding', v3WarehouseId: 'W', v3InventoryBaseline: JSON.stringify(['binding', 'S', 2, 4, 'C']),
  relatedTransactions: [], syncStatus: 'PENDING',
  items: [{ id: 'P', cartId: 'line', productId: 'P', name: 'Agua', quantity: 1, price: 118, totalAmount: 118,
    netAmount: 100, taxAmount: 18, v3SaleAuthority: { ...stamp } }],
  payments: [{ id: 'pay-1', method: 'CASH', amount: 118, status: 'COMPLETED' }],
} as unknown as Transaction);
/** The V3 fiscal sync runs after commit and rewrites derived fiscal presentation + root status. */
const afterFiscalSync = (): Transaction => ({
  ...original(),
  syncStatus: 'SYNCED', updatedAt: '2026-11-24T18:40:00.000Z',
  fiscalSyncStatus: 'SYNCED', fiscalSyncedAt: '2026-11-24T18:40:00.000Z', fiscalStatus: 'ACCEPTED',
  fiscalQrUrl: 'https://ecf.dgii.gov.do/testecf/ConsultaTimbre?...', fiscalSecurityCode: 'NVrTbH',
  fiscalSignedAt: '24-11-2026 14:39:53', fiscalPrintProof: { schemaVersion: 1 }, fiscalStatusProof: { decision: 'ACCEPTED' },
  fiscalProviderStatus: 'SIGNED_PENDING', fiscalResponseMessage: 'OK',
  taxBreakdown: [{ id: 'itbis', name: 'ITBIS', rate: 0.18, amount: 18.01, taxableBase: 99.99, total: 118 }],
} as unknown as Transaction);

test('venta → sync fiscal → devolución permitida: raíz fiscal y breakdown derivado no alteran la identidad', () => {
  const fresh = afterFiscalSync();
  assert.equal(refundFinancialSourceIdentity(fresh), refundFinancialSourceIdentity(original()));
  assert.doesNotThrow(() => assertRefundFinancialSource(fresh, original()));
  const after = { ...fresh, status: 'REFUNDED' as const, relatedTransactions: ['refund'], syncStatus: 'PENDING' as const };
  const mutations = buildV3RefundOriginalMutations(fresh, after, 'refund', { ...fresh, syncStatus: 'APPLIED_ERP' as any });
  assert.equal(mutations[0].collectionName, 'transactions');
});

test('cambios comerciales reales bloquean: importe, ítems, pagos, NCF, tenant/terminal o binding', () => {
  const fresh = afterFiscalSync();
  const after = { ...fresh, status: 'REFUNDED' as const, relatedTransactions: ['refund'] };
  const changed: Array<Partial<Transaction>> = [
    { total: 119 },
    { items: [{ ...(fresh.items[0] as any), quantity: 2 }] },
    { items: [{ ...(fresh.items[0] as any), price: 100 }] },
    { items: [{ ...(fresh.items[0] as any), status: 'changed' }] },
    { payments: [{ ...(fresh.payments[0] as any), amount: 1 }] },
    { ncf: 'E320000006020' as any, electronicNcf: 'E320000006020' as any },
    { terminalId: 'other-terminal' as any }, { v3Binding: 'other-binding' as any },
    { v3InventoryBaseline: JSON.stringify(['other', 'S', 2, 4, 'C']) as any },
    { customerId: 'other-customer' as any },
  ];
  for (const patch of changed) {
    assert.throws(() => buildV3RefundOriginalMutations({ ...fresh, ...patch }, after, 'refund', null), /ORIGINAL_CHANGED/);
  }
  assert.throws(() => assertRefundFinancialSource({ ...fresh, total: 119 } as Transaction, original()), /ORIGINAL_CHANGED/);
  // Root fiscal amounts remain part of the source identity (only the derived breakdown is mutable).
  assert.throws(() => assertRefundFinancialSource({ ...fresh, taxAmount: 18.01 } as Transaction, original()), /ORIGINAL_CHANGED/);
});

test('identidad idempotente: reintentos y lecturas consecutivas devuelven el mismo fingerprint', () => {
  const first = afterFiscalSync();
  const second = afterFiscalSync();
  assert.equal(refundFinancialSourceIdentity(first), refundFinancialSourceIdentity(second));
  assert.doesNotThrow(() => assertRefundFinancialSource(second, first));
  assert.doesNotThrow(() => assertRefundFinancialSource(second, first));
  // A real item change still blocks on retry.
  assert.throws(() => assertRefundFinancialSource({ ...second, items: [{ ...(second.items[0] as any), quantity: 3 }] } as Transaction, first));
});

test('no imprimir QR genérico como fiscal en la NC de la devolución', () => {
  assert.deepEqual(decideFiscalReturnPrint({ documentType: 'REFUND', ncfType: 'E34', ncf: 'E340000000012' } as Transaction, false),
    { allowed: false, code: 'FISCAL_RETURN_SIGNED_QR_REQUIRED' });
  assert.equal(decideFiscalReturnPrint({ documentType: 'REFUND', ncfType: 'E34', ncf: 'E340000000012' } as Transaction, true).allowed, true);
});

test('devolución ECF real: el hold local (refundPendingErp/pendingRefundStatus) no altera la identidad', () => {
  const fresh = afterFiscalSync();
  // Exactly what App.tsx commit() passes: fresh durable original + local annulment hold.
  const held = markOriginalReturnPending(fresh, 'REFUNDED');
  assert.equal((held as any).refundPendingErp, true);
  assert.equal((held as any).pendingRefundStatus, 'REFUNDED');
  // The hold keeps the commercial status untouched until the ERP ACKs the NC.
  assert.equal(held.status, 'COMPLETED');
  assert.equal(refundFinancialSourceIdentity(held), refundFinancialSourceIdentity(fresh));
  assert.deepEqual(refundFinancialSourceDiff(fresh, held), []);
  assert.doesNotThrow(() => assertRefundFinancialSource(fresh, held));
  assert.doesNotThrow(() => assertRefundFinancialSource(held, fresh));
  const after = { ...held, relatedTransactions: ['refund'], syncStatus: 'PENDING' as const };
  const mutations = buildV3RefundOriginalMutations(fresh, after, 'refund', { ...fresh, syncStatus: 'APPLIED_ERP' as any });
  assert.equal(mutations.length, 2);
  assert.equal(mutations[0].collectionName, 'transactions');
  assert.equal((mutations[0].document as Transaction).status, 'COMPLETED');
  assert.deepEqual((mutations[0].document as Transaction).relatedTransactions, ['refund']);
});

test('el hold no debilita la identidad comercial: cualquier cambio real junto al hold bloquea', () => {
  const fresh = afterFiscalSync();
  const held = markOriginalReturnPending(fresh, 'REFUNDED');
  const patches: Array<Partial<Transaction>> = [
    { total: 119 }, { taxAmount: 18.01 }, { netAmount: 99 },
    { items: [{ ...(fresh.items[0] as any), quantity: 2 }] },
    { items: [{ ...(fresh.items[0] as any), price: 100 }] },
    { payments: [{ ...(fresh.payments[0] as any), amount: 1 }] },
    { ncf: 'E320000006020' as any, electronicNcf: 'E320000006020' as any },
    { terminalId: 'other-terminal' as any }, { v3Binding: 'other-binding' as any },
  ];
  for (const patch of patches) {
    assert.throws(() => assertRefundFinancialSource({ ...held, ...patch } as Transaction, fresh), /ORIGINAL_CHANGED/);
    assert.throws(() => assertRefundFinancialSource(fresh, { ...held, ...patch } as Transaction), /ORIGINAL_CHANGED/);
  }
});

test('el diagnóstico de identidad reporta la ruta y el valor exactos', () => {
  const fresh = afterFiscalSync();
  assert.deepEqual(refundFinancialSourceDiff(fresh, afterFiscalSync()), []);
  const diff = refundFinancialSourceDiff({ ...fresh, total: 119 } as Transaction, fresh);
  assert.equal(diff.length, 1);
  assert.match(diff[0], /\$\.total/);
  assert.match(diff[0], /119/);
});
