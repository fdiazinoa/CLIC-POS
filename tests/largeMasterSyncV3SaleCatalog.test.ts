import test from 'node:test';
import assert from 'node:assert/strict';
import { LargeMasterSyncV3SaleCatalog } from '../services/sync/LargeMasterSyncV3SaleCatalog';
import { LargeMasterSyncV3Runtime } from '../services/sync/LargeMasterSyncV3Runtime';
import { LargeMasterSyncV3Error } from '../services/sync/LargeMasterSyncV3Types';

const version = Object.freeze({ syncId: 'snapshot-2', syncVersion: 2, contractVersion: 2 });
const article = { id: 'A', name: 'Artículo', active: true, sellable: true,
  taxable: true, taxIds: ['TX'] };
const tariff = { id: 'T1', active: true, taxIncluded: true, currency: 'DOP' };
const tax = { id: 'TX', active: true, rate: 0.18 };

const fixture = (options: {
  article?: Record<string, unknown>;
  prices?: Array<{ articleId: string; tariffId: string; price: number }>;
  tariffs?: Record<string, unknown>[];
  taxes?: Record<string, unknown>[];
  variant?: Record<string, unknown>;
  contractVersion?: number;
} = {}) => {
  const selectedArticle = options.article ?? article;
  const calls: string[] = [];
  const runtime = {
    version: { ...version, contractVersion: options.contractVersion ?? 2 },
    async getOperationalTariffs() { return options.tariffs ?? [tariff]; },
    async getOperationalTaxes() { return options.taxes ?? [tax]; },
    async searchOperationalArticles() { return [selectedArticle]; },
    async getOperationalArticle() { return selectedArticle; },
    async getPrices(_ids: string[], tariffId: string) {
      calls.push(tariffId);
      return options.prices ?? [{ articleId: 'A', tariffId: 'T1', price: 125.5 }];
    },
    async findBarcode() { return { articleId: 'A', variantId: options.variant ? 'V1' : null }; },
    async getOperationalVariants() { return options.variant ? [options.variant] : []; },
  } as unknown as LargeMasterSyncV3Runtime;
  return { runtime, calls };
};

test('pins V3 snapshot, effective tariff, price and tax for the sale', async () => {
  const { runtime, calls } = fixture();
  const catalog = await LargeMasterSyncV3SaleCatalog.open(runtime, 'T1');
  const results = await catalog.search('Artículo');
  assert.equal(results.length, 1);
  assert.deepEqual(results[0], { article, price: 125.5, tariff, taxes: [tax], version: runtime.version });
  assert.equal(results[0].version.syncId, 'snapshot-2');
  assert.deepEqual(calls, ['T1']);
  assert.equal((await catalog.get('A'))?.price, 125.5);
  assert.deepEqual(await catalog.findBarcode('7460000000012'), { saleArticle: results[0], variant: null });
});

test('never silently borrows a price from another tariff', async () => {
  const { runtime, calls } = fixture({ prices: [{ articleId: 'A', tariffId: 'OTHER', price: 80 }] });
  const catalog = await LargeMasterSyncV3SaleCatalog.open(runtime, 'T1');
  assert.deepEqual(await catalog.search('Artículo'), []);
  assert.equal(await catalog.get('A'), null);
  assert.equal(await catalog.findBarcode('7460000000012'), null);
  assert.deepEqual(calls, ['T1', 'T1', 'T1']);
});

test('rejects missing tariff, inactive item, unresolved tax and inactive barcode variant', async () => {
  const base = fixture();
  await assert.rejects(() => LargeMasterSyncV3SaleCatalog.open(base.runtime, 'OTHER'),
    (error: unknown) => error instanceof LargeMasterSyncV3Error && error.code === 'SYNC_V3_TARIFF_UNAVAILABLE');
  const inactive = await LargeMasterSyncV3SaleCatalog.open(
    fixture({ article: { ...article, active: false } }).runtime, 'T1');
  assert.deepEqual(await inactive.search('Artículo'), []);
  const missingTax = await LargeMasterSyncV3SaleCatalog.open(fixture({ taxes: [] }).runtime, 'T1');
  await assert.rejects(() => missingTax.get('A'), /SYNC_V3_ARTICLE_TAX_UNAVAILABLE/);
  const inactiveVariant = await LargeMasterSyncV3SaleCatalog.open(
    fixture({ variant: { id: 'V1', active: false } }).runtime, 'T1');
  assert.equal(await inactiveVariant.findBarcode('7460000000012'), null);
});

test('contract-v1 runtime cannot serve operational sales', async () => {
  const { runtime } = fixture({ contractVersion: 1 });
  await assert.rejects(() => LargeMasterSyncV3SaleCatalog.open(runtime, 'T1'),
    /SYNC_V3_OPERATIONAL_CONTRACT_REQUIRED/);
});
