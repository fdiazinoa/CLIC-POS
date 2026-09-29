import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProductionDispatchIntent } from '../services/restaurant/ProductionOrderDispatcher';

test('dispatcher intent is deterministic and starts pending before network delivery', () => {
  const payload = {
    orderId: 'TXN-1', date: '2026-09-29T12:00:00.000Z', terminalId: 'T1',
    userName: 'Kiosk', customerName: 'Cliente General',
    area: { id: 'kitchen', name: 'Cocina' }, items: [], total: 0,
  };
  const first = createProductionDispatchIntent({ kdsBaseUrl: 'http://kds:8001/', cartIds: ['c2', 'c1'], payload });
  const second = createProductionDispatchIntent({ kdsBaseUrl: 'http://kds:8001', cartIds: ['c1', 'c2'], payload });
  assert.equal(first.id, second.id);
  assert.equal(first.status, 'PENDING');
  assert.equal(first.kdsBaseUrl, 'http://kds:8001');
});

test('dispatcher persists intent before issuing either KDS request and retry is payment-independent', () => {
  const source = readFileSync(new URL('../services/restaurant/ProductionOrderDispatcher.ts', import.meta.url), 'utf8');
  const dispatchBody = source.slice(source.indexOf('export const dispatchProductionOrder'), source.indexOf('export const retryPendingProductionOrders'));
  assert.ok(dispatchBody.indexOf('await saveIntent(intent)') < dispatchBody.indexOf('await postIntentJson'));
  assert.doesNotMatch(source, /PaymentIntentService|createTransaction|paymentMethod/);
});
