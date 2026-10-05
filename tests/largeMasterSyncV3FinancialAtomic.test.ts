import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { CapacitorSQLiteAdapter } from '../services/db/adapters/CapacitorSQLiteAdapter';
import { LARGE_MASTER_SYNC_V3_SCHEMA_SQL } from '../services/db/LargeMasterSyncV3Schema';
import { DURABLE_OUTBOX_SCHEMA_SQL } from '../services/sync/DurableOutboxSchema';
import type { DurableDocumentMutation } from '../services/db/DatabaseAdapter';
import { build } from 'esbuild';
import type { BusinessConfig, Transaction } from '../types';

const baseline = JSON.stringify(['binding', 'S', 2, 4, 'C']);
const scope = { v3Binding: 'binding', v3WarehouseId: 'W', v3InventoryBaseline: baseline };
function fixture(stock = 5) {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE documents(collection_name TEXT NOT NULL, doc_id TEXT NOT NULL, data TEXT NOT NULL,
    sort_order INTEGER, updatedAt TEXT, PRIMARY KEY(collection_name, doc_id));`);
  sql.exec(LARGE_MASTER_SYNC_V3_SCHEMA_SQL);
  sql.exec(DURABLE_OUTBOX_SCHEMA_SQL);
  sql.exec(`UPDATE master_v3_state SET active_sync_id='S',active_version=2 WHERE singleton=1;
    INSERT INTO master_v3_operational_owner VALUES(1,'S',2,'binding');
    INSERT INTO master_v3_inventory_state VALUES(1,'S',2,4,'C','now');`);
  sql.prepare('INSERT INTO master_v3_inventory_balances VALUES(?,?,?,?,?,?)').run('P', 'W', stock + 3, 2, 1, 'now');
  let failId: string | undefined;
  const bridge = {
    query: async (query: string, params: any[] = []) => ({ values: sql.prepare(query).all(...params) }),
    execute: async (query: string) => { sql.exec(query); },
    run: async (query: string, params: any[] = []) => {
      if (params[1] === failId) throw Error('injected disk failure');
      return sql.prepare(query).run(...params);
    },
  };
  const adapter = new CapacitorSQLiteAdapter();
  Object.assign(adapter, { db: bridge, isReady: true });
  const rows = (collection: string) => sql.prepare('SELECT data FROM documents WHERE collection_name=?').all(collection).map(row => JSON.parse(String(row.data)));
  return { sql, adapter, rows, failOn: (id?: string) => { failId = id; } };
}
function sale(id: string, quantity: number, requireStock = true): DurableDocumentMutation[] {
  const document = { id, ...scope, total: 118, netAmount: 100, taxAmount: 18 };
  return [
    { collectionName: 'transactions', document, requireAbsent: true,
      v3StockRequirements: requireStock ? [{ baseline, productId: 'P', warehouseId: 'W', quantity }] : [] },
    { collectionName: 'transactionHistory', document, requireAbsent: true },
    { collectionName: 'inventoryLedger', requireAbsent: true, document: { id: `V3-${id}-line`, ...scope,
      productId: 'P', warehouseId: 'W', qtyOut: quantity, qtyIn: 0, syncStatus: 'PENDING' } },
  ];
}
test('native concurrent distinct sales recheck demand after acquiring the write transaction', async () => {
  const f = fixture();
  try {
    // Both callers observed baseline availability 5 before entering the adapter.
    const results = await Promise.allSettled([
      f.adapter.saveDocumentsAtomically(sale('A', 4)), f.adapter.saveDocumentsAtomically(sale('B', 4)),
    ]);
    assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
    assert.match(String((results.find(row => row.status === 'rejected') as PromiseRejectedResult).reason), /STOCK_INSUFFICIENT/);
    assert.equal(f.rows('transactions').length, 1);
    assert.equal(f.rows('transactionHistory').length, 1);
    assert.equal(f.rows('inventoryLedger').length, 1);
  } finally { f.sql.close(); }
});
test('aggregate demand includes multiple sale documents and duplicate item lines, scoped ACK never releases stock', async () => {
  const f = fixture();
  try {
    await assert.rejects(f.adapter.saveDocumentsAtomically([...sale('A', 3), ...sale('B', 3)]), /STOCK_INSUFFICIENT/);
    assert.equal(f.rows('transactions').length, 0);
    const first = sale('A', 3);
    first[2].document.syncStatus = 'APPLIED_ERP';
    await f.adapter.saveDocumentsAtomically(first);
    // Existing ledger from another ownership/baseline must not affect this candidate's availability.
    f.sql.prepare('INSERT INTO documents(collection_name,doc_id,data) VALUES(?,?,?)').run('inventoryLedger', 'foreign', JSON.stringify({
      id: 'foreign', ...scope, v3InventoryBaseline: 'foreign baseline', productId: 'P', warehouseId: 'W', qtyIn: 100, qtyOut: 0,
    }));
    const next = sale('B', 3);
    next[0].v3StockRequirements = [
      { baseline, productId: 'P', warehouseId: 'W', quantity: 1 },
      { baseline, productId: 'P', warehouseId: 'W', quantity: 2 },
    ];
    await assert.rejects(f.adapter.saveDocumentsAtomically(next), /STOCK_INSUFFICIENT/);
    assert.equal(f.rows('transactions').length, 1);
  } finally { f.sql.close(); }
});
test('mixed sale/refund failure rolls back documents, history, wallet, customer, original, ledger and outbox', async () => {
  const f = fixture();
  try {
    const customer = { id: 'customer', currentDebt: 20 };
    const original = { id: 'original', ...scope, status: 'COMPLETED' };
    await f.adapter.saveDocumentsAtomically([
      { collectionName: 'customers', document: customer },
      { collectionName: 'transactions', document: original },
      { collectionName: 'transactionHistory', document: original },
    ]);
    const documents = [...sale('sale', 2),
      { collectionName: 'customers', document: { ...customer, currentDebt: 25 }, expectedDocument: JSON.stringify(customer) },
      { collectionName: 'wallets', document: { id: 'wallet', balance: 10 }, requireAbsent: true },
      { collectionName: 'wallet_transactions', document: { id: 'wallet-event', amount: 10 }, requireAbsent: true },
      { collectionName: 'transactions', document: { ...original, status: 'PARTIAL_REFUND' }, expectedDocument: JSON.stringify(original) },
      { collectionName: 'transactionHistory', document: { ...original, status: 'PARTIAL_REFUND' }, expectedDocument: JSON.stringify(original) },
      { collectionName: 'transactions', document: { id: 'refund', ...scope }, requireAbsent: true },
      { collectionName: 'transactionHistory', document: { id: 'refund', ...scope }, requireAbsent: true },
      { collectionName: 'inventoryLedger', document: { id: 'refund-ledger', ...scope, productId: 'P', warehouseId: 'W', qtyIn: 1, qtyOut: 0 }, requireAbsent: true },
    ];
    const input = { documents, outboxEvent: { eventId: 'event', eventType: 'SALE_POSTED', aggregateType: 'TRANSACTION',
      aggregateId: 'sale', schemaVersion: 1, payload: {}, createdAt: 'now' } };
    f.failOn('refund-ledger');
    await assert.rejects(f.adapter.commitFinancialTransaction(input), /disk failure/);
    assert.deepEqual(f.rows('customers'), [customer]);
    assert.deepEqual(f.rows('transactions'), [original]);
    assert.deepEqual(f.rows('transactionHistory'), [original]);
    for (const name of ['wallets', 'wallet_transactions', 'inventoryLedger']) assert.equal(f.rows(name).length, 0);
    assert.equal((f.sql.prepare('SELECT COUNT(*) n FROM sync_outbox_v2').get() as any).n, 0);
    f.failOn();
    await f.adapter.commitFinancialTransaction(input);
    assert.equal(f.rows('transactions').length, 3);
    assert.equal(f.rows('inventoryLedger').length, 2);
    assert.equal((f.sql.prepare('SELECT COUNT(*) n FROM sync_outbox_v2').get() as any).n, 1);
    await assert.rejects(f.adapter.commitFinancialTransaction(input), /DUPLICATE_COMMIT/);
  } finally { f.sql.close(); }
});
test('concurrent customer CAS fails atomically; refunds and explicit negative-stock policy impose no sale demand', async () => {
  const f = fixture(0);
  try {
    const before = { id: 'customer', currentDebt: 0 };
    await f.adapter.saveDocumentsAtomically([{ collectionName: 'customers', document: before }]);
    const mutation = (id: string) => [...sale(id, 1, false), { collectionName: 'customers',
      document: { ...before, currentDebt: 10 }, expectedDocument: JSON.stringify(before) }];
    const results = await Promise.allSettled([f.adapter.saveDocumentsAtomically(mutation('A')), f.adapter.saveDocumentsAtomically(mutation('B'))]);
    assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
    assert.match(String((results.find(row => row.status === 'rejected') as PromiseRejectedResult).reason), /CONCURRENT_FINANCIAL_UPDATE/);
    assert.equal(f.rows('transactions').length, 1);
    await f.adapter.saveDocumentsAtomically([{ collectionName: 'transactions', document: { id: 'refund', ...scope }, requireAbsent: true },
      { collectionName: 'inventoryLedger', document: { id: 'refund-ledger', ...scope, productId: 'P', warehouseId: 'W', qtyIn: 1, qtyOut: 0 }, requireAbsent: true }]);
    assert.equal(f.rows('inventoryLedger').length, 2);
    await assert.rejects(f.adapter.saveDocumentsAtomically(sale('C', 1)), /STOCK_INSUFFICIENT/);
  } finally { f.sql.close(); }
});

// Keep the browser/identity boundary mocked while executing the real batch builder and native SQLite adapter.
async function financialModule(f: ReturnType<typeof fixture>, durable = false) {
  const stamp = { binding: 'binding', warehouseId: 'W', syncId: 'S', syncVersion: 2, tariffId: 'T',
    taxIncluded: true, inventoryVersion: 4, inventoryCursor: 'C' };
  const globals = globalThis as any;
  globals.__v3FinancialFixture = { adapter: f.adapter, durable,
    db: { getDocument: (name: string, id: string) => f.adapter.getDocument(name, id), get: (name: string) => f.adapter.getCollection(name) },
    session: { binding: 'binding', assertCurrent: async () => {}, projectConfig: async (config: any) => ({ ...config,
      terminals: [], taxes: [{ id: 'TX', name: 'ITBIS', rate: 0.18, type: 'VAT' }] }),
      validate: async (_config: any, items: any[], _tariff: string, _warehouse: string, _intent: string, validated: any) => {
        for (const line of items) validated?.(line, line);
      }, stockRequirements: async (_config: any, items: any[], _warehouse: string, intent: string) =>
        intent === 'REFUND' ? [] : items.filter(line => line.type === 'PRODUCT' && line.isInventoriable).map(line => ({
          baseline, productId: line.id, warehouseId: 'W', quantity: line.quantity })) },
  };
  globals.window = { dispatchEvent: () => {} };
  const modules: Record<string, string> = {
    '../db': 'export const dbAdapter=globalThis.__v3FinancialFixture.adapter;',
    '../../utils/db': 'export const db=globalThis.__v3FinancialFixture.db;',
    './SyncFeatureFlags': 'export const isSyncFeatureEnabled=()=>globalThis.__v3FinancialFixture.durable;',
    './DurableOutboxRepository': 'export const durableOutboxRepository={commitFinancialTransaction:input=>globalThis.__v3FinancialFixture.adapter.commitFinancialTransaction(input)};',
    '../CheckoutDiagnostics': 'export const recordCheckoutDiagnostic=()=>{};',
    './LargeMasterSyncV3OperationalSession': `export const getLargeMasterSyncV3OperationalSession=async()=>globalThis.__v3FinancialFixture.session;
      export const v3InventoryBaselineKey=(binding,stamp)=>JSON.stringify([binding,stamp.syncId,stamp.syncVersion,stamp.inventoryVersion,stamp.inventoryCursor]);`,
  };
  const result = await build({ entryPoints: [new URL('../services/sync/LargeMasterSyncV3FinancialCommit.ts', import.meta.url).pathname],
    bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'v3-financial-boundaries', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => modules[args.path] ? { path: args.path, namespace: 'v3-test' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'v3-test' }, args => ({ contents: modules[args.path], loader: 'js' }));
    } }] });
  const module = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text + `\n//${crypto.randomUUID()}`).toString('base64')}`);
  const transaction = (id: string, refund = false): Transaction => ({ id, documentType: refund ? 'REFUND' : 'TICKET',
    displayId: id, date: '2026-10-05T00:00:00Z', terminalId: 'T1', status: refund ? 'REFUNDED' : 'COMPLETED',
    total: 118, netAmount: 100, taxAmount: 18, payments: [], userId: 'user', userName: 'User', customerId: 'customer',
    items: [{ id: 'P', cartId: id + '-line', name: 'Product', price: 118, quantity: 1, type: 'PRODUCT',
      isInventoriable: true, taxable: true, appliedTaxIds: ['TX'], netAmount: 100, taxAmount: 18, totalAmount: 118, v3SaleAuthority: stamp }],
  } as Transaction);
  return { ...module, transaction };
}
test('real batch builder merges refund deposit + sale debit and customer CAS, then replays without extra debt or ledger', async () => {
  const f = fixture();
  try {
    await f.adapter.saveDocumentsAtomically([{ collectionName: 'customers', document: { id: 'customer', currentDebt: 2 } }]);
    const module = await financialModule(f);
    const refund = { ...module.transaction('refund', true), walletDepositAmount: 50 };
    const sale = { ...module.transaction('sale'), walletPaymentAmount: 20, pendingBalance: 10 };
    const entries = [{ transaction: refund, options: { refund: true } }, { transaction: sale }];
    const result = await module.persistV3FinancialBatch(entries, {} as BusinessConfig, 'W');
    assert.equal(result.length, 2);
    assert(result.every((row: any) => row.created));
    assert.equal(f.rows('wallets')[0].balance, 30);
    assert.equal(f.rows('customers')[0].currentDebt, 12);
    assert.equal(f.rows('customers')[0].wallet.balance, 30);
    assert.equal(f.rows('wallet_transactions').length, 2);
    assert.equal(f.rows('transactions').length, 2);
    assert.equal(f.rows('inventoryLedger').length, 2);
    await f.adapter.saveDocument('transactions', { id: 'sale', syncStatus: 'APPLIED_ERP', zReportId: 'Z1',
      fiscalResponseMessage: 'certified', items: [], total: 999 });
    const replay = await module.persistV3FinancialBatch(entries, {} as BusinessConfig, 'W');
    assert(replay.every((row: any) => !row.created));
    assert.equal(f.rows('wallets')[0].balance, 30);
    assert.equal(f.rows('customers')[0].currentDebt, 12);
    assert.equal(f.rows('inventoryLedger').length, 2);
    // The ordinary App callback can replay the already committed companion sale independently.
    assert.equal((await module.persistV3FinancialTransaction(sale, {} as BusinessConfig, 'W')).created, false);
    await assert.rejects(module.persistV3FinancialTransaction({ ...sale, pendingBalance: 11 }, {} as BusinessConfig, 'W'), /DUPLICATE_TRANSACTION_MISMATCH/);
  } finally { f.sql.close(); }
});
test('real batch builder preserves enabled sale/payment events in same commit and rejects one missing companion', async () => {
  const f = fixture();
  try {
    const module = await financialModule(f, true);
    const refund = { ...module.transaction('refund', true), customerId: undefined };
    const sale = { ...module.transaction('sale'), customerId: undefined,
      payments: [{ id: 'payment', method: 'CASH', amount: 118, timestamp: '2026-10-05T00:00:00Z' }] };
    const entries = [{ transaction: refund, options: { refund: true } }, { transaction: sale }];
    await module.persistV3FinancialBatch(entries, {} as BusinessConfig, 'W');
    const events = f.sql.prepare('SELECT event_type FROM sync_outbox_v2 ORDER BY local_sequence').all();
    assert.deepEqual(events.map(row => row.event_type), ['SALE_POSTED', 'PAYMENT_POSTED']);
    f.sql.prepare("DELETE FROM documents WHERE collection_name='transactions' AND doc_id='refund'").run();
    await assert.rejects(module.persistV3FinancialBatch(entries, {} as BusinessConfig, 'W'), /DUPLICATE_TRANSACTION_MISMATCH/);
    assert.equal(f.rows('inventoryLedger').length, 2);
    assert.equal(events.length, 2);
  } finally { f.sql.close(); }
});
test('V3 fiscal source rejects missing totals/mixed tax-inclusion before commit; service and damaged refund never create stock movements', async () => {
  const f = fixture();
  try {
    const module = await financialModule(f);
    const transaction = module.transaction('sale');
    module.validateV3FrozenFiscalAmounts(transaction);
    assert.throws(() => module.validateV3FrozenFiscalAmounts({ ...transaction, netAmount: undefined }), /FROZEN_FISCAL_INVALID/);
    assert.throws(() => module.validateV3FrozenFiscalAmounts({ ...transaction, isTaxIncluded: false }), /FROZEN_FISCAL_INVALID/);
    assert.throws(() => module.validateV3FrozenFiscalAmounts({ ...transaction, taxAmount: 19 }), /FROZEN_FISCAL_INVALID/);
    await assert.rejects(module.persistV3FinancialBatch([{ transaction: { ...transaction, taxAmount: undefined } }], {} as BusinessConfig, 'W'), /FROZEN_FISCAL_INVALID/);
    assert.equal(f.rows('transactions').length, 0);
    const service = { ...transaction, items: [{ ...transaction.items[0], type: 'SERVICE', isInventoriable: false }] };
    assert.deepEqual(module.buildV3InventoryLedger(service, 'W', 'binding'), []);
    const untracked = { ...transaction, items: [{ ...transaction.items[0], isInventoriable: false }] };
    assert.deepEqual(module.buildV3InventoryLedger(untracked, 'W', 'binding'), []);
    assert.deepEqual(module.buildV3InventoryLedger(transaction, 'W', 'binding', true,
      new Map([[transaction.items[0].cartId, 'DAMAGED']])), []);
    const ledger = module.buildV3InventoryLedger(transaction, 'W', 'binding');
    assert.equal(ledger[0].id, 'V3-sale-sale-line');
    assert.equal(ledger[0].qtyOut, 1);
    assert.equal(module.buildV3InventoryLedger(transaction, 'W', 'binding', true)[0].qtyIn, 1);
  } finally { f.sql.close(); }
});
