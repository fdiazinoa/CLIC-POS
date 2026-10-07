import type { V3CategoryFilter } from './LargeMasterSyncV3Categories';
import type { Product, ProductOperationalFlags, ProductVariant, TaxDefinition,
  V3SaleAuthorityStamp } from '../../types';
import type { LargeMasterSyncV3CandidateReady } from './LargeMasterSyncV3Candidate';
import { LargeMasterSyncV3SaleCatalog, type V3SaleArticle } from './LargeMasterSyncV3SaleCatalog';
import { LargeMasterSyncV3Error } from './LargeMasterSyncV3Types';

type RecordObject = Record<string, unknown>;

const stringValue = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const optionalString = (value: unknown): string | undefined => stringValue(value) || undefined;
const booleanValue = (value: unknown): boolean => value === true;
const taxType = (value: unknown): TaxDefinition['type'] => {
  if (value === 'SALES' || value === 'VAT') return 'VAT';
  if (value === 'SERVICE_CHARGE' || value === 'EXEMPT') return value;
  throw new LargeMasterSyncV3Error('SYNC_V3_TAX_TYPE_INVALID');
};
const variantPrice = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new LargeMasterSyncV3Error('SYNC_V3_VARIANT_PRICE_INVALID');
  }
  return value;
};

const operationalFlags = (value: unknown): ProductOperationalFlags => {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordObject : {};
  return {
    isWeighted: booleanValue(source.isWeighted),
    trackInventory: booleanValue(source.trackInventory),
    autoPrintLabel: booleanValue(source.autoPrintLabel),
    promptPrice: booleanValue(source.promptPrice),
    integersOnly: booleanValue(source.integersOnly),
    ageRestricted: booleanValue(source.ageRestricted),
    allowNegativeStock: booleanValue(source.allowNegativeStock),
    excludeFromPromotions: booleanValue(source.excludeFromPromotions),
    excludeFromLoyalty: booleanValue(source.excludeFromLoyalty),
    usesLots: booleanValue(source.usesLots),
    usesSerial: booleanValue(source.usesSerial),
  };
};

export interface V3OperationalProduct {
  product: Product;
  taxes: TaxDefinition[];
  authority: Readonly<V3SaleAuthorityStamp>;
}

/**
 * On-demand adapter for the existing POS product model. It never reads the
 * legacy product, price, tax or inventory collections and does not persist the
 * adapted product into them. The authority stamp must travel with cart lines.
 */
export class LargeMasterSyncV3OperationalCatalog {
  private constructor(
    private readonly saleCatalog: LargeMasterSyncV3SaleCatalog,
    private readonly ready: LargeMasterSyncV3CandidateReady,
    private readonly warehouseId: string,
  ) {}

  static async open(
    ready: LargeMasterSyncV3CandidateReady,
    tariffId: string,
    warehouseId: string,
  ): Promise<LargeMasterSyncV3OperationalCatalog> {
    if (!stringValue(warehouseId)) throw new LargeMasterSyncV3Error('SYNC_V3_WAREHOUSE_REQUIRED');
    const catalog = new LargeMasterSyncV3OperationalCatalog(
      await LargeMasterSyncV3SaleCatalog.open(ready.runtime, tariffId), ready, warehouseId.trim(),
    );
    await catalog.assertInventoryVersion();
    return catalog;
  }

  private async assertInventoryVersion(): Promise<void> {
    const inventory = await this.ready.runtime.getInventorySnapshotVersion();
    if (!inventory || inventory.version !== this.ready.inventoryVersion
      || inventory.cursor !== this.ready.inventoryCursor) {
      throw new LargeMasterSyncV3Error('SYNC_V3_INVENTORY_NOT_READY');
    }
  }

  private async adapt(sale: V3SaleArticle, support?: {
    balance: { qtyOnHand: number; qtyReserved: number; qtyCommitted: number } | null;
    variants: RecordObject[];
  }): Promise<V3OperationalProduct> {
    const article = sale.article;
    const sourceFlags = operationalFlags(article.operationalFlags);
    if (!['PRODUCT', 'SERVICE'].includes(String(article.type))
      || sourceFlags.usesLots || sourceFlags.usesSerial || sourceFlags.isWeighted
      || (Array.isArray(article.recipeDetails) && article.recipeDetails.length)
      || (Array.isArray(article.modifiers) && article.modifiers.length)) {
      throw new LargeMasterSyncV3Error('SYNC_V3_ADVANCED_ARTICLE_CONTRACT_REQUIRED');
    }
    const articleId = stringValue(article.id);
    const name = stringValue(article.name);
    if (!articleId || !name || sale.version.syncId !== this.ready.runtime.version.syncId
      || sale.version.syncVersion !== this.ready.runtime.version.syncVersion) {
      throw new LargeMasterSyncV3Error('SYNC_V3_ARTICLE_INVALID');
    }
    const [balance, sourceVariants] = support ? [support.balance, support.variants] : await Promise.all([
      this.ready.runtime.getInventoryBalance(articleId, this.warehouseId),
      this.ready.runtime.getOperationalVariants(articleId),
    ]);
    const variants: ProductVariant[] = sourceVariants.filter(row => row.active === true).map(row => ({
      id: stringValue(row.id),
      sku: stringValue(row.sku),
      barcode: Array.isArray(row.barcodes) ? row.barcodes.map(stringValue).filter(Boolean) : [],
      attributeValues: row.attributeValues && typeof row.attributeValues === 'object'
        && !Array.isArray(row.attributeValues) ? row.attributeValues as Record<string, string> : {},
      price: variantPrice(row.price),
      initialStock: typeof row.initialStock === 'number' ? row.initialStock : undefined,
    }));
    const taxes: TaxDefinition[] = sale.taxes.map(row => ({
      id: stringValue(row.id),
      code: optionalString(row.code),
      name: stringValue(row.name),
      rate: row.rate as number,
      type: taxType(row.type),
    }));
    const flags = operationalFlags(article.operationalFlags);
    const authority: Readonly<V3SaleAuthorityStamp> = Object.freeze({
      syncId: sale.version.syncId,
      syncVersion: sale.version.syncVersion,
      tariffId: this.saleCatalog.tariffId,
      taxIncluded: sale.tariff.taxIncluded === true,
      inventoryVersion: this.ready.inventoryVersion,
      inventoryCursor: this.ready.inventoryCursor,
    });
    const product: Product = {
      id: articleId,
      sku: optionalString(article.sku),
      externalCode: optionalString(article.externalCode),
      name,
      description: optionalString(article.description),
      price: sale.price,
      category: stringValue(article.category),
      posCategoryId: optionalString(article.posCategoryId),
      familyId: optionalString(article.familyId),
      posSortOrder: typeof article.posSortOrder === 'number' ? article.posSortOrder : undefined,
      type: article.type === 'SERVICE' ? 'SERVICE' : 'PRODUCT',
      is_active: true,
      is_sellable: true,
      v3SaleAuthority: authority,
      isInventoriable: booleanValue(article.inventoriable),
      taxable: booleanValue(article.taxable),
      appliedTaxIds: taxes.map(tax => tax.id),
      operationalFlags: flags,
      stock: balance ? balance.qtyOnHand - balance.qtyReserved - balance.qtyCommitted : 0,
      stockBalances: { [this.warehouseId]: balance
        ? balance.qtyOnHand - balance.qtyReserved - balance.qtyCommitted : 0 },
      measurementUnit: optionalString(article.measurementUnit),
      purchaseUnit: optionalString(article.purchaseUnit),
      conversionFactor: typeof article.conversionFactor === 'number' ? article.conversionFactor : undefined,
      activeInWarehouses: Array.isArray(article.activeWarehouseIds)
        ? article.activeWarehouseIds.map(stringValue).filter(Boolean) : [],
      images: [],
      attributes: [],
      variants,
      tariffs: [{ tariffId: this.saleCatalog.tariffId, price: sale.price }],
    };
    return { product, taxes, authority };
  }

  categories() { return this.saleCatalog.categories(); }

  async search(query: string, categoryId?: V3CategoryFilter, limit = 60): Promise<V3OperationalProduct[]> {
    await this.assertInventoryVersion();
    const sales = await this.saleCatalog.search(query, categoryId, limit);
    const supports = await this.ready.runtime.getOperationalSupports(sales.map(sale => stringValue(sale.article.id)), this.warehouseId);
    const items = await Promise.all(sales.map(sale => this.adapt(sale, supports ? {
      balance: supports.balances[stringValue(sale.article.id)] || null,
      variants: supports.variants[stringValue(sale.article.id)] || [],
    } : undefined)));
    await this.assertInventoryVersion();
    return items;
  }

  async get(articleId: string): Promise<V3OperationalProduct | null> {
    await this.assertInventoryVersion();
    const sale = await this.saleCatalog.get(articleId);
    const item = sale ? await this.adapt(sale) : null;
    await this.assertInventoryVersion();
    return item;
  }

  async findBarcode(barcode: string, exactCode = false): Promise<{
    item: V3OperationalProduct;
    variant: ProductVariant | null;
  } | null> {
    await this.assertInventoryVersion();
    const match = await this.saleCatalog.findBarcode(barcode, exactCode);
    if (!match) {
      await this.assertInventoryVersion();
      return null;
    }
    const item = await this.adapt(match.saleArticle);
    const variantId = stringValue(match.variant?.id);
    const variant = variantId ? item.product.variants.find(row => row.id === variantId) || null : null;
    if (variantId && !variant) throw new LargeMasterSyncV3Error('SYNC_V3_VARIANT_UNAVAILABLE');
    await this.assertInventoryVersion();
    return { item, variant };
  }
}
