import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyProductionPrintReconciliation,
  buildProductionDispatchRequests,
  calculateProductionNextRetryAt,
  createSerializedCollectionMutator,
  createProductionDispatchIntent,
  createProductionPrintIntent,
  dispatchProductionOrder,
  isProductionPrintAutoRetryEligible,
  isProductionRetryDue,
  mergeProductionDispatchIntent,
  resolveAndRetryAmbiguousProductionPrint,
  retryPendingProductionPrints,
  runProductionDispatchAttempt,
  runProductionPrintAttempt,
} from '../services/restaurant/ProductionOrderDispatcher';
import { db } from '../utils/db';
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

test('serialized queue mutations preserve concurrent enqueues', async () => {
  const mutate = createSerializedCollectionMutator();
  let rows: string[] = [];
  const enqueue = (id: string) => mutate(async () => {
    const snapshot = [...rows];
    await new Promise((resolve) => setTimeout(resolve, 2));
    rows = [...snapshot, id];
  });
  await Promise.all([enqueue('kds-a'), enqueue('kds-b')]);
  assert.deepEqual(rows, ['kds-a', 'kds-b']);
});

test('web and native adapters register both production queues as durable collections', () => {
  const indexedDb = readFileSync(new URL('../services/db/adapters/IndexedDBAdapter.ts', import.meta.url), 'utf8');
  const sqlite = readFileSync(new URL('../services/db/adapters/CapacitorSQLiteAdapter.ts', import.meta.url), 'utf8');
  for (const collection of ['kdsDispatchQueue', 'productionPrintQueue']) {
    assert.match(indexedDb, new RegExp(`STRICT_DURABLE_COLLECTIONS[\\s\\S]*${collection}`));
    assert.match(sqlite, new RegExp(`STRICT_DURABLE_COLLECTIONS[\\s\\S]*${collection}`));
  }
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

test('401 is acknowledged as pre-side-effect but remains queued and is never SENT', async () => {
  const payload = {
    orderId: 'TXN-401', date: '2026-09-29T12:00:00.000Z', terminalId: 'T1',
    userName: 'Kiosk', customerName: 'Cliente General',
    area: { id: 'kitchen', name: 'Cocina' }, items: [], total: 0,
  };
  const intent = createProductionDispatchIntent({ kdsBaseUrl: 'http://kds:8001', cartIds: ['c1'], payload });
  let queue = [intent];
  let acknowledgements = 0;
  const result = await dispatchProductionOrder(intent, {
    update: 'KDS_ORDER_UPDATE',
    dispatch: 'KDS_ORDER_DISPATCH',
  }, {
    save: async (next) => {
      queue = [...queue.filter((entry) => entry.id !== next.id), next];
    },
    remove: async (id) => { queue = queue.filter((entry) => entry.id !== id); },
    request: async () => ({
      correlationId: 'kds-401',
      response: new Response('', { status: 401 }),
      completeAfterDurableCommit: async () => {
        acknowledgements += 1;
      },
    }),
  });

  assert.equal(result.status, 'PENDING');
  assert.equal(result.error, 'PRODUCTION_DELIVERY_REJECTED:401');
  assert.equal(acknowledgements, 1);
  assert.equal(queue.length, 1);
  assert.equal(queue[0]?.status, 'PENDING');
  assert.equal(queue[0]?.phase, 'DISPATCH_PENDING');
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

test('durable retry metadata applies exponential backoff while the scheduler keeps polling', () => {
  const now = Date.parse('2026-09-29T12:00:00.000Z');
  assert.equal(calculateProductionNextRetryAt(1, now), '2026-09-29T12:00:05.000Z');
  assert.equal(calculateProductionNextRetryAt(3, now), '2026-09-29T12:00:20.000Z');
  assert.equal(isProductionRetryDue({ nextRetryAt: '2026-09-29T12:00:20.000Z' }, now + 19_999), false);
  assert.equal(isProductionRetryDue({ nextRetryAt: '2026-09-29T12:00:20.000Z' }, now + 20_000), true);
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

test('ambiguous print requires explicit operator reconciliation before a retry', () => {
  const unknown = {
    ...createProductionPrintIntent({
      orderId: 'TXN-2', areaId: 'bar', areaName: 'Bar', cartIds: ['c2'], items: [],
    }),
    status: 'OUTCOME_UNKNOWN' as const,
  };
  assert.equal(applyProductionPrintReconciliation(unknown, 'CONFIRMED_PRINTED'), null);
  const retry = applyProductionPrintReconciliation(
    unknown,
    'CONFIRMED_NOT_PRINTED',
    new Date('2026-09-29T12:00:00.000Z'),
  );
  assert.equal(retry?.status, 'RECONCILING');
  assert.equal(retry?.nextRetryAt, undefined);
  assert.equal(isProductionPrintAutoRetryEligible(unknown), false);
});

test('manual print reconciliation and scheduler race issue exactly one print', async () => {
  const get = db.get;
  const save = db.save;
  const unknown = {
    ...createProductionPrintIntent({
      orderId: 'TXN-RACE', areaId: 'kitchen', areaName: 'Kitchen', cartIds: ['c-race'], items: [],
    }),
    status: 'OUTCOME_UNKNOWN' as const,
  };
  let queue = [unknown];
  let printCalls = 0;
  let releasePrint!: () => void;
  const printReleased = new Promise<void>((resolve) => { releasePrint = resolve; });
  try {
    db.get = (async (collection: string) => collection === 'productionPrintQueue' ? queue : []) as typeof db.get;
    db.save = (async (collection: string, value: unknown) => {
      if (collection === 'productionPrintQueue') queue = value as typeof queue;
    }) as typeof db.save;

    const manual = resolveAndRetryAmbiguousProductionPrint(unknown.id, async () => {
      printCalls += 1;
      await printReleased;
      return true;
    });
    while (printCalls === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    const scheduled = retryPendingProductionPrints(async () => {
      printCalls += 1;
      return true;
    });
    releasePrint();
    await Promise.all([manual, scheduled]);

    assert.equal(printCalls, 1);
    assert.deepEqual(queue, []);
  } finally {
    db.get = get;
    db.save = save;
  }
});
