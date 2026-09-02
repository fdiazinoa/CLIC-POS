import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

const storage = new MemoryStorage();
Object.assign(globalThis, {
  localStorage: storage,
  sessionStorage: new MemoryStorage(),
  CustomEvent: class { constructor(public type: string, public options?: unknown) {} },
  window: {
    localStorage: storage,
    setTimeout,
    clearTimeout,
    dispatchEvent: () => true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  },
});

const contract = await import('../services/sync/masterNumberRangeContract');

const rawRange = (overrides: Record<string, unknown> = {}) => ({
  id: 'range-cli-1',
  entity_type: 'CUSTOMER',
  prefix: 'CLI',
  start_number: 1,
  end_number: 100,
  next_number: 1,
  last_issued_number: null,
  padding: 5,
  status: 'ACTIVE',
  updated_at: '2026-09-02T12:00:00.000Z',
  ...overrides,
});

test('normaliza aliases CLI/PRO/ART y extrae resolved.master_number_ranges', () => {
  const ranges = contract.extractMasterNumberRanges({ resolved: { master_number_ranges: [
    rawRange({ entity_type: 'CLI' }),
    rawRange({ id: 'pro', entity_type: 'PRO', prefix: 'PRO-' }),
    rawRange({ id: 'art', entity_type: 'ART', prefix: 'ART-' }),
  ] } });
  assert.deepEqual(ranges.map(row => row.entityType), ['CUSTOMER', 'SUPPLIER', 'ITEM']);
});

test('aplica padding y mapeos independientes para los tres maestros', () => {
  const customerRange = contract.normalizeMasterNumberRange(rawRange())!;
  const supplierRange = contract.normalizeMasterNumberRange(rawRange({ id: 'pro', entity_type: 'SUPPLIER', prefix: 'PRO-' }))!;
  const itemRange = contract.normalizeMasterNumberRange(rawRange({ id: 'art', entity_type: 'ITEM', prefix: 'ART-' }))!;
  const customer = contract.applyMasterNumberToDocument('CUSTOMER', { id: 'uuid-c' }, customerRange, 7, 'terminal-1');
  const supplier = contract.applyMasterNumberToDocument('SUPPLIER', { id: 'uuid-s' }, supplierRange, 8, 'terminal-1');
  const item = contract.applyMasterNumberToDocument('ITEM', { id: 'uuid-i' }, itemRange, 9, 'terminal-1');
  assert.equal(customer.customer_code, 'CLI-00007');
  assert.equal(customer.external_code, 'CLI-00007');
  assert.equal(supplier.supplier_code, 'PRO-00008');
  assert.equal(item.sku, 'ART-00009');
  assert.equal(item.master_number_range_id, 'art');
});

test('el UUID del cliente y source_customer_id no se confunden con customer_code', () => {
  const range = contract.normalizeMasterNumberRange(rawRange())!;
  const customer = contract.applyMasterNumberToDocument(
    'CUSTOMER',
    { id: 'uuid-local', source_customer_id: 'uuid-source' },
    range,
    3,
    'terminal-1',
  );
  assert.equal(customer.id, 'uuid-local');
  assert.equal(customer.source_customer_id, 'uuid-source');
  assert.equal(customer.customer_code, 'CLI-00003');
});

test('un snapshot remoto nunca hace retroceder next_number ni last_issued_number', () => {
  const local = contract.normalizeMasterNumberRange(rawRange({ next_number: 45, last_issued_number: 44 }))!;
  const stale = contract.normalizeMasterNumberRange(rawRange({ next_number: 12, last_issued_number: 11 }))!;
  const merged = contract.mergeMasterNumberRange(local, stale);
  assert.equal(merged.nextNumber, 45);
  assert.equal(merged.lastIssuedNumber, 44);
});

test('marca agotado cuando el cursor efectivo supera el final y calcula diagnóstico <=20%', () => {
  const range = contract.normalizeMasterNumberRange(rawRange({ start_number: 1, end_number: 10, next_number: 10 }))!;
  const diagnostic = contract.masterNumberRangeDiagnostics(range);
  assert.equal(diagnostic.remaining, 1);
  assert.equal(diagnostic.warning, true);
  const exhausted = contract.normalizeMasterNumberRange(rawRange({ start_number: 1, end_number: 10, next_number: 11 }))!;
  assert.equal(exhausted.status, 'EXHAUSTED');
});

test('preserva códigos existentes y no solicita un rango nuevo', () => {
  assert.equal(contract.hasMasterCode('CUSTOMER', { customer_code: 'CLI-00001' }), true);
  assert.equal(contract.hasMasterCode('SUPPLIER', { external_code: 'LEGACY-9' }), true);
  assert.equal(contract.hasMasterCode('ITEM', { sku: 'SKU-OLD' }), true);
  assert.equal(contract.hasMasterCode('ITEM', {}), false);
});

test('el bloqueo por rango de otra terminal no se revierte con el mismo snapshot', () => {
  const remote = contract.normalizeMasterNumberRange(rawRange())!;
  const blocked = { ...remote, status: 'BLOCKED', blockedReason: 'RANGE_BELONGS_TO_ANOTHER_TERMINAL' };
  const merged = contract.mergeMasterNumberRange(blocked, remote);
  assert.equal(merged.status, 'BLOCKED');
});

test('el contrato Android reserva cursor y documento bajo BEGIN IMMEDIATE', async () => {
  const source = await readFile(new URL('../services/db/adapters/CapacitorSQLiteAdapter.ts', import.meta.url), 'utf8');
  assert.match(source, /BEGIN IMMEDIATE TRANSACTION/);
  assert.match(source, /last_issued_number = \?/);
  assert.match(source, /DOCUMENT_UPSERT_SQL/);
  assert.match(source, /ROLLBACK/);
});

test('IndexedDB usa una sola transacción para rango y maestro, evitando duplicados concurrentes', async () => {
  const source = await readFile(new URL('../services/db/adapters/IndexedDBAdapter.ts', import.meta.url), 'utf8');
  assert.match(source, /const stores = \['masterNumberRanges', input\.collectionName\]/);
  assert.match(source, /transaction\(stores, 'readwrite'\)/);
  assert.match(source, /rangesStore\.put\(updatedRange\)/);
  assert.match(source, /documentsStore\.put\(document\)/);
});

test('CONFIG_PUSH_V2 y refresh persisten los rangos por la ruta monotónica', async () => {
  const lifecycle = await readFile(new URL('../utils/erpSyncLifecycle.ts', import.meta.url), 'utf8');
  const manager = await readFile(new URL('../services/sync/SyncManager.ts', import.meta.url), 'utf8');
  assert.match(lifecycle, /master_number_ranges: masterNumberRanges/);
  assert.match(manager, /persistMasterNumberRangesFromSnapshot\(snapshot, context\.terminalId\)/);
});

test('la cola de progreso conserva el avance y usa el endpoint contractual', async () => {
  const service = await readFile(new URL('../services/sync/MasterNumberRangeService.ts', import.meta.url), 'utf8');
  const api = await readFile(new URL('../services/sync/ApiSyncAdapter.ts', import.meta.url), 'utf8');
  assert.match(service, /last_issued_number: entry\.lastIssuedNumber/);
  assert.match(service, /markMasterNumberRangeProgressReported/);
  assert.match(api, /master-number-ranges\/progress/);
  assert.match(api, /includeHttpStatus: true, reauthenticateOn401: false/);
});

test('la creación sin rango conserva el mensaje operativo exacto', async () => {
  const service = await import('../services/sync/MasterNumberRangeService');
  assert.equal(
    service.MASTER_NUMBER_RANGE_EXHAUSTED_MESSAGE,
    'La terminal agotó el rango asignado. Conéctala y solicita un nuevo rango.',
  );
});

test('progreso espera ACK del maestro, conserva timeout y reenvía idempotentemente', async () => {
  const service = await import('../services/sync/MasterNumberRangeService');
  const { dbAdapter } = await import('../services/db');
  const { apiSyncAdapter } = await import('../services/sync/ApiSyncAdapter');
  const { permissionService } = await import('../services/sync/PermissionService');
  const { syncPolicy } = await import('../services/sync/SyncProfile');
  const { syncManager } = await import('../services/sync/SyncManager');
  const terminalId = '9ffc6771-7845-4976-afd3-20cebc3cc6e8';
  const range = {
    ...contract.normalizeMasterNumberRange(rawRange({ next_number: 2, last_issued_number: 1 }))!,
    terminalId, lastReportedNumber: 0, progressPending: true,
  };
  const receipts: any[] = [];
  const sent: any[] = [];
  const original = {
    getCollection: dbAdapter.getCollection,
    getMasterNumberRanges: dbAdapter.getMasterNumberRanges,
    markReported: dbAdapter.markMasterNumberRangeProgressReported,
    saveDocument: dbAdapter.saveDocument,
    push: apiSyncAdapter.pushMasterNumberRangeProgress,
    resolve: syncPolicy.resolve,
    block: dbAdapter.blockMasterNumberRange,
    refresh: syncManager.refreshTerminalResolvedConfig,
  };
  try {
    permissionService.initialize({ terminals: [{ id: terminalId, config: { erpBinding: { terminalId, tenantId: 'tenant', companyId: 'company' } } }] } as any, terminalId);
    (syncPolicy as any).resolve = () => ({ kind: 'ERP_ACTIVE' });
    (dbAdapter as any).getCollection = async (collection: string) => collection === 'config'
      ? { terminals: [{ id: terminalId, config: { erpBinding: { terminalId, tenantId: 'tenant', companyId: 'company' } } }] }
      : receipts;
    (dbAdapter as any).getMasterNumberRanges = async () => [range];
    (dbAdapter as any).saveDocument = async (_collection: string, document: any) => receipts.push(document);
    (dbAdapter as any).markMasterNumberRangeProgressReported = async (_id: string, value: number) => {
      range.lastReportedNumber = Math.max(range.lastReportedNumber, value);
      range.progressPending = range.lastIssuedNumber! > range.lastReportedNumber;
    };
    let timeout = true;
    (apiSyncAdapter as any).pushMasterNumberRangeProgress = async (_id: string, payload: any) => {
      sent.push(payload);
      if (timeout) throw new Error('TIMEOUT');
      return { httpStatus: 200, data: { status: 'success' } };
    };
    assert.equal(await service.reportPendingMasterNumberRangeProgress(), 0);
    assert.equal(sent.length, 0, 'No debe reportar un maestro no sincronizado');
    await service.markNumberedMasterSynced({ id: 'customer-uuid', master_number_range_id: range.id, master_number_value: 1, source_terminal_id: terminalId });
    await assert.rejects(service.reportPendingMasterNumberRangeProgress(), /TIMEOUT/);
    assert.equal(range.progressPending, true);
    timeout = false;
    assert.equal(await service.reportPendingMasterNumberRangeProgress(), 1);
    assert.deepEqual(sent[0], sent[1]);
    assert.equal(range.progressPending, false);
    assert.equal(await service.reportPendingMasterNumberRangeProgress(), 0);

    range.nextNumber = 3;
    range.lastIssuedNumber = 2;
    range.progressPending = true;
    await service.markNumberedMasterSynced({ id: 'customer-2', master_number_range_id: range.id, master_number_value: 2, source_terminal_id: terminalId });
    let refreshCount = 0;
    (dbAdapter as any).blockMasterNumberRange = async () => { range.status = 'BLOCKED'; };
    (syncManager as any).refreshTerminalResolvedConfig = async () => { refreshCount += 1; return null; };
    (apiSyncAdapter as any).pushMasterNumberRangeProgress = async () => {
      throw new Error('Operational sync failed: 403 MASTER_NUMBER_RANGE_SCOPE_MISMATCH');
    };
    await assert.rejects(service.reportPendingMasterNumberRangeProgress(), /MASTER_NUMBER_RANGE_SCOPE_MISMATCH/);
    assert.equal(range.status, 'BLOCKED');
    assert.equal(refreshCount, 1);
    assert.equal(await service.reportPendingMasterNumberRangeProgress(), 0);
  } finally {
    dbAdapter.getCollection = original.getCollection;
    dbAdapter.getMasterNumberRanges = original.getMasterNumberRanges;
    dbAdapter.markMasterNumberRangeProgressReported = original.markReported;
    dbAdapter.saveDocument = original.saveDocument;
    apiSyncAdapter.pushMasterNumberRangeProgress = original.push;
    syncPolicy.resolve = original.resolve;
    dbAdapter.blockMasterNumberRange = original.block;
    syncManager.refreshTerminalResolvedConfig = original.refresh;
  }
});
