import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { CapacitorSQLiteAdapter } from '../services/db/adapters/CapacitorSQLiteAdapter';
import { normalizeMasterNumberRange } from '../services/sync/masterNumberRangeContract';
import type { MasterNumberRangeEntityType } from '../services/db/DatabaseAdapter';

const terminalId = '9ffc6771-7845-4976-afd3-20cebc3cc6e8';
const makeRange = (overrides: Record<string, unknown> = {}) => ({
  ...normalizeMasterNumberRange({
    id: 'range-customer', entity_type: 'CUSTOMER', prefix: 'CLI',
    start_number: 1000, end_number: 1099, next_number: 1000,
    last_issued_number: 999, padding: 6, status: 'ACTIVE',
    updated_at: '2026-09-02T15:00:00.000Z', ...overrides,
  })!,
  terminalId,
});

const openHarness = async (path = ':memory:') => {
  const native = new Database(path);
  let failDocumentWrite = false;
  const bridge = {
    execute: async (sql: string) => { native.exec(sql); return {}; },
    query: async (sql: string, values: any[] = []) => ({ values: native.prepare(sql).all(...values) }),
    run: async (sql: string, values: any[] = []) => {
      if (failDocumentWrite && sql.includes('INSERT INTO documents')) throw new Error('SIMULATED_DISK_FAILURE');
      return native.prepare(sql).run(...values);
    },
    executeSet: async (entries: Array<{ statement: string; values: any[] }>) => {
      native.transaction(() => {
        for (const entry of entries) native.prepare(entry.statement).run(...entry.values);
      })();
      return {};
    },
  };
  const adapter = new CapacitorSQLiteAdapter();
  (adapter as any).db = bridge;
  await (adapter as any).initSchema();
  return { adapter, native, failWrites: (value: boolean) => { failDocumentWrite = value; } };
};

const create = (adapter: CapacitorSQLiteAdapter, id: string, entityType: MasterNumberRangeEntityType = 'CUSTOMER') =>
  adapter.commitNumberedMasterCreation({
    entityType,
    collectionName: entityType === 'CUSTOMER' ? 'customers' : entityType === 'SUPPLIER' ? 'suppliers' : 'products',
    document: { id, name: id }, sourceTerminalId: terminalId, localTerminalId: terminalId,
  });

test('SQLite emite CUSTOMER/SUPPLIER/ITEM offline con el formato contractual', async () => {
  const { adapter, native } = await openHarness();
  try {
    await adapter.upsertMasterNumberRanges([
      makeRange(),
      makeRange({ id: 'range-pro', entity_type: 'SUPPLIER', prefix: 'PRO', start_number: 127, next_number: 127, last_issued_number: 126, end_number: 200 }),
      makeRange({ id: 'range-art', entity_type: 'ITEM', prefix: 'ART', start_number: 20050, next_number: 20050, last_issued_number: 20049, end_number: 20100 }),
    ]);
    assert.equal((await create(adapter, 'c')).document.customer_code, 'CLI-001000');
    assert.equal((await create(adapter, 's', 'SUPPLIER')).document.supplier_code, 'PRO-000127');
    assert.equal((await create(adapter, 'i', 'ITEM')).document.sku, 'ART-020050');
    assert.equal((await adapter.getCollection<any>('customerMutations')).length, 1);
  } finally { native.close(); }
});

test('SQLite serializa 30 creaciones simultáneas sin repetir códigos', async () => {
  const { adapter, native } = await openHarness();
  try {
    await adapter.upsertMasterNumberRanges([makeRange()]);
    const results = await Promise.all(Array.from({ length: 30 }, (_, index) => create(adapter, `c-${index}`)));
    assert.equal(new Set(results.map(result => result.code)).size, 30);
    assert.equal((await adapter.getMasterNumberRanges())[0].nextNumber, 1030);
    assert.equal((await adapter.getCollection<any>('customers')).length, 30);
    assert.equal((await adapter.getCollection<any>('customerMutations')).length, 30);
  } finally { native.close(); }
});

test('reenviar la misma creación UUID es idempotente y conserva el código', async () => {
  const { adapter, native } = await openHarness();
  try {
    await adapter.upsertMasterNumberRanges([makeRange()]);
    const results = await Promise.all([create(adapter, 'same-id'), create(adapter, 'same-id')]);
    assert.equal(results[0].code, results[1].code);
    assert.equal((await adapter.getMasterNumberRanges())[0].nextNumber, 1001);
    assert.equal((await adapter.getCollection<any>('customerMutations')).length, 1);
    await adapter.saveDocument('customers', { id: 'legacy', name: 'Cliente anterior', customer_code: 'LEGACY-42' });
    assert.equal((await create(adapter, 'legacy')).code, 'LEGACY-42');
    await adapter.saveDocument('customers', { id: 'legacy-local-only', name: 'Solo identidad local' });
    assert.equal((await create(adapter, 'legacy-local-only')).document.id, 'legacy-local-only');
    assert.equal((await adapter.getMasterNumberRanges())[0].nextNumber, 1001);
  } finally { native.close(); }
});

test('el cursor persiste al cerrar y reabrir la base y no retrocede por snapshot', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'clic-master-ranges-test-'));
  const path = join(directory, 'pos.sqlite');
  try {
    const first = await openHarness(path);
    await first.adapter.upsertMasterNumberRanges([makeRange()]);
    assert.equal((await create(first.adapter, 'before-restart')).code, 'CLI-001000');
    first.native.close();
    const reopened = await openHarness(path);
    try {
      await reopened.adapter.upsertMasterNumberRanges([makeRange()]);
      assert.equal((await create(reopened.adapter, 'after-restart')).code, 'CLI-001001');
    } finally { reopened.native.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('un fallo de persistencia revierte cursor, maestro y outbox juntos', async () => {
  const { adapter, native, failWrites } = await openHarness();
  try {
    await adapter.upsertMasterNumberRanges([makeRange()]);
    failWrites(true);
    await assert.rejects(create(adapter, 'failed'), /SIMULATED_DISK_FAILURE/);
    assert.equal((await adapter.getMasterNumberRanges())[0].nextNumber, 1000);
    assert.equal((await adapter.getCollection<any>('customers')).length, 0);
    failWrites(false);
    assert.equal((await create(adapter, 'retry')).code, 'CLI-001000');
  } finally { native.close(); }
});

test('agotamiento bloquea nuevos maestros y un rango posterior habilita nuevamente', async () => {
  const { adapter, native } = await openHarness();
  try {
    await adapter.upsertMasterNumberRanges([makeRange({ end_number: 1000 })]);
    await create(adapter, 'first');
    await assert.rejects(create(adapter, 'blocked'), /La terminal agotó el rango asignado/);
    assert.equal((await adapter.getMasterNumberRanges())[0].status, 'EXHAUSTED');
    await adapter.upsertMasterNumberRanges([makeRange({ id: 'range-next', start_number: 1100, next_number: 1100, last_issued_number: 1099, end_number: 1199 })]);
    assert.equal((await create(adapter, 'next')).code, 'CLI-001100');
    assert.equal((await adapter.getMasterNumberRanges()).length, 2);
  } finally { native.close(); }
});

test('el ACK de progreso es idempotente y un número menor no reabre pendientes', async () => {
  const { adapter, native } = await openHarness();
  try {
    await adapter.upsertMasterNumberRanges([makeRange()]);
    await create(adapter, 'c');
    await adapter.markMasterNumberRangeProgressReported('range-customer', 1000);
    await adapter.markMasterNumberRangeProgressReported('range-customer', 1000);
    await adapter.markMasterNumberRangeProgressReported('range-customer', 999);
    const range = (await adapter.getMasterNumberRanges())[0];
    assert.equal(range.lastReportedNumber, 1000);
    assert.equal(range.progressPending, false);
  } finally { native.close(); }
});

test('un rango de otra terminal o bloqueado nunca puede consumirse', async () => {
  const { adapter, native } = await openHarness();
  try {
    await adapter.upsertMasterNumberRanges([{ ...makeRange(), terminalId: 'another-terminal' }]);
    await assert.rejects(create(adapter, 'foreign'), /La terminal agotó el rango asignado/);
    await adapter.upsertMasterNumberRanges([makeRange()]);
    await adapter.blockMasterNumberRange('range-customer', 'RANGE_BELONGS_TO_ANOTHER_TERMINAL');
    await adapter.upsertMasterNumberRanges([makeRange()]);
    await assert.rejects(create(adapter, 'blocked'), /La terminal agotó el rango asignado/);
  } finally { native.close(); }
});
