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

  getPrices(articleIds: string[], tariffId: string) {
    return this.store.getPrices(this.version, articleIds, tariffId);
  }

  findBarcode(barcode: string) {
    return this.store.findBarcode(this.version, barcode);
  }
}
