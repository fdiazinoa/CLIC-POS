import type { BusinessConfig, Product } from '../../types';
import { db } from '../../utils/db';
import { normalizeItemLabelPrice, selectItemLabelPrice, type ItemLabelPrice } from '../../utils/itemLabelPrice';
import type { LabelPrintRecord } from '../../utils/labelPrinter';
import { itemLabelPriceBinding, itemLabelPricesGeneration, readItemLabelPrices } from './ItemLabelPriceCollection';
import { usesLargeMasterSyncV3Authority } from './LargeMasterSyncV3Authority';
import { acquireLargeMasterSyncV3ConfigContext } from './LargeMasterSyncV3OperationalSession';
import { resolveSyncTarget } from './SyncProfile';

type CatalogIdentity = Pick<Product, 'id'> & { sourceItemId?: string; source_item_id?: string; erpProductId?: string };

export const labelCatalogProductId = (product: CatalogIdentity | undefined): string | undefined =>
  product?.sourceItemId || product?.source_item_id || product?.erpProductId || product?.id;

export async function openItemLabelCatalog(config: BusinessConfig, localTerminalId: string) {
  const session = await acquireLargeMasterSyncV3ConfigContext(config, localTerminalId);
  const { runtime, inventoryVersion, inventoryCursor } = session.ready;
  const terminal = config.terminals.find(row => row.id === localTerminalId);
  const tariffId = terminal?.config.pricing?.defaultTariffId;
  const warehouseId = terminal?.config.inventoryScope?.defaultSalesWarehouseId;
  if (!tariffId || !warehouseId) throw new Error('SYNC_V3_CATALOG_CONTEXT_REQUIRED');

  return {
    async page(query: string, afterId: string | null) {
      await session.assertCurrent();
      const result = await runtime.readAdministrativeCatalogPage({
        query, afterId, limit: 50, tariffId, warehouseId, inventoryVersion, inventoryCursor,
      });
      await session.assertCurrent();
      return {
        items: result.rows.filter(row => row.active).map(row => ({
          id: row.id, name: row.name, barcode: row.barcode ?? row.sku ?? undefined, price: row.price ?? undefined,
        })),
        nextCursor: result.nextCursor,
      };
    },
    async find(code: string) {
      await session.assertCurrent();
      const match = await runtime.findOperationalCode(code);
      if (!match) return null;
      const itemIds = [match.articleId];
      const [articles, prices] = await Promise.all([runtime.readLabelCatalogArticles(itemIds), runtime.getPrices(itemIds, tariffId)]);
      await session.assertCurrent();
      const article = articles[0];
      if (!article) return null;
      return {
        id: match.articleId,
        name: String(article.description || match.articleId),
        barcode: code,
        price: prices[0]?.price == null ? undefined : Number(prices[0].price),
      };
    },
  };
}

export type LabelPricePreview = {
  records: LabelPrintRecord[];
  assertCurrent(): Promise<void>;
};

export async function readLabelPricePreview(
  config: BusinessConfig,
  localTerminalId: string,
  records: LabelPrintRecord[],
): Promise<LabelPricePreview> {
  const before = itemLabelPricesGeneration();
  const binding = itemLabelPriceBinding(config, localTerminalId);
  const v3 = Boolean(binding && usesLargeMasterSyncV3Authority(resolveSyncTarget().kind));
  const session = v3 ? await acquireLargeMasterSyncV3ConfigContext(config, localTerminalId) : null;
  const itemIds = [...new Set(records.map(row => row.catalogItemId || row.productId))];
  const local = binding ? await readItemLabelPrices(binding, itemIds) : null;
  const assertCurrent = async () => {
    if (itemLabelPricesGeneration() !== before) throw new Error('ITEM_LABEL_PRICE_PREVIEW_CHANGED');
    const persisted = await db.get('config') as unknown as BusinessConfig;
    if (itemLabelPriceBinding(persisted, localTerminalId)?.key !== binding?.key
      || itemLabelPricesGeneration() !== before) throw new Error('ITEM_LABEL_PRICE_PREVIEW_CHANGED');
    await session?.assertCurrent();
    await local?.assertCurrent();
    if (itemLabelPricesGeneration() !== before) throw new Error('ITEM_LABEL_PRICE_PREVIEW_CHANGED');
  };

  if (!binding) return { records: records.map(row => ({ ...row, labelPrice: null })), assertCurrent };

  const snapshot = new Map<string, Record<string, unknown>>();
  if (session) {
    for (let index = 0; index < itemIds.length; index += 100) {
      const batch = await session.ready.runtime.readLabelCatalogArticles(itemIds.slice(index, index + 100));
      for (const item of batch) snapshot.set(String(item.id), item);
    }
  }

  const priceFor = (id: string): ItemLabelPrice | null => {
    const article = snapshot.get(id);
    if (session && !article) return null;
    const revision = article?.labelPriceRevision;
    const catalog = typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0
      ? { labelPrice: normalizeItemLabelPrice(article?.labelPrice), revision } : null;
    return selectItemLabelPrice(catalog, local?.prices.get(id) ?? null, local?.hasIncrementalCollection);
  };
  await assertCurrent();
  return {
    records: records.map(row => ({ ...row, labelPrice: priceFor(row.catalogItemId || row.productId) })),
    assertCurrent,
  };
}
