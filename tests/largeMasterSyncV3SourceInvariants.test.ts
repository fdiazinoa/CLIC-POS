import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import type { BusinessConfig, CartItem, Product, Transaction } from '../types';
import { LARGE_MASTER_SYNC_V3_SCHEMA_SQL } from '../services/db/LargeMasterSyncV3Schema';
import { LargeMasterSyncV3SqliteStore } from '../services/db/LargeMasterSyncV3SqliteStore';
import { CapacitorSQLiteAdapter } from '../services/db/adapters/CapacitorSQLiteAdapter';
import { validateV3FrozenLineFiscalAmounts, validateV3PinnedLineSource } from '../services/sync/LargeMasterSyncV3LineSource';
import { resetLargeMasterSyncV3OperationGateForTests, setLargeMasterSyncV3CriticalOperation } from '../services/sync/LargeMasterSyncV3OperationGate';
import { setPosSaleActivity } from '../utils/posSaleActivity';

const stamp = { binding: 'binding', warehouseId: 'W', syncId: 'S', syncVersion: 2, tariffId: 'T',
  taxIncluded: true, inventoryVersion: 4, inventoryCursor: 'C' };
const baseline = JSON.stringify(['binding', 'S', 2, 4, 'C']);
const product = { id: 'P', name: 'Product', price: 118, type: 'PRODUCT', isInventoriable: true,
  taxable: true, appliedTaxIds: ['TX'], variants: [{ id: 'V', sku: 'SKU-V' }], v3SaleAuthority: stamp } as Product;
const line = { ...product, cartId: 'line', variantId: 'V', variantSku: 'SKU-V', quantity: 1,
  netAmount: 100, taxAmount: 18, totalAmount: 118 } as CartItem;
const config = { terminals: [], taxes: [{ id: 'TX', rate: 0.18, type: 'VAT', name: 'ITBIS' }], taxRate: 0 } as BusinessConfig;
const sale = (): Transaction => ({ id: 'sale', total: 118, netAmount: 100, taxAmount: 18,
  items: [{ ...line }], payments: [], date: '2026-10-05', userId: 'U', userName: 'User',
  status: 'COMPLETED', isTaxIncluded: true, documentType: 'TICKET', terminalId: 'T1',
  v3Binding: 'binding', v3WarehouseId: 'W', v3InventoryBaseline: baseline, v3CommitFingerprint: 'fingerprint',
  relatedTransactions: ['local-refund'] });

function sqliteFixture() {
  const sql = new DatabaseSync(':memory:');
  const bridge = {
    query: async (query: string, values: any[] = []) => ({ values: sql.prepare(query).all(...values) }),
    execute: async (query: string) => { sql.exec(query); },
    run: async (query: string, values: any[] = []) => sql.prepare(query).run(...values),
  };
  const adapter = new CapacitorSQLiteAdapter();
  Object.assign(adapter, { db: bridge, isReady: true });
  return { sql, bridge, adapter };
}
test('pinned line rejects type, inventory, taxable, tax inclusion and variant tampering before a simulated side effect', () => {
  validateV3PinnedLineSource(line, product, stamp);
  const changes: Partial<CartItem>[] = [
    { type: 'SERVICE' }, { isInventoriable: false }, { taxable: false }, { appliedTaxIds: [] },
    { v3SaleAuthority: { ...stamp, taxIncluded: false } }, { variantId: 'foreign' }, { variantSku: 'foreign' },
  ];
  let mutations = 0;
  for (const patch of changes) {
    assert.throws(() => {
      validateV3PinnedLineSource({ ...line, ...patch }, product, stamp);
      ++mutations;
    }, /SYNC_V3_(ARTICLE|VARIANT)_SOURCE_CHANGED/);
  }
  assert.equal(mutations, 0);
  assert.throws(() => validateV3PinnedLineSource(line, { ...product, variants: [] }, stamp), /VARIANT_SOURCE_CHANGED/);
});
test('frozen fiscal source rejects plausible aggregate totals with altered line taxes while preserving final price edits and discounts', () => {
  validateV3FrozenLineFiscalAmounts(sale(), config);
  const changed = { ...sale(), total: 118, netAmount: 118, taxAmount: 0,
    items: [{ ...line, netAmount: 118, taxAmount: 0, totalAmount: 118 }] };
  assert.throws(() => validateV3FrozenLineFiscalAmounts(changed, config), /FROZEN_FISCAL_SOURCE_CHANGED/);
  assert.throws(() => validateV3FrozenLineFiscalAmounts({ ...sale(), items: [{ ...line, taxAmount: 0 }] }, config), /FROZEN_FISCAL_SOURCE_CHANGED/);
  assert.throws(() => validateV3FrozenLineFiscalAmounts({ ...sale(), total: 218, netAmount: 200, serviceChargeAmount: 100,
    items: [{ ...line, netAmount: 200, totalAmount: 218 }] }, config), /FROZEN_FISCAL_SOURCE_CHANGED/);
  validateV3FrozenLineFiscalAmounts({ ...sale(), total: 236, netAmount: 200, taxAmount: 36,
    items: [{ ...line, price: 236, netAmount: 200, taxAmount: 36, totalAmount: 236 }] }, config);
  validateV3FrozenLineFiscalAmounts({ ...sale(), total: 59, netAmount: 50, taxAmount: 9, discountAmount: 59,
    items: [{ ...line, netAmount: 50, taxAmount: 9, totalAmount: 59 }] }, config);
});
test('every direct native baseline mutation rejects held cart or payment before the first ledger row', async () => {
  const f = sqliteFixture();
  try {
    f.sql.exec(LARGE_MASTER_SYNC_V3_SCHEMA_SQL);
    f.sql.exec(`INSERT INTO sync_v3_sessions(sync_id,sync_version,schema_version,contract_version,status,manifest_json,created_at,updated_at)
      VALUES('S',2,3,2,'ACTIVE','{}','now','now'),('N',3,3,2,'VALIDATED','{}','now','now'),('OLD',1,3,2,'ROLLED_BACK','{}','now','now');
      UPDATE master_v3_state SET active_sync_id='S',active_version=2,staging_sync_id='N',staging_version=3,previous_sync_id='OLD',previous_version=1 WHERE singleton=1;
      INSERT INTO master_v3_operational_owner VALUES(1,'S',2,'binding');
      INSERT INTO master_v3_inventory_state VALUES(1,'S',2,4,'C','now');`);
    const store = new LargeMasterSyncV3SqliteStore(() => f.bridge, async operation => operation());
    const operations = [() => store.activate('N'), () => store.activate('S'), () => store.rollback(),
      () => store.replaceInventorySnapshot({ syncId: 'S', syncVersion: 2, contractVersion: 2 }, { version: 5, cursor: 'new', balances: [] }),
      () => store.setOperationalOwner({ syncId: 'S', syncVersion: 2, contractVersion: 2 }, 'other')];
    for (const held of ['cart', 'payment']) {
      if (held === 'cart') setPosSaleActivity({ active: true, cartCount: 1 });
      else setLargeMasterSyncV3CriticalOperation('PAYMENT', true);
      for (const operation of operations) await assert.rejects(operation(), /OPERATIONAL_WINDOW_HELD/);
      setPosSaleActivity({ active: false });
      resetLargeMasterSyncV3OperationGateForTests();
      assert.equal((f.sql.prepare('SELECT active_sync_id FROM master_v3_state').get() as any).active_sync_id, 'S');
      assert.equal((f.sql.prepare('SELECT cursor FROM master_v3_inventory_state').get() as any).cursor, 'C');
      assert.equal((await store.getOperationalOwner())?.binding, 'binding');
    }
    const baseQuery = f.bridge.query;
    f.bridge.query = async (query, values = []) => {
      const result = await baseQuery(query, values);
      if (query === 'SELECT * FROM master_v3_state WHERE singleton = 1') setLargeMasterSyncV3CriticalOperation('PAYMENT', true);
      return result;
    };
    await assert.rejects(store.activate('N'), /OPERATIONAL_WINDOW_HELD/);
    assert.equal((f.sql.prepare('SELECT active_sync_id FROM master_v3_state').get() as any).active_sync_id, 'S');
  } finally { setPosSaleActivity({ active: false }); resetLargeMasterSyncV3OperationGateForTests(); f.sql.close(); }
});
test('actual native schema preserves V3 financial authority across incoming replacements, ACK/fiscal/Z updates and pruning', async () => {
  const f = sqliteFixture();
  try {
    // Exercise the production schema initializer and installed triggers, not a documents-only imitation.
    await (f.adapter as any).initSchema();
    f.sql.exec(`INSERT INTO sync_v3_sessions(sync_id,sync_version,schema_version,contract_version,status,manifest_json,created_at,updated_at)
      VALUES('S',2,3,2,'ACTIVE','{}','now','now');
      UPDATE master_v3_state SET active_sync_id='S',active_version=2 WHERE singleton=1;
      INSERT INTO master_v3_operational_owner VALUES(1,'S',2,'binding');
      INSERT INTO master_v3_inventory_state VALUES(1,'S',2,4,'C','now');`);
    const before = sale();
    await f.adapter.saveDocumentsAtomically([
      { collectionName: 'transactions', document: before, requireAbsent: true, v3StockRequirements: [] },
      { collectionName: 'transactionHistory', document: before, requireAbsent: true },
    ]);
    const incoming = { id: 'sale', total: 999, items: [], syncStatus: 'APPLIED_ERP', status: 'PARTIAL_REFUND',
      fiscalSyncStatus: 'SYNCED', fiscalResponseMessage: 'certified', zReportId: 'Z1', relatedTransactions: ['remote-refund'] };
    await f.adapter.bulkUpsert('transactions', [incoming]);
    await f.adapter.saveCollection('transactionHistory', [incoming]);
    for (const collection of ['transactions', 'transactionHistory']) {
      const current = await f.adapter.getDocument<any>(collection, 'sale');
      for (const key of ['v3Binding', 'v3InventoryBaseline', 'v3WarehouseId', 'v3CommitFingerprint', 'items', 'total', 'netAmount', 'taxAmount']) {
        assert.deepEqual(current[key], (before as any)[key]);
      }
      assert.equal(current.syncStatus, 'APPLIED_ERP');
      assert.equal(current.fiscalResponseMessage, 'certified');
      assert.equal(current.zReportId, 'Z1');
      assert.deepEqual(new Set(current.relatedTransactions), new Set(['local-refund', 'remote-refund']));
      const operationalMetadata = { syncStartedAt: '2026-10-05T10:00:00Z', syncRetryAfter: '2026-10-05T10:05:00Z',
        syncBlockedReason: 'ERP_UNAVAILABLE', syncBlockedAt: '2026-10-05T10:00:01Z', _forceSyncReplay: true };
      await f.adapter.saveDocument(collection, { ...current, ...operationalMetadata, total: 999, items: [] });
      const retry = await f.adapter.getDocument<any>(collection, 'sale');
      for (const [key, value] of Object.entries(operationalMetadata)) assert.equal(retry[key], value);
      assert.equal(retry.total, before.total);
      assert.deepEqual(retry.items, before.items);
      assert.equal(retry.v3CommitFingerprint, before.v3CommitFingerprint);
      await f.adapter.bulkUpsert(collection, [{ id: 'sale', syncStatus: 'APPLIED_ERP' }]);
      const partialAck = await f.adapter.getDocument<any>(collection, 'sale');
      for (const [key, value] of Object.entries(operationalMetadata)) assert.equal(partialAck[key], value);
      const incompleteSource = { id: 'sale', v3CommitFingerprint: before.v3CommitFingerprint, syncStatus: 'SYNCED_CLOUD' };
      await f.adapter.saveDocument(collection, incompleteSource);
      assert.equal((await f.adapter.getDocument<any>(collection, 'sale')).syncRetryAfter, operationalMetadata.syncRetryAfter);
      await f.adapter.saveDocument(collection, { ...retry, total: 999, syncRetryAfter: undefined });
      assert.equal((await f.adapter.getDocument<any>(collection, 'sale')).syncRetryAfter, operationalMetadata.syncRetryAfter);
      // Match the real BackgroundSyncManager protocol: delete timestamps and serialize undefined blocked fields.
      const completed = { ...retry, _forceSyncReplay: false, syncBlockedReason: undefined, syncBlockedAt: undefined };
      delete completed.syncStartedAt;
      delete completed.syncRetryAfter;
      await f.adapter.saveDocument(collection, completed);
      const completedStored = await f.adapter.getDocument<any>(collection, 'sale');
      assert.equal(completedStored._forceSyncReplay, false);
      for (const key of ['syncStartedAt', 'syncRetryAfter', 'syncBlockedReason', 'syncBlockedAt']) {
        assert.equal(completedStored[key], undefined);
      }
      await f.adapter.saveDocument(collection, { ...retry, _forceSyncReplay: false, syncRetryAfter: null,
        syncBlockedReason: null, syncBlockedAt: null });
      const cleared = await f.adapter.getDocument<any>(collection, 'sale');
      assert.equal(cleared._forceSyncReplay, false);
      for (const key of ['syncRetryAfter', 'syncBlockedReason', 'syncBlockedAt']) assert.equal(cleared[key], undefined);
      await f.adapter.deleteDocument(collection, 'sale');
      assert(await f.adapter.getDocument(collection, 'sale'));
      await assert.rejects(f.adapter.executeSQL!('UPDATE documents SET data = ? WHERE collection_name = ? AND doc_id = ?',
        [JSON.stringify(incoming), collection, 'sale']), /FINANCIAL_AUTHORITY_IMMUTABLE/);
    }
    await f.adapter.saveCollection('transactions', []);
    assert(await f.adapter.getDocument('transactions', 'sale'));
    await f.adapter.saveDocument('transactions', { id: 'legacy', total: 1 });
    await f.adapter.saveDocument('transactions', { id: 'legacy', total: 2 });
    assert.equal((await f.adapter.getDocument<any>('transactions', 'legacy')).total, 2);
    await f.adapter.deleteDocument('transactions', 'legacy');
    assert.equal(await f.adapter.getDocument('transactions', 'legacy'), null);
  } finally { f.sql.close(); }
});
