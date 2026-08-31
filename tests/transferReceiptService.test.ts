import assert from 'node:assert/strict';
import test from 'node:test';
import type { StockTransfer } from '../types';
import {
  buildTransferReceiptOperation,
  TransferReceiptService,
  TransferReceiptValidationError,
  TRANSFER_RECEIPT_QUEUE_COLLECTION,
  type TransferReceiptPayload,
} from '../services/sync/TransferReceiptService';

class MemoryStore {
  records: Record<string, any[]> = {};

  async get(collection: string) {
    return structuredClone(this.records[collection] || []);
  }

  async saveDocument(collection: string, document: Record<string, any>) {
    const current = this.records[collection] || [];
    const index = current.findIndex(item => item.id === document.id);
    const copy = structuredClone(document);
    if (index >= 0) current[index] = copy;
    else current.push(copy);
    this.records[collection] = current;
  }
}

const transfer = (overrides: Partial<StockTransfer> = {}): StockTransfer => ({
  id: 'transfer-1',
  displayId: 'TR-0001',
  sourceWarehouseId: 'warehouse-origin',
  destinationWarehouseId: 'warehouse-destination',
  status: 'IN_TRANSIT',
  createdAt: '2026-08-31T12:00:00.000Z',
  syncSource: 'ERP_SNAPSHOT',
  items: [
    {
      transferItemId: 'line-1',
      productId: 'product-1',
      productName: 'Producto 1',
      quantity: 5,
      receivedQuantity: 0,
    },
  ],
  ...overrides,
});

const input = (overrides: Record<string, any> = {}) => ({
  transfer: transfer(),
  terminalId: 'terminal-uuid',
  deviceId: 'device-authorized',
  authorizedWarehouseIds: ['warehouse-destination'],
  quantities: { 'line-1': 5 },
  ...overrides,
});

test('builds a complete receipt with a stable UUID and POS-only discrepancy closure disabled', () => {
  const operation = buildTransferReceiptOperation(input());
  assert.match(operation.payload.idempotencyKey, /^[0-9a-f-]{36}$/i);
  assert.equal(operation.id, operation.payload.idempotencyKey);
  assert.deepEqual(operation.payload.lines, [{ transferItemId: 'line-1', quantity: 5 }]);
  assert.equal(operation.payload.closeWithDiscrepancy, false);
  assert.deepEqual(operation.payload.evidence, []);
});

test('accepts a partial receipt only when the line includes a reason', () => {
  assert.throws(
    () => buildTransferReceiptOperation(input({ quantities: { 'line-1': 2 } })),
    (error: unknown) => error instanceof TransferReceiptValidationError && error.code === 'TRANSFER_RECEIPT_REASON_REQUIRED',
  );
  const operation = buildTransferReceiptOperation(input({
    quantities: { 'line-1': 2 },
    discrepancyReasons: { 'line-1': 'Faltaron unidades en el despacho' },
  }));
  assert.deepEqual(operation.payload.lines, [{
    transferItemId: 'line-1',
    quantity: 2,
    discrepancyReason: 'Faltaron unidades en el despacho',
  }]);
});

test('rejects quantities above the pending amount', () => {
  assert.throws(
    () => buildTransferReceiptOperation(input({ quantities: { 'line-1': 6 } })),
    (error: unknown) => error instanceof TransferReceiptValidationError && error.code === 'TRANSFER_RECEIPT_QUANTITY_INVALID',
  );
});

test('blocks a second confirmation while the first operation remains queued', async () => {
  const store = new MemoryStore();
  const service = new TransferReceiptService(store, { postTransferReceipt: async () => ({ httpStatus: 201, data: {} }) }, async () => {});
  await service.enqueue(input());
  await assert.rejects(
    () => service.enqueue(input()),
    (error: unknown) => error instanceof TransferReceiptValidationError && error.code === 'TRANSFER_RECEIPT_ALREADY_QUEUED',
  );
  assert.equal((await service.list()).length, 1);
});

test('rejects a transfer whose destination warehouse is outside the terminal scope', () => {
  assert.throws(
    () => buildTransferReceiptOperation(input({ authorizedWarehouseIds: ['another-warehouse'] })),
    (error: unknown) => error instanceof TransferReceiptValidationError && error.code === 'TRANSFER_RECEIPT_WAREHOUSE_FORBIDDEN',
  );
});

test('timeout followed by an idempotent HTTP 200 after app recovery reuses the same key and payload', async () => {
  const store = new MemoryStore();
  let nowMs = Date.parse('2026-08-31T12:00:00.000Z');
  const attempts: Array<{ key: string; payload: TransferReceiptPayload }> = [];
  let fail = true;
  const transport = {
    async postTransferReceipt(_transferId: string, payload: TransferReceiptPayload) {
      attempts.push({ key: payload.idempotencyKey, payload: structuredClone(payload) });
      if (fail) {
        const timeout = new Error('Request timed out');
        timeout.name = 'AbortError';
        throw timeout;
      }
      return { httpStatus: 200, data: { result: { receiptId: 'receipt-1', idempotentReplay: true } } };
    },
  };
  const serviceBeforeClose = new TransferReceiptService(store, transport, async () => {}, () => new Date(nowMs));
  const queued = await serviceBeforeClose.enqueue(input());
  await serviceBeforeClose.processDue();
  assert.equal((await serviceBeforeClose.list())[0].status, 'RETRY_WAIT');

  nowMs += 5_001;
  fail = false;
  const serviceAfterOpen = new TransferReceiptService(store, transport, async () => {}, () => new Date(nowMs));
  await serviceAfterOpen.processDue();
  const applied = (await serviceAfterOpen.list())[0];
  assert.equal(applied.status, 'APPLIED');
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].key, queued.payload.idempotencyKey);
  assert.equal(attempts[1].key, queued.payload.idempotencyKey);
  assert.deepEqual(attempts[1].payload, attempts[0].payload);
});

test('recovers an interrupted SENDING operation after closing and reopening the app', async () => {
  const store = new MemoryStore();
  const first = new TransferReceiptService(store, { postTransferReceipt: async () => { throw new Error('unused'); } }, async () => {});
  const queued = await first.enqueue(input());
  store.records[TRANSFER_RECEIPT_QUEUE_COLLECTION][0].status = 'SENDING';

  const receivedKeys: string[] = [];
  const reopened = new TransferReceiptService(store, {
    async postTransferReceipt(_id, payload) {
      receivedKeys.push(payload.idempotencyKey);
      return { httpStatus: 201, data: { result: { receiptId: 'receipt-recovered' } } };
    },
  }, async () => {});
  assert.equal(await reopened.recoverInterrupted(), 1);
  await reopened.processDue();
  assert.deepEqual(receivedKeys, [queued.payload.idempotencyKey]);
  assert.equal((await reopened.list())[0].status, 'APPLIED');
});

test('treats HTTP 200 after an uncertain timeout as idempotent success and refreshes the snapshot', async () => {
  const store = new MemoryStore();
  let refreshCount = 0;
  const service = new TransferReceiptService(store, {
    async postTransferReceipt() {
      return {
        httpStatus: 200,
        data: { result: { receiptId: 'receipt-1', idempotentReplay: true } },
      };
    },
  }, async () => { refreshCount += 1; });
  await service.enqueue(input());
  await service.processDue();
  const applied = (await service.list())[0];
  assert.equal(applied.status, 'APPLIED');
  assert.equal(applied.httpStatus, 200);
  assert.equal(applied.result?.idempotentReplay, true);
  assert.equal(applied.snapshotRefreshPending, false);
  assert.equal(refreshCount, 1);
});

test('does not retry 401, 403, 404 or 422 responses', async (context) => {
  for (const status of [401, 403, 404, 422]) {
    await context.test(String(status), async () => {
      const store = new MemoryStore();
      let calls = 0;
      const service = new TransferReceiptService(store, {
        async postTransferReceipt() {
          calls += 1;
          const error = new Error(`Operational sync failed: ${status}`) as Error & { httpStatus: number };
          error.httpStatus = status;
          throw error;
        },
      }, async () => {});
      await service.enqueue(input({ idempotencyKey: `fixed-${status}` }));
      await service.processDue();
      await service.processDue();
      assert.equal(calls, 1);
      assert.equal((await service.list())[0].status, 'REJECTED');
    });
  }
});

test('rejects any queued attempt to enable closeWithDiscrepancy without calling the ERP', async () => {
  const store = new MemoryStore();
  let calls = 0;
  const service = new TransferReceiptService(store, {
    async postTransferReceipt() {
      calls += 1;
      return { httpStatus: 201, data: {} };
    },
  }, async () => {});
  await service.enqueue(input());
  store.records[TRANSFER_RECEIPT_QUEUE_COLLECTION][0].payload.closeWithDiscrepancy = true;
  await service.processDue();
  assert.equal(calls, 0);
  assert.equal((await service.list())[0].status, 'REJECTED');
});
