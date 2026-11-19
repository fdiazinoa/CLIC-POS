import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { BusinessConfig, LabelDataSource, LabelTemplate } from '../types';
import { formatItemLabelPrice, missingItemLabelPriceMessage, selectItemLabelPrice } from '../utils/itemLabelPrice';
import { printLabelsFromTemplate } from '../utils/labelPrinter';
import { PrintRouterService } from '../services/printer/PrintRouterService';
import { offlinePrintQueueService } from '../services/printer/OfflinePrintQueueService';
import { ApiSyncAdapter } from '../services/sync/ApiSyncAdapter';
import { buildEscPosLabelPayload } from '../services/printer/EscPosFormatter';
import { readItemLabelPrices, syncItemLabelPrices, validateItemLabelPricePage } from '../services/sync/ItemLabelPriceCollection';
import type { DurableDocumentMutation } from '../services/db/DatabaseAdapter';
import { LargeMasterSyncV3SqliteStore } from '../services/db/LargeMasterSyncV3SqliteStore';
import { LARGE_MASTER_SYNC_V3_SCHEMA_SQL } from '../services/db/LargeMasterSyncV3Schema';

const usd = { amountCents: 1999, currencyCode: 'USD' };
const eur = { amountCents: 1999, currencyCode: 'EUR' };
const zero = { amountCents: 0, currencyCode: 'USD' };
const record = { productId: 'A', productName: 'Aceite', sku: 'AC-01', price: 900, copies: 1 };
const makeTemplate = (dataSource: LabelDataSource): LabelTemplate => ({
  id: dataSource, name: 'Etiqueta', category: 'ARTICLE', widthMm: 40, heightMm: 20,
  elements: [{ id: 'value', type: 'TEXT', dataSource, content: '', x: 0, y: 0, width: 40, height: 10 }],
});
const labelTemplate = makeTemplate('PRODUCT_LABEL_PRICE');

test('format exact cents and currency, including zero and maximal cents', () => {
  assert.equal(formatItemLabelPrice(usd), 'US$19.99');
  assert.equal(formatItemLabelPrice(eur), 'EUR 19.99');
  assert.equal(formatItemLabelPrice(zero), 'US$0.00');
  assert.equal(formatItemLabelPrice({ amountCents: 2147483647, currencyCode: 'ABCDEFGHIJ' }), 'ABCDEFGHIJ 21474836.47');
  for (const amountCents of [undefined, '1999', -1, 1.5, Number.NaN, Infinity]) {
    assert.equal(formatItemLabelPrice({ amountCents, currencyCode: 'USD' }), null);
  }
  assert.equal(formatItemLabelPrice({ amountCents: 1999, currencyCode: 'usd' }), null);
});

test('batch validation names each missing article, permits zero and preserves sale-price templates', () => {
  const records = [{ ...record, labelPrice: zero }, { ...record, productId: 'B', productName: 'Pan', sku: 'PAN' },
    { ...record, productId: 'C', productName: 'Café', sku: 'CAFE', labelPrice: null },
    { ...record, productId: 'D', productName: 'Agua', copies: 0 }];
  assert.equal(missingItemLabelPriceMessage(labelTemplate, records), 'Falta el precio de etiqueta para: Pan (PAN), Café (CAFE).');
  assert.equal(missingItemLabelPriceMessage(makeTemplate('PRODUCT_PRICE'), records), null);
});

test('same label amount renders in HTML and ESC/POS without commercial amount or conversion', async () => {
  const escPosOutputs: string[] = [];
  const htmlOutputs: string[] = [];
  const previousEscPos = PrintRouterService.routeAndPrintEscPos;
  const previousHtml = PrintRouterService.routeAndPrintHtml;
  const previousEnqueue = offlinePrintQueueService.enqueueJob;
  let queued = 0;
  PrintRouterService.routeAndPrintEscPos = async options => {
    escPosOutputs.push(Buffer.from(options.escPosBase64, 'base64').toString('utf8'));
    return false;
  };
  PrintRouterService.routeAndPrintHtml = async options => {
    htmlOutputs.push(options.html);
    return true;
  };
  offlinePrintQueueService.enqueueJob = async (...args) => {
    queued++;
    return previousEnqueue(...args);
  };
  try {
    const config = { currencySymbol: 'RD$' } as BusinessConfig;
    const labeled = [{ ...record, labelPrice: usd }, { ...record, productId: 'B', labelPrice: eur },
      { ...record, productId: 'C', labelPrice: zero }];
    assert.equal((await printLabelsFromTemplate({ config, template: labelTemplate, records: labeled })).printed, true);
    for (const output of [escPosOutputs[0], htmlOutputs[0]]) {
      assert.match(output, /US\$19\.99/);
      assert.match(output, /EUR 19\.99/);
      assert.match(output, /US\$0\.00/);
      assert.doesNotMatch(output, /RD\$900\.00/);
    }
    const blocked = await printLabelsFromTemplate({ config, template: labelTemplate, records: [record] });
    assert.equal(blocked.method, 'none');
    assert.match(blocked.message, /Aceite \(AC-01\)/);
    assert.equal(escPosOutputs.length, 1);
    assert.equal(htmlOutputs.length, 1);
    assert.equal(queued, 0);
    const stale = await printLabelsFromTemplate({ config, template: labelTemplate, records: labeled,
      assertPriceAuthority: async () => { throw new Error('scope changed'); } });
    assert.equal(stale.priceAuthorityChanged, true);
    assert.equal(stale.method, 'none');
    assert.equal(escPosOutputs.length, 1);
    assert.equal(htmlOutputs.length, 1);
    assert.equal(queued, 0);

    assert.equal((await printLabelsFromTemplate({ config, template: makeTemplate('PRODUCT_PRICE'), records: labeled })).printed, true);
    assert.match(escPosOutputs[1], /RD\$900\.00/);
    assert.match(htmlOutputs[1], /RD\$900\.00/);
    assert.doesNotMatch(escPosOutputs[1], /US\$19\.99|EUR 19\.99/);
    assert.doesNotMatch(htmlOutputs[1], /US\$19\.99|EUR 19\.99/);
    const max = buildEscPosLabelPayload([{ ...record, labelPrice: { amountCents: 2147483647, currencyCode: 'ABCDEFGHIJ' } }], '$');
    assert.match(Buffer.from(max!, 'base64').toString('utf8'), /ABCDEFGHIJ 21474836\.47/);
  } finally {
    PrintRouterService.routeAndPrintEscPos = previousEscPos;
    PrintRouterService.routeAndPrintHtml = previousHtml;
    offlinePrintQueueService.enqueueJob = previousEnqueue;
  }
});

const binding = (companyId: string, terminalId = 'terminal-a', localCategory = 'one') => ({
  tenantId: 'tenant', companyId, terminalId, deviceId: 'device',
  key: JSON.stringify([companyId, terminalId, localCategory]),
  storageKey: JSON.stringify([companyId, terminalId]),
});

const page = (companyId: string, scopeKey: string, nextRevision: number,
  items: Array<{ itemId: string; revision: number; labelPrice: typeof usd | null }>, hasMore = false) => ({
  status: 'success', tenantId: 'tenant', companyId, scopeKey, items, nextRevision, hasMore,
});

function sqliteStorage(path: string) {
  const sql = new DatabaseSync(path);
  sql.exec('CREATE TABLE IF NOT EXISTS documents(collection TEXT, id TEXT, value TEXT, PRIMARY KEY(collection, id))');
  const read = sql.prepare('SELECT value FROM documents WHERE collection=? AND id=?');
  const put = sql.prepare('INSERT OR REPLACE INTO documents VALUES (?, ?, ?)');
  return {
    close: () => sql.close(),
    count: () => Number(sql.prepare('SELECT count(*) AS total FROM documents').get()?.total),
    async getDocument<T>(collection: string, id: string): Promise<T | null> {
      const found = read.get(collection, id);
      return found ? JSON.parse(String(found.value)) : null;
    },
    async saveDocumentsAtomically(mutations: DurableDocumentMutation[]) {
      sql.exec('BEGIN');
      try {
        for (const mutation of mutations) {
          const found = read.get(mutation.collectionName, mutation.document.id);
          if ((mutation.requireAbsent && found) || (mutation.expectedDocument !== undefined && found?.value !== mutation.expectedDocument)) {
            throw new Error('CAS_CONFLICT');
          }
          put.run(mutation.collectionName, mutation.document.id, JSON.stringify(mutation.document));
        }
        sql.exec('COMMIT');
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

test('initial and incremental prices survive SQLite restart, drop stale revisions and isolate company/terminal', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pos-label-'));
  const filename = join(directory, 'catalog.sqlite');
  let storage = sqliteStorage(filename);
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  const scope = binding('company-a');
  const getBinding = async () => scope;
  try {
    const initial = [
      page('company-a', 'visibility-1', 2, [{ itemId: 'A', revision: 1, labelPrice: usd }], true),
      page('company-a', 'visibility-1', 4, [{ itemId: 'B', revision: 3, labelPrice: zero }]),
    ];
    const requested: number[] = [];
    await syncItemLabelPrices(getBinding, async revision => {
      requested.push(revision);
      return initial.shift()!;
    }, storage);
    assert.deepEqual(requested, [0, 2]);
    storage.close();
    storage = sqliteStorage(filename);
    const loaded = await readItemLabelPrices(scope, ['A', 'B', 'C'], storage);
    assert.deepEqual(loaded.prices.get('A'), { revision: 1, labelPrice: usd });
    assert.deepEqual(loaded.prices.get('B'), { revision: 3, labelPrice: zero });
    assert.equal(loaded.prices.has('C'), false);
    assert.equal((await readItemLabelPrices(binding('company-b'), ['A'], storage)).prices.has('A'), false);
    assert.equal((await readItemLabelPrices(binding('company-a', 'terminal-b'), ['A'], storage)).prices.has('A'), false);
    const changedEur = { ...eur, amountCents: 1799 };
    await syncItemLabelPrices(getBinding, async revision => {
      assert.equal(revision, 4);
      return page('company-a', 'visibility-1', 5, [{ itemId: 'A', revision: 5, labelPrice: changedEur }]);
    }, storage);
    await assert.rejects(loaded.assertCurrent, /CURSOR_CHANGED/);
    assert.deepEqual((await readItemLabelPrices(scope, ['A'], storage)).prices.get('A'), { revision: 5, labelPrice: changedEur });
    await syncItemLabelPrices(getBinding, async () => page('company-a', 'visibility-1', 6,
      [{ itemId: 'A', revision: 6, labelPrice: null }]), storage);
    await assert.rejects(syncItemLabelPrices(getBinding,
      async () => page('company-a', 'visibility-1', 5, [{ itemId: 'A', revision: 5, labelPrice: eur }]), storage), /ROW_INVALID/);
    const removed = (await readItemLabelPrices(scope, ['A'], storage)).prices.get('A')!;
    assert.equal(selectItemLabelPrice({ labelPrice: eur, revision: 5 }, removed), null);
    assert.deepEqual(selectItemLabelPrice({ labelPrice: usd, revision: 7 }, removed), usd);
    await syncItemLabelPrices(getBinding, async () => null, storage); // old ERP / offline read remains intact
    assert.deepEqual((await readItemLabelPrices(scope, ['A'], storage)).prices.get('A'), removed);

    const beforeVisibility = storage.count();
    const resetRequested: number[] = [];
    await syncItemLabelPrices(getBinding, async revision => {
      resetRequested.push(revision);
      return page('company-a', 'visibility-2', 6, []);
    }, storage);
    assert.deepEqual(resetRequested, [6, 0]);
    assert.equal((await readItemLabelPrices(scope, ['A', 'B'], storage)).prices.size, 0);
    assert.equal(storage.count(), beforeVisibility);
  } finally {
    storage.close();
    rmSync(directory, { recursive: true, force: true });
    if (original) Object.defineProperty(globalThis, 'window', original);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('wire contract rejects foreign scopes and malformed rows without rejecting filtered revision gaps', () => {
  assert.equal(validateItemLabelPricePage(page('one', 'scope', 30, [], true), binding('one'), 12).revision, 30);
  assert.throws(() => validateItemLabelPricePage(page('two', 'scope', 30, []), binding('one'), 12), /PAGE_INVALID/);
  assert.throws(() => validateItemLabelPricePage(page('one', 'scope', 30, [
    { itemId: 'A', revision: 11, labelPrice: eur },
  ]), binding('one'), 12), /ROW_INVALID/);
});

test('V3 label reads stay in the active runtime generation and preserve nonsellable article metadata', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(LARGE_MASTER_SYNC_V3_SCHEMA_SQL);
    const insert = sqlite.prepare(`INSERT INTO master_v3_articles(sync_version,article_id,sku,description,article_type,
      taxable,tax_ids_json,category_id,active,sellable,record_json) VALUES(?,?,?,?,?,0,?,?,?,?,?)`);
    for (const [version, id, active, sellable, labelPrice] of [
      [1, 'A', 1, 1, usd], [2, 'A', 1, 0, eur], [2, 'B', 0, 1, usd], [2, 'C', 1, 1, zero],
    ] as const) insert.run(version, id, id, id, 'PRODUCT', '[]', null, active, sellable,
      JSON.stringify({ id, labelPrice, labelPriceRevision: version }));
    const bridge = {
      query: async (query: string, args: any[] = []) => ({ values: sqlite.prepare(query).all(...args) }),
      execute: async () => { throw new Error('unexpected write'); },
      run: async () => { throw new Error('unexpected write'); },
    };
    const store = new LargeMasterSyncV3SqliteStore(() => bridge, async () => { throw new Error('unexpected write'); });
    const stored = await store.readLabelCatalogArticles({ syncId: 'v3', syncVersion: 2, contractVersion: 2 }, ['A', 'B', 'C']);
    assert.deepEqual(stored, [
      { id: 'A', labelPrice: eur, labelPriceRevision: 2 },
      { id: 'C', labelPrice: zero, labelPriceRevision: 2 },
    ]);
  } finally {
    sqlite.close();
  }
});

test('ERP route sends the protected cursor, bounded limit and only the appropriate capability', async () => {
  const adapter = new ApiSyncAdapter();
  const fixture = adapter as unknown as {
    authenticateOperationalTarget(): Promise<unknown>;
    buildOperationalHeaders(): Record<string, string>;
    fetchWithRetry(input: string, init: RequestInit): Promise<Response>;
  };
  fixture.authenticateOperationalTarget = async () => ({
    kind: 'ERP_ACTIVE', useLocalTarget: false, terminalId: 'terminal-a',
    baseUrl: 'https://erp.example.test/api/sync', token: 'fake-token',
  });
  fixture.buildOperationalHeaders = () => ({ Authorization: 'Bearer fake-token' });
  const replies = [
    new Response(JSON.stringify(page('company-a', 'scope', 17, [])), { status: 200 }),
    new Response(JSON.stringify({ status: 'success', collection: 'item-label-prices', supported: false, items: [] }), { status: 200 }),
    new Response('', { status: 404 }),
  ];
  const requests: Array<{ url: URL; headers: Headers }> = [];
  fixture.fetchWithRetry = async (input, init) => {
    requests.push({ url: new URL(input), headers: new Headers(init.headers) });
    return replies.shift()!;
  };

  assert.deepEqual(await adapter.pullItemLabelPricePage(17, 'terminal-a', true), page('company-a', 'scope', 17, []));
  assert.equal(await adapter.pullItemLabelPricePage(0, 'terminal-a', false), null);
  assert.equal(await adapter.pullItemLabelPricePage(0, 'terminal-a', true), null);
  await assert.rejects(adapter.pullItemLabelPricePage(0, 'terminal-b', false), /BINDING_CHANGED/);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].url.pathname, '/api/sync/collections/item-label-prices/delta');
  assert.equal(requests[0].url.searchParams.get('sinceVersion'), '17');
  assert.equal(requests[0].url.searchParams.get('limit'), '200');
  assert.equal(requests[0].url.searchParams.get('terminal_id'), 'terminal-a');
  assert.equal(requests[0].headers.get('Authorization'), 'Bearer fake-token');
  assert.equal(requests[0].headers.get('X-POS-Capabilities'), 'largeMasterSyncV3');
  assert.equal(requests[1].headers.get('X-POS-Capabilities'), null);
});

test('offline queue stores the approved amount in both payloads and stops if the price changed before fallback', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  const previousEscPos = PrintRouterService.routeAndPrintEscPos;
  const previousHtml = PrintRouterService.routeAndPrintHtml;
  const previousEnqueue = offlinePrintQueueService.enqueueJob;
  const queued: unknown[] = [];
  PrintRouterService.routeAndPrintEscPos = async () => false;
  PrintRouterService.routeAndPrintHtml = async () => false;
  offlinePrintQueueService.enqueueJob = async data => {
    queued.push(data);
    return {} as Awaited<ReturnType<typeof previousEnqueue>>;
  };
  try {
    const input = { config: { currencySymbol: 'RD$' } as BusinessConfig, template: labelTemplate,
      records: [{ ...record, labelPrice: eur }] };
    const result = await printLabelsFromTemplate(input);
    assert.equal(result.method, 'queued');
    assert.equal(queued.length, 1);
    const [output] = queued as Array<{ html: string; escPosBase64: string }>;
    assert.match(output.html, /EUR 19\.99/);
    assert.match(Buffer.from(output.escPosBase64, 'base64').toString(), /EUR 19\.99/);
    let replies = 0;
    const stale = await printLabelsFromTemplate({ ...input,
      assertPriceAuthority: async () => { if (++replies > 1) throw new Error('retired price'); } });
    assert.equal(stale.priceAuthorityChanged, true);
    assert.equal(queued.length, 1);
  } finally {
    PrintRouterService.routeAndPrintEscPos = previousEscPos;
    PrintRouterService.routeAndPrintHtml = previousHtml;
    offlinePrintQueueService.enqueueJob = previousEnqueue;
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});
