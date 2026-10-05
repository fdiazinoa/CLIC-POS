import type {
  LargeMasterSyncV3RuntimeVersion,
  LargeMasterSyncV3Store,
} from './LargeMasterSyncV3Types';

/**
 * Immutable version fence for POS reads. Existing sales retain this object while
 * a newly activated version is prepared, so articles/prices/barcodes cannot mix.
 */
export class LargeMasterSyncV3Runtime {
  private constructor(
    private readonly store: LargeMasterSyncV3Store,
    public readonly version: LargeMasterSyncV3RuntimeVersion,
  ) {}

  static async open(store: LargeMasterSyncV3Store): Promise<LargeMasterSyncV3Runtime | null> {
    const version = await store.getActiveRuntimeVersion();
    return version ? new LargeMasterSyncV3Runtime(store, Object.freeze({ ...version })) : null;
  }

  listArticlesPage(afterArticleId: string | null, limit = 100): Promise<Record<string, unknown>[]> {
    return this.store.listArticlesPage(this.version, afterArticleId, limit);
  }

  searchOperationalArticles(query: string, categoryId?: string | null, limit = 60): Promise<Record<string, unknown>[]> {
    return this.store.searchOperationalArticles(this.version, query, categoryId, limit);
  }

  getOperationalArticle(articleId: string): Promise<Record<string, unknown> | null> {
    return this.store.getOperationalArticle(this.version, articleId);
  }

  getOperationalTariffs(): Promise<Record<string, unknown>[]> {
    return this.store.getOperationalTariffs(this.version);
  }

  getOperationalTaxes(): Promise<Record<string, unknown>[]> {
    return this.store.getOperationalTaxes(this.version);
  }

  getOperationalVariants(articleId: string): Promise<Record<string, unknown>[]> {
    return this.store.getOperationalVariants(this.version, articleId);
  }

  getPrices(articleIds: string[], tariffId: string) {
    return this.store.getPrices(this.version, articleIds, tariffId);
  }

  findBarcode(barcode: string) {
    return this.store.findBarcode(this.version, barcode);
  }
}
