import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildProductionDispatchRequests,
  createProductionDispatchIntent,
  createProductionPrintIntent,
  isProductionPrintAutoRetryEligible,
  mergeProductionDispatchIntent,
  runProductionDispatchAttempt,
  runProductionPrintAttempt,
} from '../services/restaurant/ProductionOrderDispatcher';
import { resolveProductionOutputTargets } from '../utils/productionOutputMode';

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
  assert.ok(dispatchBody.indexOf('await saveIntent(intent)') < dispatchBody.indexOf('await runProductionDispatchAttempt'));
  assert.doesNotMatch(source, /PaymentIntentService|createTransaction|paymentMethod/);
});

test('KDS update uses the supported PUT contract and dispatch remains POST', () => {
  const payload = {
    orderId: 'TXN-1', date: '2026-09-29T12:00:00.000Z', terminalId: 'T1',
    userName: 'Kiosk', customerName: 'Cliente General',
    area: { id: 'kitchen', name: 'Cocina' }, items: [], total: 0,
  };
  const intent = createProductionDispatchIntent({ kdsBaseUrl: 'http://kds:8001', cartIds: ['c1'], payload });
  const { update, dispatch } = buildProductionDispatchRequests(intent);
  assert.equal(update.method, 'PUT');
  assert.equal(update.url, 'http://kds:8001/api/ordenes/TXN-1');
  assert.equal(dispatch.method, 'POST');
});

test('PUT timeout after dispatch checkpoints recovery and restart does not resend the command', async () => {
  const payload = {
    orderId: 'TXN-1', date: '2026-09-29T12:00:00.000Z', terminalId: 'T1',
    userName: 'Kiosk', customerName: 'Cliente General',
    area: { id: 'kitchen', name: 'Cocina' }, items: [], total: 0,
  };
  const intent = createProductionDispatchIntent({ kdsBaseUrl: 'http://kds:8001', cartIds: ['c1'], payload });
  const calls: string[] = [];
  let recovered = intent;

  await assert.rejects(() => runProductionDispatchAttempt(
    intent,
    async (request) => {
      calls.push(request.method);
      if (request.method === 'PUT') throw new Error('TIMEOUT_AFTER_SIDE_EFFECT');
    },
    async (checkpoint) => { recovered = checkpoint; },
  ), /TIMEOUT_AFTER_SIDE_EFFECT/);

  assert.deepEqual(calls, ['POST', 'PUT']);
  assert.equal(recovered.phase, 'UPDATE_PENDING');

  calls.length = 0;
  await runProductionDispatchAttempt(
    recovered,
    async (request) => { calls.push(request.method); },
    async (checkpoint) => { recovered = checkpoint; },
  );
  assert.deepEqual(calls, ['PUT']);
});

test('retry merge retains the incremented attempt count', () => {
  const payload = {
    orderId: 'TXN-1', date: '2026-09-29T12:00:00.000Z', terminalId: 'T1',
    userName: 'Kiosk', customerName: 'Cliente General',
    area: { id: 'kitchen', name: 'Cocina' }, items: [], total: 0,
  };
  const existing = { ...createProductionDispatchIntent({ cartIds: ['c1'], payload }), attempts: 2 };
  const retried = { ...existing, attempts: 3, lastError: 'offline' };
  assert.equal(mergeProductionDispatchIntent(existing, retried).attempts, 3);
});

test('printer-only production creates a durable print identity without enabling KDS', () => {
  assert.deepEqual(resolveProductionOutputTargets('PRINTER'), {
    mode: 'PRINTER', shouldPrint: true, shouldSendKds: false,
  });
  const intent = createProductionPrintIntent({
    orderId: 'TXN-1', areaId: 'bar', areaName: 'Bar', cartIds: ['c1'],
    items: [{ id: 'p1', cartId: 'c1', name: 'Bebida', quantity: 1 } as any],
  });
  assert.equal(intent.status, 'PENDING');
  assert.match(intent.id, /^print:kds:txn-1:bar:c1$/);
});

test('false acknowledgement with late paper output remains unknown and is never auto-retried', async () => {
  const intent = createProductionPrintIntent({
    orderId: 'TXN-1', areaId: 'bar', areaName: 'Bar', cartIds: ['c1'],
    items: [{ id: 'p1', cartId: 'c1', name: 'Bebida', quantity: 1 } as any],
  });
  let printCalls = 0;
  let paperOutputs = 0;
  let checkpoint = intent;
  const result = await runProductionPrintAttempt(
    intent,
    () => new Promise<boolean>((resolve) => {
      printCalls += 1;
      setTimeout(() => resolve(false), 1);
      setTimeout(() => { paperOutputs += 1; }, 5);
    }),
    async (next) => { checkpoint = next; },
  );
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(result.status, 'OUTCOME_UNKNOWN');
  assert.equal(checkpoint.status, 'OUTCOME_UNKNOWN');
  assert.equal(isProductionPrintAutoRetryEligible(checkpoint), false);
  const automaticRetryQueue = [checkpoint].filter(isProductionPrintAutoRetryEligible);
  for (const pending of automaticRetryQueue) {
    await runProductionPrintAttempt(pending, async () => {
      printCalls += 1;
      return true;
    }, async () => undefined);
  }
  assert.equal(printCalls, 1);
  assert.equal(paperOutputs, 1);
});
