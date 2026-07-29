import assert from 'node:assert/strict';
import test from 'node:test';
import { CartItem, Transaction } from '../types';
import {
  getRefundItemKey,
  getRemainingRefundQuantities,
  hasRefundableItems,
  validateRefundItems,
} from '../utils/refundAvailability';

const item = (cartId: string, quantity: number): CartItem => ({
  id: `product-${cartId}`,
  cartId,
  name: cartId,
  price: 100,
  quantity,
} as CartItem);

const sale: Transaction = {
  id: 'sale-1',
  displayId: 'TCK-001',
  documentType: 'TICKET',
  date: new Date().toISOString(),
  items: [item('a', 2), item('b', 3)],
  total: 500,
  payments: [],
  userId: 'u1',
  userName: 'User',
  terminalId: 't1',
  status: 'COMPLETED',
};

test('remaining quantities subtract previous partial refunds', () => {
  const prior: Transaction = {
    ...sale,
    id: 'refund-1',
    documentType: 'REFUND',
    originalTransactionId: sale.id,
    affectedInvoiceNumber: sale.displayId,
    items: [item('a', 1), item('b', 2)],
    total: 300,
    status: 'REFUNDED',
  };

  const remaining = getRemainingRefundQuantities(sale, [sale, prior]);
  assert.equal(remaining.get(getRefundItemKey(sale.items[0])), 1);
  assert.equal(remaining.get(getRefundItemKey(sale.items[1])), 1);
  assert.equal(hasRefundableItems(remaining), true);
});

test('a second refund cannot exceed the remaining balance', () => {
  const prior: Transaction = {
    ...sale,
    id: 'refund-1',
    documentType: 'REFUND',
    originalTransactionId: sale.id,
    items: [item('a', 2)],
    total: 200,
    status: 'REFUNDED',
  };

  const result = validateRefundItems(sale, [item('a', 1)], [sale, prior]);
  assert.equal(result.valid, false);
});

test('full prior refund leaves no refundable items', () => {
  const prior: Transaction = {
    ...sale,
    id: 'refund-full',
    documentType: 'REFUND',
    affectedInvoiceNumber: sale.displayId,
    items: [item('a', 2), item('b', 3)],
    total: 500,
    status: 'REFUNDED',
  };

  assert.equal(hasRefundableItems(getRemainingRefundQuantities(sale, [prior])), false);
});
