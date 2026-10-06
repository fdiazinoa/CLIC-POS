import test from 'node:test';
import assert from 'node:assert/strict';
import { build, transform } from 'esbuild';
import { readFileSync } from 'node:fs';
import { V3OperationalUIQueue, V3OperationalUILifetime, authorizeV3UIContext, buildV3FrozenFiscalProviderTransaction } from '../components/v3OperationalUIQueue';
import { freezeAuthoritativeLineFiscalAmounts } from '../utils/fiscalBreakdown';
import { validateV3FrozenLineFiscalAmounts } from '../services/sync/LargeMasterSyncV3LineSource';
import type { BusinessConfig, CartItem, Transaction } from '../types';

test('real V3 freeze and source validation project tip, effective tax subset and exemption without changing frozen amounts', () => {
  const stamp = { binding: 'B', warehouseId: 'W', tariffId: 'T', syncId: 'S', syncVersion: 2,
    inventoryVersion: 3, inventoryCursor: 'C', taxIncluded: true };
  const config = { terminals: [], taxRate: 0, taxes: [
    { id: 'TX', name: 'ITBIS', rate: 0.18, type: 'VAT' },
    { id: 'OTHER', name: 'Otro', rate: 0.1, type: 'VAT' },
  ], serviceTaxPolicies: { DINE_IN: { taxIds: ['TX'], legalTip: { enabled: true, percentage: 10 } } } } as BusinessConfig;
  for (const exempt of [false, true]) {
    const policy = { serviceType: 'DINE_IN', source: 'POS', taxIds: ['TX'], legalTip: { enabled: true, percentage: 10 } } as const;
    const raw = { id: 'P', cartId: 'line', name: 'Product', price: exempt ? 100 : 118,
      quantity: 1, taxable: true, appliedTaxIds: ['TX', 'OTHER'], v3SaleAuthority: stamp } as CartItem;
    const transaction = { id: 'T', terminalId: 'T1', serviceType: 'DINE_IN', serviceChargeAmount: 5,
      serviceTaxPolicySnapshot: { ...policy, taxIds: [...policy.taxIds] },
      customerSnapshot: { isTaxExempt: exempt }, netAmount: 105, taxAmount: exempt ? 0 : 18,
      total: exempt ? 105 : 123, isTaxIncluded: true,
      items: freezeAuthoritativeLineFiscalAmounts([raw], config, { isTaxIncluded: true, taxExempt: exempt,
        allowedTaxIds: ['TX'], transactionNetAmount: 105, transactionTaxAmount: exempt ? 0 : 18,
        transactionTotal: exempt ? 105 : 123 }) } as Transaction;
    validateV3FrozenLineFiscalAmounts(transaction, config);
    const projection = buildV3FrozenFiscalProviderTransaction(transaction, config);
    assert.strictEqual(projection.items, transaction.items);
    assert.equal(projection.items[0].netAmount, 105);
    assert.equal(projection.netAmount, 105);
    assert.equal(projection.total, transaction.total);
    if (exempt) assert.deepEqual(projection.taxBreakdown, []);
    else {
      assert.deepEqual(projection.taxBreakdown, [{ id: 'TX', name: 'ITBIS', rate: 0.18,
        amount: 18, taxableBase: 100, total: 118, lineCount: 1 }]);
      // The frozen snapshot remains authoritative even if presentation policy later changes.
      assert.deepEqual(buildV3FrozenFiscalProviderTransaction(transaction, { ...config,
        serviceTaxPolicies: { DINE_IN: { taxIds: ['TX', 'OTHER'] } } }).taxBreakdown, projection.taxBreakdown);
    }
  }
});

test('queued candidate additions see the committed latest cart and recover after rejection', async () => {
  const queue = new V3OperationalUIQueue();
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  let quantity = 0;
  const first = queue.run(() => true, async () => { await wait; quantity += 1; });
  const second = queue.run(() => true, async () => { assert.equal(quantity, 1); quantity += 2; });
  release();
  await Promise.all([first, second]);
  assert.equal(quantity, 3);
  await assert.rejects(queue.run(() => true, async () => { throw new Error('stock'); }), /stock/);
  await queue.run(() => true, async () => { quantity += 1; });
  assert.equal(quantity, 4);
});

test('retired candidate context rejects pending work before cart mutation', async () => {
  const queue = new V3OperationalUIQueue();
  let current = true;
  let writes = 0;
  const pending = queue.run(() => current, async () => { writes++; });
  current = false;
  await assert.rejects(pending, /SYNC_V3_UI_CONTEXT_CHANGED/);
  assert.equal(writes, 0);
});

test('retiring POS during awaited authorization prevents cart writes, including subsequent remount', async () => {
  const lifetime = new V3OperationalUILifetime();
  const queue = new V3OperationalUIQueue();
  const current = lifetime.capture();
  let release!: (allowed: boolean) => void;
  let started!: () => void;
  const authorizing = new Promise<void>(resolve => { started = resolve; });
  const authorization = new Promise<boolean>(resolve => { release = resolve; });
  let writes = 0;
  const task = queue.run(current, async () => {
    if (await authorizeV3UIContext(current, () => { started(); return authorization; })) writes++;
  });
  await authorizing;
  lifetime.retire();
  lifetime.activate();
  release(true);
  await assert.rejects(task, /SYNC_V3_UI_CONTEXT_CHANGED/);
  assert.equal(writes, 0);
  await queue.run(lifetime.capture(), async () => { writes++; });
  assert.equal(writes, 1);
  const source = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
  assert.match(source, /return \(\) => \{ uiLifetime\.current\.retire\(\); addContext\.current = undefined;/);
  assert.match(source, /await authorizeV3UIContext\(isCurrent, authorize\)/);
});

test('actual refund-only persistence branch preserves frozen V3 items and total while V2 keeps legacy overrides', async () => {
  const source = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('if (isRefundOnly) {', source.indexOf('let settledFinalTxn ='));
  const end = source.indexOf('} else {', start);
  assert.ok(start > 0 && end > start);
  // Execute the production branch itself with a persistence spy, not a reimplemented helper.
  const execute = new Function('fixture', `return (async () => {
    const {isRefundOnly,v3Operational,settledFinalTxn,normalizedRefundItems,refundDocumentTotal,
      finalNcf,finalNcfType,refundAuthorizedBy,defaultSalesWarehouseId,terminalId,sellableConditions,
      persistStandaloneRefundTransaction}=fixture;
    ${source.slice(start, end)}}
  })();`);
  const frozenLine = { id: 'P', cartId: 'line', quantity: 1, price: 118, netAmount: 100,
    taxAmount: 18, totalAmount: 118, v3SaleAuthority: { tariffId: 'T', taxIncluded: true } };
  const rawLine = { id: 'P', cartId: 'line', quantity: 1, price: 118 };
  for (const v3Operational of [true, false]) {
    let persisted: any;
    await execute({ isRefundOnly: true, v3Operational,
      settledFinalTxn: { id: 'refund', items: [frozenLine], total: 118, netAmount: 100, taxAmount: 18 },
      normalizedRefundItems: [rawLine], refundDocumentTotal: 125,
      finalNcf: 'NC', finalNcfType: 'B04', refundAuthorizedBy: undefined,
      defaultSalesWarehouseId: 'W', terminalId: 'T1', sellableConditions: new Map(),
      persistStandaloneRefundTransaction: async (document: any, options: any) => {
        persisted = document;
        assert.equal(options.warehouseId, 'W');
        if (v3Operational) {
          assert.equal(document.items[0].netAmount + document.items[0].taxAmount, document.total);
          assert.strictEqual(document.items[0], frozenLine);
        }
      } });
    assert.equal(persisted.total, v3Operational ? 118 : 125);
    assert.strictEqual(persisted.items[0], v3Operational ? frozenLine : rawLine);
  }
});

test('actual App fiscal callback preserves V3 frozen amounts, deduplicates calls and reconciles durable attempts', async () => {
  const source = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('async (transaction: Transaction) => {', source.indexOf('const syncFiscalDocument ='));
  const end = source.indexOf('}, [config, pollFiscalDocumentStatus, upsertFiscalTransaction]);', start);
  assert.ok(start > 0 && end > start);
  const compiled = await transform(`const callback=${source.slice(start, end + 1)};`, { loader: 'ts' });
  const create = new Function('fixture', `const {LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED,v3FiscalInFlightRef,config,db,
    getLargeMasterSyncV3OperationalSession,validateV3FrozenFiscalAmounts,validateV3FrozenLineFiscalAmounts,
    getEffectiveFiscalComplianceConfig,getProviderEnvironment,getFiscalProviderConfig,getExistingFiscalProviderReference,
    pollFiscalDocumentStatus,resolveFiscalProviderEstablishmentCode,resolveFiscalProviderCashierCode,
    calculateTransactionFiscalSummary,buildV3FrozenFiscalProviderTransaction,upsertFiscalTransaction,issueFiscalDocument,
    applyFiscalProviderResult,isDelegatedFiscalProvider,window}=fixture;
    ${compiled.code} return callback;`);
  const stamp = { binding: 'B', warehouseId: 'W', tariffId: 'T', syncId: 'S', syncVersion: 2,
    inventoryVersion: 3, inventoryCursor: 'C', taxIncluded: true };
  const projected: any = { terminals: [], taxRate: 0, taxes: [{ id: 'TX', name: 'ITBIS', rate: 0.18, type: 'VAT' }],
    serviceTaxPolicies: { DINE_IN: { taxIds: ['TX'], legalTip: { enabled: true, percentage: 10 } } } };
  const original: any = { id: 'refund', terminalId: 'T', date: '2026-10-05', fiscalProvider: 'P', ncfType: 'E34',
    ncf: 'E340000000001', total: 123, netAmount: 105, taxAmount: 18, serviceChargeAmount: 5,
    serviceType: 'DINE_IN', isTaxIncluded: true,
    items: freezeAuthoritativeLineFiscalAmounts([{ id: 'P', quantity: 1, price: 118,
      taxable: true, appliedTaxIds: ['TX'], v3SaleAuthority: stamp }], projected,
    { isTaxIncluded: true, allowedTaxIds: ['TX'], transactionNetAmount: 105, transactionTaxAmount: 18, transactionTotal: 123 }) };
  validateV3FrozenLineFiscalAmounts(original, projected);
  let stored = structuredClone(original);
  let issues = 0;
  let polls = 0;
  let release!: () => void;
  let issued!: () => void;
  const issueStarted = new Promise<void>(resolve => { issued = resolve; });
  const issueWait = new Promise<void>(resolve => { release = resolve; });
  const fixture: any = {
    LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED: true, v3FiscalInFlightRef: { current: new Map() },
    config: { terminals: [], companyInfo: {}, taxRate: 0.99, taxes: [{ id: 'legacy', rate: 0.99 }] },
    db: { getDocument: async () => structuredClone(stored) },
    getLargeMasterSyncV3OperationalSession: async () => ({ binding: 'B', ready: { runtime: { version: { syncId: 'S', syncVersion: 2 } },
      inventoryVersion: 3, inventoryCursor: 'C' }, assertCurrent: async () => {}, projectConfig: async () => projected }),
    validateV3FrozenFiscalAmounts: (transaction: any) => assert.equal(transaction.netAmount + transaction.taxAmount, transaction.total),
    validateV3FrozenLineFiscalAmounts,
    getEffectiveFiscalComplianceConfig: () => ({}), getProviderEnvironment: () => 'TEST', getFiscalProviderConfig: () => ({}),
    getExistingFiscalProviderReference: (transaction: any) => transaction.fiscalReferenceId,
    pollFiscalDocumentStatus: async (_transaction: any, _provider: any, _environment: any, reference: string) => { assert.equal(reference, 'REF'); polls++; },
    resolveFiscalProviderEstablishmentCode: () => '1', resolveFiscalProviderCashierCode: () => '1',
    calculateTransactionFiscalSummary: () => { throw new Error('legacy calculation forbidden'); },
    buildV3FrozenFiscalProviderTransaction,
    upsertFiscalTransaction: async (transaction: any) => { stored = structuredClone(transaction); },
    issueFiscalDocument: async (input: any) => {
      issues++;
      assert.equal(input.taxRate, 0);
      assert.equal(input.transaction.total, 123);
      assert.equal(input.transaction.netAmount, 105);
      assert.equal(input.transaction.taxAmount, 18);
      assert.equal(input.transaction.items[0].totalAmount, 123);
      assert.equal(input.transaction.taxBreakdown[0].amount, 18);
      assert.equal(input.transaction.taxBreakdown[0].taxableBase, 100);
      issued(); await issueWait;
      return { success: true, pending: false, providerTransactionId: 'REF' };
    },
    applyFiscalProviderResult: (transaction: any, result: any) => ({ ...transaction, fiscalReferenceId: result.providerTransactionId }),
    isDelegatedFiscalProvider: () => false, window: { setTimeout },
  };
  const callback = create(fixture);
  const first = callback(original);
  const second = callback(original);
  await issueStarted;
  release();
  await Promise.all([first, second]);
  assert.equal(issues, 1);
  await callback(original);
  assert.equal(issues, 1);
  stored.fiscalSyncStatus = 'PENDING';
  await callback(original);
  assert.equal(polls, 1);
  assert.equal(issues, 1);
  stored = { ...structuredClone(original), fiscalProviderStatus: 'V3_ISSUE_REQUESTED', fiscalSyncStatus: 'PENDING' };
  fixture.v3FiscalInFlightRef = { current: new Map() };
  await create(fixture)(original);
  assert.equal(issues, 1);
  assert.equal(stored.fiscalSyncStatus, 'ERROR');
  assert.equal(stored.fiscalSyncError, 'SYNC_V3_FISCAL_RECONCILIATION_REQUIRED');
  assert.equal(stored.ncf, original.ncf);
  await create({ ...fixture, LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED: false,
    calculateTransactionFiscalSummary: () => ({ subtotal: 7, taxTotal: 1, taxBreakdown: [] }),
    db: { getDocument: async () => { throw new Error('V2 must retain its existing source path'); } },
    issueFiscalDocument: async (input: any) => {
      assert.equal(input.taxRate, 0.99);
      assert.equal(input.transaction.netAmount, 7);
      assert.equal(input.transaction.taxAmount, 1);
      return { success: true };
    } })(original);
});

test('candidate startup does not force a competing legacy master activation when its React catalog is empty', async () => {
  const source = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('// Auto-heal catalog/config drift on startup.');
  const end = source.indexOf("markBootStage('CATALOG_READY');", start);
  const branch = source.slice(start, end);
  assert.match(branch, /if \(!LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED && hasEmptyCatalog\)/);
  const condition = branch.slice(branch.indexOf('if (!LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED && hasEmptyCatalog)'), branch.indexOf('} else if'));
  assert.match(condition, /await syncManager\.forcePullAll\(\)/);
  const fullRepair = source.slice(source.indexOf('if (\n              !LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED'), start);
  assert.match(fullRepair, /forceFiscalCatalogFullPull\(\)/);
  assert.match(fullRepair, /localStorage\.setItem\(fiscalCatalogRepairKey, fiscalCatalogRepairRevision\)/);
  const compiled = await transform(`const execute=async()=>{${branch}};`, { loader: 'ts' });
  const run = new Function('fixture', `const {LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED,readAppProducts,
    effectivePairedTerminal,syncManager,console}=fixture; ${compiled.code} return execute();`);
  let pulls = 0;
  const fixture = { LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED: true,
    readAppProducts: async () => [], effectivePairedTerminal: { id: 'T', config: {} },
    syncManager: { forcePullAll: async () => { pulls++; throw new Error('offline'); } },
    console: { warn: () => {}, error: () => {} } };
  await run(fixture);
  assert.equal(pulls, 0, 'offline candidate keeps its existing singleton-owned source');
  await run({ ...fixture, LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED: false });
  assert.equal(pulls, 1, 'V2 retains its legacy empty-catalog repair');
});

test('POS boundary keeps pinned catalog across config updates and retains cart cache on inventory events', () => {
  const source = readFileSync(new URL('../components/LargeMasterSyncV3OperationalPOS.tsx', import.meta.url), 'utf8');
  assert.match(source, /\}, \[props\.activeTerminalId, warehouseId, tariffId, authorityKey, authorityError\]\)/);
  assert.match(source, /const effectiveConfig = useMemo/);
  assert.match(source, /sequence !== querySequence\.current \|\| context !== contextSequence\.current/);
  assert.match(source, /pinnedContext !== contextSequence\.current/);
  const inventoryEffect = source.slice(source.indexOf('const refresh = () =>'), source.indexOf("window.removeEventListener('v3InventoryUpdated'"));
  assert.doesNotMatch(inventoryEffect, /setCache\(\[\]\)/);
  assert.match(inventoryEffect, /setInventoryRevision/);
  assert.match(inventoryEffect, /boundary\.search/);
});

test('real DB bootstrap omits V3 legacy catalog reads and retains default V2 reads', async () => {
  const globals = globalThis as any;
  const reads: string[] = [];
  const config = { id: 'current', terminals: [] };
  globals.__v3UIBootstrap = { adapter: {
    connect: async () => {},
    getCollection: async (key: string) => { reads.push(key); return key === 'config' ? config : [{ id: key }]; },
    getDocument: async () => ({ id: '_db_initialized' }),
  } };
  globals.window = { setTimeout, clearTimeout, localStorage: { getItem: () => null } };
  const mocks: Record<string, string> = {
    '../constants': `export const MOCK_USERS=[],RETAIL_PRODUCTS=[],FOOD_PRODUCTS=[],MOCK_CUSTOMERS=[],INITIAL_TARIFFS=[],DEFAULT_ROLES=[],DEFAULT_TERMINAL_CONFIG={},DEFAULT_DOCUMENT_SERIES=[];
      export const getInitialConfig=()=>({terminals:[]});`,
    '../services/db': 'export const dbAdapter=globalThis.__v3UIBootstrap.adapter;',
    '@capacitor/core': 'export const Capacitor={isNativePlatform:()=>false,getPlatform:()=>"web"};',
    '../services/sync/PermissionService': 'export const permissionService={isSlaveTerminal:()=>false};',
    './documentSeriesIdentity': 'export const mergeDocumentSeriesCollection=()=>{}; export const mergeIncomingDocumentSeriesWithoutRewind=()=>{};',
    './fiscalPreparedAuthority': 'export const reconcilePreparedFiscalCollections=()=>{};',
    '../services/sync/LegacyMutationJournal': 'export const completeLegacyMutationAfterDurableAck=()=>{};',
  };
  const result = await build({ entryPoints: [new URL('../utils/db.ts', import.meta.url).pathname], bundle: true,
    write: false, format: 'esm', platform: 'node', define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'bootstrap-boundaries', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => args.kind === 'dynamic-import' ? { path: args.path, external: true }
        : mocks[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'js' }));
    } }] });
  const module = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  const data = await module.db.init(undefined, { skipCollections: ['products', 'productPrices', 'taxes'] });
  for (const key of ['products', 'productPrices', 'taxes']) assert.equal(reads.includes(key), false, key);
  for (const key of ['config', 'users', 'roles', 'internalSequences']) assert.equal(reads.includes(key), true, key);
  assert.deepEqual(data.products, []);
  assert.deepEqual(data.productPrices, []);
  reads.length = 0;
  await module.db.init();
  assert.equal(reads.includes('products'), true);
  assert.equal(reads.includes('productPrices'), true);
});
