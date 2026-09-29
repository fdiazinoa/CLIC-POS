import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSalePostedPayload } from '../services/sync/SalePostedContract';
import { calculateRestaurantServiceCharge } from '../utils/businessVertical';

test('restaurant kiosk legal tip uses gross after discount, matching POS', () => {
  assert.equal(calculateRestaurantServiceCharge(118, 18, 10), 10);
  assert.equal(calculateRestaurantServiceCharge(118, 0, 10), 11.8);
});

test('SALE_POSTED preserves restaurant service, legal tip and order metadata', () => {
  const transaction = {
    id: 'TXN-KIOSK-1', displayId: 'T-1', documentType: 'TICKET', status: 'COMPLETED',
    date: '2026-09-29T12:00:00.000Z', total: 110, netAmount: 84.75, taxAmount: 15.25,
    discountAmount: 0, serviceType: 'DINE_IN', serviceChargeAmount: 10, orderNumber: 'K-100',
    serviceTaxPolicySnapshot: { serviceType: 'DINE_IN', source: 'POS', legalTip: { enabled: true, percentage: 10 } },
    items: [{ id: 'p1', cartId: 'line-1', name: 'Plato', quantity: 1, price: 100, totalAmount: 100 }],
    payments: [{ id: 'pay-1', method: 'CASH', amount: 110, appliedAmount: 110 }],
  } as any;

  const payload = buildSalePostedPayload(transaction);
  assert.equal(payload.summary.service_type, 'DINE_IN');
  assert.equal(payload.summary.service_charge_amount, 10);
  assert.equal(payload.summary.order_number, 'K-100');
  assert.deepEqual(payload.summary.service_tax_policy_snapshot, transaction.serviceTaxPolicySnapshot);
  assert.equal(payload.summary.total, 110);
});
