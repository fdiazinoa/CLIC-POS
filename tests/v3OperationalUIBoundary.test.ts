import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { V3OperationalUIQueue } from '../components/v3OperationalUIQueue';

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

test('POS boundary keeps pinned catalog across config updates and retains cart cache on inventory events', () => {
  const source = readFileSync(new URL('../components/LargeMasterSyncV3OperationalPOS.tsx', import.meta.url), 'utf8');
  assert.match(source, /\}, \[props\.activeTerminalId, warehouseId, tariffId\]\)/);
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
