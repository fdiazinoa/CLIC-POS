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
    beginTransaction:async()=>{sql.exec('BEGIN IMMEDIATE');},
    commitTransaction:async()=>{sql.exec('COMMIT');},
    rollbackTransaction:async()=>{sql.exec('ROLLBACK');},
    isTransactionActive:async()=>({result:sql.isTransaction}),
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
  globals.__v3FinancialFixture = { adapter: f.adapter, durable, fiscalAuthorityAllowed: true, fiscalAuthorityChecks: 0, denyAtFiscalCheck: Infinity,
    db: { getDocument: (name: string, id: string) => f.adapter.getDocument(name, id), get: (name: string) => f.adapter.getCollection(name),
      assertFiscalTransactionAuthority: async () => {
        const boundary = globals.__v3FinancialFixture;
        boundary.fiscalAuthorityChecks++;
        if (!boundary.fiscalAuthorityAllowed || boundary.fiscalAuthorityChecks >= boundary.denyAtFiscalCheck) {
          throw new Error('FISCAL_TERMINAL_AUTHORITY_REQUIRED');
        }
      } },
    session: { binding: 'binding', ready: { runtime: { version: { syncId: 'S', syncVersion: 2 } } }, assertCurrent: async () => {}, projectConfig: async (config: any) => ({ ...config,
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
    '../utils/db': 'export const db=globalThis.__v3FinancialFixture.db;',
    './sync/BackgroundSyncManager': 'export const backgroundSyncManager={triggerSync:async()=>{}};',
    './SyncFeatureFlags': 'export const isSyncFeatureEnabled=()=>globalThis.__v3FinancialFixture.durable;',
    './DurableOutboxRepository': 'export const durableOutboxRepository={commitFinancialTransaction:input=>globalThis.__v3FinancialFixture.adapter.commitFinancialTransaction(input)};',
    '../CheckoutDiagnostics': 'export const recordCheckoutDiagnostic=()=>{};',
    './LargeMasterSyncV3OperationalSession': `export const getLargeMasterSyncV3OperationalSession=async()=>globalThis.__v3FinancialFixture.session;
      export const v3InventoryBaselineKey=(binding,stamp)=>JSON.stringify([binding,stamp.syncId,stamp.syncVersion,stamp.inventoryVersion,stamp.inventoryCursor]);`,
  };
  const result = await build({ stdin:{contents:`export * from ${JSON.stringify(new URL('../services/sync/LargeMasterSyncV3FinancialCommit.ts',import.meta.url).pathname)};export {persistStandaloneRefundTransaction} from ${JSON.stringify(new URL('../services/localRefundPersistence.ts',import.meta.url).pathname)};`,resolveDir:new URL('..',import.meta.url).pathname,loader:'ts'},
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
    // Older Android WebViews expose secure getRandomValues but no randomUUID.
    const originalUuid = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID');
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      await module.persistV3FinancialBatch(entries, {} as BusinessConfig, 'W');
    } finally {
      if (originalUuid) Object.defineProperty(globalThis.crypto, 'randomUUID', originalUuid);
      else delete (globalThis.crypto as Partial<Crypto>).randomUUID;
    }
    const eventIds = f.sql.prepare('SELECT event_id FROM sync_outbox_v2').all();
    assert.equal(new Set(eventIds.map(row => row.event_id)).size, 2);
    for (const row of eventIds) assert.match(String(row.event_id), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
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

test('native decimal stock keeps kilogram fractions and rejects actual demand above remaining stock', async () => {
  const f = fixture(0.5);
  try {
    await f.adapter.saveDocumentsAtomically(sale('weighted-quarter', 0.25));
    assert.equal(f.rows('inventoryLedger')[0].qtyOut, 0.25);
    const reopened = new CapacitorSQLiteAdapter();
    Object.assign(reopened, { db: (f.adapter as any).db, isReady: true });
    await assert.rejects(reopened.saveDocumentsAtomically(sale('too-heavy', 0.3)), /STOCK_INSUFFICIENT/);
    await reopened.saveDocumentsAtomically(sale('weighted-eighth', 0.125));
    assert.deepEqual(f.rows('inventoryLedger').map(row => row.qtyOut).sort(), [0.125, 0.25]);
    assert.equal(f.rows('transactions').length, 2);
  } finally { f.sql.close(); }
  const insufficient = fixture(0.2);
  try {
    await assert.rejects(insufficient.adapter.saveDocumentsAtomically(sale('quarter', 0.25)), /STOCK_INSUFFICIENT/);
    assert.equal(insufficient.rows('inventoryLedger').length, 0);
  } finally { insufficient.sql.close(); }
});

test('fiscal authority denial before preparation or final atomic commit publishes no financial effects', async () => {
  for (const denyAtFiscalCheck of [1, 2]) {
    const f = fixture();
    try {
      const module = await financialModule(f, true);
      (globalThis as any).__v3FinancialFixture.denyAtFiscalCheck = denyAtFiscalCheck;
      const transaction = { ...module.transaction(`fiscal-denied-${denyAtFiscalCheck}`), ncfType: 'B02', ncf: 'B0200000100',
        walletPaymentAmount: 20, pendingBalance: 10, payments: [{ id: 'payment', method: 'CASH', amount: 118 }] };
      await f.adapter.saveDocument('customers', { id: 'customer', currentDebt: 2 });
      await f.adapter.saveDocument('wallets', { id: 'wallet-customer', customerId: 'customer', balance: 50,
        status: 'ACTIVE', currency: 'DOP', lastActivity: transaction.date, transactions: [] });
      await assert.rejects(module.persistV3FinancialTransaction(transaction, {} as BusinessConfig, 'W'), /FISCAL_TERMINAL_AUTHORITY_REQUIRED/);
      for (const collection of ['transactions', 'transactionHistory', 'inventoryLedger', 'wallet_transactions']) assert.equal(f.rows(collection).length, 0);
      assert.equal(f.rows('customers')[0].currentDebt, 2);
      assert.equal(f.rows('wallets')[0].balance, 50);
      assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM sync_outbox_v2').get()?.n, 0);
      assert.equal((globalThis as any).__v3FinancialFixture.fiscalAuthorityChecks, denyAtFiscalCheck);
    } finally { f.sql.close(); }
  }
});

test('two sequential partial refunds retain archived original and never create a ticket settlement; stale CAS rolls back ledger',async()=>{
 const f=fixture();try{
  const module=await financialModule(f,false);
  const original={...module.transaction('source'),...scope,zReportId:'Z',status:'COMPLETED',relatedTransactions:[],customerId:undefined};
  await f.adapter.saveDocument('transactionHistory',original);
  const globals=globalThis as any;
  globals.__v3FinancialFixture.session.validate=async(_config:any,items:any[],_tariff:any,_warehouse:any,_intent:any,validated:any)=>{
   for(const line of items)validated?.(line,line);
   const source=await f.adapter.getDocument('transactionHistory','source') as any;
   return {collection:'transactionHistory',id:'source',expected:JSON.stringify(source),items:source.items};
  };
  const refund=(name:string)=>({...module.transaction(name,true),type:'REFUND',...scope,customerId:undefined,originalTransactionId:'source',items:[{...original.items[0],quantity:0.5,netAmount:50,taxAmount:9,totalAmount:59}],total:59,netAmount:50,taxAmount:9});
  for(const name of ['partial-1','partial-2']){
   const before=await f.adapter.getDocument('transactionHistory','source') as any;
   const intended={...before,status:name==='partial-1'?'PARTIAL_REFUND':'REFUNDED',relatedTransactions:[...before.relatedTransactions,name]};
   await module.persistV3FinancialTransaction(refund(name),{} as BusinessConfig,'W',{refund:true,original:intended,expectedOriginal:before,expectedOriginalHistory:before,originalCollection:'transactionHistory'});
   assert.equal(await f.adapter.getDocument('transactions','source'),null);
  }
  const stored=await f.adapter.getDocument('transactionHistory','source') as any;
  assert.equal(stored.zReportId,'Z');assert.deepEqual(stored.relatedTransactions,['partial-1','partial-2']);
  assert.equal(f.rows('v3TicketSettlements').length,0);assert.equal(f.rows('inventoryLedger').length,2);
  assert.equal(f.rows('inventoryLedger').reduce((sum:number,row:any)=>sum+row.qtyIn,0),1);
  const stale={...stored,total:999};
  await assert.rejects(()=>module.persistV3FinancialTransaction(refund('stale'),{} as BusinessConfig,'W',{refund:true,original:{...stale,relatedTransactions:[...stale.relatedTransactions,'stale']},expectedOriginal:stale,expectedOriginalHistory:stale,originalCollection:'transactionHistory'}));
  assert.equal(f.rows('inventoryLedger').length,2);assert.equal(await f.adapter.getDocument('transactions','stale'),null);
 }finally{f.sql.close();}
});

test('actual refund helper lost ACK replays exact canonical receipt without writes; conflicting content and newer stale commands reject; archived receipt stays archived',async()=>{
 const f=fixture();try{
  const module=await financialModule(f,false);
  const original={...module.transaction('source'),...scope,customerId:undefined,customerName:undefined,total:1180,netAmount:1000,taxAmount:180,
   relatedTransactions:[],items:[{...module.transaction('source').items[0],quantity:10,netAmount:1000,taxAmount:180,totalAmount:1180}]};
  await f.adapter.saveDocument('config',{id:'current'});
  await f.adapter.saveDocument('transactions',original);await f.adapter.saveDocument('transactionHistory',original);
  const refund={...module.transaction('own-refund',true),type:'REFUND',...scope,customerId:undefined,customerName:undefined,
   originalTransactionId:'source',total:472,netAmount:400,taxAmount:72,items:[{...original.items[0],quantity:4,netAmount:400,taxAmount:72,totalAmount:472}]};
  const options={warehouseId:'W',originalSource:original,originalTransaction:{...original,status:'PARTIAL_REFUND'},conditions:new Map([[original.items[0].cartId,'SELLABLE']])};
  const commit=f.adapter.saveDocumentsAtomically.bind(f.adapter);let writes=0;
  f.adapter.saveDocumentsAtomically=async(...args:Parameters<typeof commit>)=>{writes++;await commit(...args);throw Error('simulated-lost-commit-ACK');};
  await assert.rejects(()=>module.persistStandaloneRefundTransaction(refund,options),/lost-commit-ACK/);
  f.adapter.saveDocumentsAtomically=async(...args:Parameters<typeof commit>)=>{writes++;return commit(...args);};
  const snapshot=()=>JSON.stringify(f.sql.prepare('SELECT * FROM documents ORDER BY collection_name,doc_id').all());
  const committed=snapshot(),writesAfter=writes;
  const results=await Promise.all([module.persistStandaloneRefundTransaction(refund,options),module.persistStandaloneRefundTransaction(refund,options)]);
  assert.equal(results[0].refund.id,'own-refund');assert.equal(results[1].refund.id,'own-refund');assert.equal(snapshot(),committed);assert.equal(writes,writesAfter);
  assert.equal(f.rows('inventoryLedger').length,1);assert.equal(f.rows('inventoryLedger')[0].qtyIn,4);
  for(const [candidate,changedOptions] of [
   [{...refund,total:473},options],
   [{...refund,customerId:'different-customer'},options],
   [{...refund,items:[{...refund.items[0],quantity:5}]},options],
   [refund,{...options,warehouseId:'other'}],
   [refund,{...options,conditions:new Map([[original.items[0].cartId,'DAMAGED']])}],
  ] as any[])await assert.rejects(()=>module.persistStandaloneRefundTransaction(candidate,changedOptions),/DUPLICATE_TRANSACTION_MISMATCH/);
  await assert.rejects(()=>module.persistStandaloneRefundTransaction({...refund,id:'different-stale-command',total:944,netAmount:800,taxAmount:144,items:[{...refund.items[0],quantity:8,netAmount:800,taxAmount:144,totalAmount:944}]},options),/ORIGINAL_CHANGED/);
  assert.equal(snapshot(),committed);assert.equal(writes,writesAfter);
  for(const id of ['source','own-refund']){
   const row=await f.adapter.getDocument('transactionHistory',id) as any;
   await commit([{collectionName:'transactionHistory',document:{...row,zReportId:'Z'},expectedDocument:JSON.stringify(row)}]);
   f.sql.prepare("DELETE FROM documents WHERE collection_name='transactions' AND doc_id=?").run(id);
  }
  const archived=snapshot();const replay=await module.persistStandaloneRefundTransaction(refund,options);
  assert.equal(replay.refund.zReportId,'Z');assert.equal(snapshot(),archived);assert.equal(writes,writesAfter);assert.equal(f.rows('transactions').length,0);
  assert.equal(f.rows('inventoryLedger').length,1);assert.equal(f.rows('v3TicketSettlements').length,0);
  const orphan={...replay.refund};delete orphan.zReportId;
  f.sql.prepare("UPDATE documents SET data=? WHERE collection_name='transactionHistory' AND doc_id='own-refund'").run(JSON.stringify(orphan));
  const orphanState=snapshot();await assert.rejects(()=>module.persistStandaloneRefundTransaction(refund,options),/DUPLICATE_TRANSACTION_MISMATCH/);assert.equal(snapshot(),orphanState);assert.equal(writes,writesAfter);
 }finally{f.sql.close();}
});
test('native financial writer preserves UI-shaped Date identity through durable SALE/PAYMENT reload and replay',async()=>{
 const f=fixture();try{const module=await financialModule(f,true),transaction=module.transaction('date-cash');
  transaction.payments=[{id:'date-payment',method:'CASH',amount:118,timestamp:new Date('2026-10-23T06:39:12.403-04:00')}];
  const first=await module.persistV3FinancialTransaction(transaction,{} as BusinessConfig,'W');assert.equal(first.created,true);
  const active=f.rows('transactions')[0],history=f.rows('transactionHistory')[0];assert.equal(active.payments[0].timestamp,'2026-10-23T10:39:12.403Z');assert.equal(active.v3CommitFingerprint,history.v3CommitFingerprint);
  const {financialOperationIdentity}=await import('../services/db/LargeMasterSyncV3FinancialRetention');assert.equal(active.v3CommitFingerprint,financialOperationIdentity(active,'W',{}));
  if(process.env.CLIC_ERP_SOURCE_ROOT){const {pathToFileURL}=await import('node:url');const {v3OperationFingerprint}=await import(pathToFileURL(process.env.CLIC_ERP_SOURCE_ROOT+'/server/services/fiscal/posFiscalV3Source.js').href);assert.equal(active.v3CommitFingerprint,v3OperationFingerprint(active));}
  const events=f.sql.prepare('SELECT payload_json FROM sync_outbox_v2 ORDER BY local_sequence').all().map(row=>JSON.parse(String(row.payload_json)));
  assert.equal(events.length,2);assert.equal(events[0].transaction.payments[0].timestamp,active.payments[0].timestamp);
  assert.equal((await module.persistV3FinancialTransaction(active,{} as BusinessConfig,'W')).created,false);assert.equal(f.rows('transactions').length,1);assert.equal(f.sql.prepare('SELECT count(*) n FROM sync_outbox_v2').get()!.n,2);
 }finally{f.sql.close();}
});
test('invalid Date is rejected at financial identity before a fresh native commit and does not rewrite existing effects',async()=>{
 const f=fixture();try{const module=await financialModule(f,true),transaction=module.transaction('invalid-date');transaction.payments=[{id:'invalid-payment',method:'CASH',amount:118,timestamp:new Date(NaN)}];
  await assert.rejects(module.persistV3FinancialTransaction(transaction,{} as BusinessConfig,'W'),/SYNC_V3_FINANCIAL_DATE_INVALID/);assert.equal(f.rows('transactions').length,0);assert.equal(f.rows('transactionHistory').length,0);assert.equal(f.sql.prepare('SELECT count(*) n FROM sync_outbox_v2').get()!.n,0);
 }finally{f.sql.close();}
});

test('tracking commits require a bijection for every tracked transaction, history and outbox source',async()=>{
 const f=fixture();const selected={authority:{allocationId:'allocation'},cartId:'line',quantityMinor:1000000};
 const line={id:'P',cartId:'line',v3SaleAuthority:{binding:'binding'},trackingData:[selected]};
 const transaction=(id:string)=>({collectionName:'transactions',document:{id,items:[line]}});
 const event=(id:string)=>({eventId:'event-'+id,eventType:'SALE_POSTED',aggregateType:'Transaction',aggregateId:id,schemaVersion:1,payload:{transaction:{id,items:[line]}},createdAt:'now'});
 await assert.rejects(f.adapter.commitFinancialTransaction({documents:[transaction('one'),transaction('two')] as any,outboxEvent:event('one'),additionalOutboxEvents:[event('two')],trackingCommits:[{checkoutId:'checkout',transactionId:'one',selections:[selected] as any}]}),/TRACKING_ATOMIC_SOURCE_REQUIRED/);
 await assert.rejects(f.adapter.commitFinancialTransaction({documents:[transaction('one')] as any,outboxEvent:event('one'),trackingCommits:[{checkoutId:'checkout',transactionId:'one',selections:[selected] as any}]}),/TRACKING_ATOMIC_SOURCE_REQUIRED/);
 assert.equal(f.rows('transactions').length,0);assert.equal(f.sql.prepare('select count(*) n from sync_outbox_v2').get()?.n,0);
});
