import { LargeMasterSyncV3Runtime } from './LargeMasterSyncV3Runtime';
import { LargeMasterSyncV3Error, type LargeMasterSyncV3RuntimeVersion } from './LargeMasterSyncV3Types';

type RecordObject = Record<string, unknown>;

export interface V3SaleArticle {
  article: RecordObject;
  price: number;
  tariff: RecordObject;
  taxes: RecordObject[];
  /** The same immutable snapshot is retained through cart and checkout. */
  version: LargeMasterSyncV3RuntimeVersion;
}

const id = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

/**
 * Read-only sale boundary for one V3 snapshot and one effective tariff. It
 * never substitutes a price, tax, or article from the legacy collections.
 * The caller must keep this instance pinned until the sale has finished.
 */
export class LargeMasterSyncV3SaleCatalog {
  private constructor(
    private readonly runtime: LargeMasterSyncV3Runtime,
    private readonly tariff: RecordObject,
    private readonly taxes: Map<string, RecordObject>,
  ) {}

  static async open(runtime: LargeMasterSyncV3Runtime, tariffId: string): Promise<LargeMasterSyncV3SaleCatalog> {
    if ((runtime.version.contractVersion || 1) < 2) {
      throw new LargeMasterSyncV3Error('SYNC_V3_OPERATIONAL_CONTRACT_REQUIRED');
    }
    const effectiveTariffId = id(tariffId);
    if (!effectiveTariffId) throw new LargeMasterSyncV3Error('SYNC_V3_TARIFF_REQUIRED');
    const [tariffs, taxes] = await Promise.all([
      runtime.getOperationalTariffs(), runtime.getOperationalTaxes(),
    ]);
    const tariff = tariffs.find(row => id(row.id) === effectiveTariffId && row.active === true);
    if (!tariff || typeof tariff.taxIncluded !== 'boolean') {
      throw new LargeMasterSyncV3Error('SYNC_V3_TARIFF_UNAVAILABLE');
    }
    const activeTaxes = new Map<string, RecordObject>();
    for (const tax of taxes) {
      const taxId = id(tax.id);
      if (taxId && tax.active === true && typeof tax.rate === 'number'
        && Number.isFinite(tax.rate) && tax.rate >= 0 && tax.rate <= 1) {
        activeTaxes.set(taxId, tax);
      }
    }
    return new LargeMasterSyncV3SaleCatalog(runtime, tariff, activeTaxes);
  }

  get version(): LargeMasterSyncV3RuntimeVersion { return this.runtime.version; }
  get tariffId(): string { return id(this.tariff.id); }

  private async priceArticles(articles: RecordObject[]): Promise<V3SaleArticle[]> {
    const eligible = articles.filter(article => id(article.id)
      && article.active === true && article.sellable === true);
    if (!eligible.length) return [];
    const prices = await this.runtime.getPrices(eligible.map(article => id(article.id)), this.tariffId);
    const byArticle = new Map(prices.filter(price => price.tariffId === this.tariffId)
      .map(price => [price.articleId, price.price]));
    return eligible.flatMap(article => {
      const price = byArticle.get(id(article.id));
      // An unpriced article is not sellable on this tariff, even if another
      // tariff has a price. Never use article.price or a legacy fallback.
      if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) return [];
      const taxIds = article.taxIds;
      if (!Array.isArray(taxIds) || taxIds.some(taxId => !id(taxId))) {
        throw new LargeMasterSyncV3Error('SYNC_V3_ARTICLE_TAX_INVALID');
      }
      const resolvedTaxes = taxIds.map(taxId => this.taxes.get(id(taxId)));
      if (resolvedTaxes.some(tax => !tax) || (article.taxable === true && !resolvedTaxes.length)) {
        throw new LargeMasterSyncV3Error('SYNC_V3_ARTICLE_TAX_UNAVAILABLE');
      }
      return [{ article, price, tariff: this.tariff,
        taxes: resolvedTaxes as RecordObject[], version: this.runtime.version }];
    });
  }

  async search(query: string, categoryId?: string | null, limit = 60): Promise<V3SaleArticle[]> {
    const articles = await this.runtime.searchOperationalArticles(query, categoryId, limit);
    return this.priceArticles(articles);
  }

  async get(articleId: string): Promise<V3SaleArticle | null> {
    const article = await this.runtime.getOperationalArticle(id(articleId));
    if (!article) return null;
    return (await this.priceArticles([article]))[0] || null;
  }

  async findBarcode(barcode: string, exactCode = false): Promise<{ saleArticle: V3SaleArticle; variant: RecordObject | null } | null> {
    const match = exactCode ? await this.runtime.findOperationalCode(id(barcode)) : await this.runtime.findBarcode(id(barcode));
    if (!match) return null;
    const saleArticle = await this.get(match.articleId);
    if (!saleArticle) return null;
    if (!match.variantId) return { saleArticle, variant: null };
    const variants = await this.runtime.getOperationalVariants(match.articleId);
    const variant = variants.find(row => id(row.id) === match.variantId && row.active === true);
    return variant ? { saleArticle, variant } : null;
  }
}
