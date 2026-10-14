import type { Product } from '../../types';
import type { ArticleFormatStore } from './store';
import type { ArticleFormatMasterTransport } from './sync';
import { consumeArticleFormatPages } from './sync';
import { ArticleFormatError } from './domain';

/** Integrates a supplied paginated producer with local revision storage, never setup payloads.
 * The ERP transport must authenticate scope and authorized tariffs before constructing store.
 */
export async function syncArticleFormatMasters(store: ArticleFormatStore, transport: ArticleFormatMasterTransport,
  products: Product[], cursor: string | null = null): Promise<Product[]> {
  await consumeArticleFormatPages(store,transport,cursor);
  return hydrateArticleFormatMasters(store,products);
}

/** Call for a bounded sales/search page when rehydrating offline, not for setup. */
export async function hydrateArticleFormatMasters(store: ArticleFormatStore, products: Product[]): Promise<Product[]> {
  if (products.length > 1000) throw new ArticleFormatError('ARTICLE_FORMAT_HYDRATION_PAGE_TOO_LARGE');
  return Promise.all(products.map(async product => {
    const dto = await store.getMaster(product.id);
    if (!dto) return product;
    const variants = new Set((product.variants || []).map(variant => variant.sku));
    if (dto.formats.some(format => format.variantId !== null && !variants.has(format.variantId))) throw new ArticleFormatError('ARTICLE_FORMAT_VARIANT_NOT_FOUND');
    return {...product,article_formats:dto};
  }));
}

/** The V3 adapter owns the active snapshot; ERP IDs are never inferred from SKUs. */
export async function hydrateNetworkFormatMasters(store: import('./posting').NetworkMasterPort, products: Product[]): Promise<Product[]> {
  if (products.length > 1000) throw new ArticleFormatError('ARTICLE_FORMAT_HYDRATION_PAGE_TOO_LARGE');
  const revision = await store.getActiveRevision();
  if (!revision) throw new ArticleFormatError('POS_FORMAT_REVISION_INCOMPLETE');
  return Promise.all(products.map(async product => {
    const master = await store.getPolicy(product.id, revision.syncId, revision.revision);
    if (!master) return { ...product, article_formats: undefined, articleFormatVariantSkus: undefined };
    const mapping = master.policy.variant_skus;
    for (const id of master.policy.variant_ids) {
      if (typeof mapping[id] !== 'string' || product.variants.filter(v => v.sku === mapping[id]).length !== 1) {
        throw new ArticleFormatError('ARTICLE_FORMAT_VARIANT_MAPPING_MISSING');
      }
    }
    return { ...product, article_formats: master.dto, articleFormatVariantSkus: { ...mapping } };
  }));
}
