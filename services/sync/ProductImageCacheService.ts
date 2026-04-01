import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import type { Product } from '../../types';
import { db } from '../../utils/db';

type IncomingProduct = Partial<Product> & Record<string, any>;

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const asNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const asBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
};

const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value);

const uniqueStrings = (values: unknown[]): string[] =>
  Array.from(new Set(values.map((value) => asString(value)).filter(Boolean)));

class ProductImageCacheService {
  private readonly imageFolder = 'product-images';
  private readonly logger = console;

  private isNativeAndroid(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  }

  private resolveRemoteImageUrl(item: IncomingProduct): string | null {
    const explicitUrl =
      asString(item.imageUrl) ||
      asString(item.image_url) ||
      asString(item.metadata?.image_url);

    if (explicitUrl && isHttpUrl(explicitUrl)) {
      return explicitUrl;
    }

    const rawImage = asString(item.image);
    if (rawImage && isHttpUrl(rawImage)) {
      return rawImage;
    }

    return null;
  }

  private resolveRemoteImageVersion(item: IncomingProduct, imageUrl: string | null): string | null {
    const explicitVersion =
      asString(item.imageVersion) ||
      asString(item.image_version) ||
      asString(item.metadata?.image_version);

    if (explicitVersion) return explicitVersion;

    const updatedAt = asString(item.updatedAt) || asString(item.updated_at);
    if (updatedAt) return updatedAt;

    return imageUrl || null;
  }

  private buildRelativePath(productId: string, imageVersion: string, imageUrl: string): string {
    const safeId = productId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeVersion = imageVersion.replace(/[^a-zA-Z0-9_-]/g, '_');
    const ext = this.resolveExtension(imageUrl);
    return `${this.imageFolder}/item_${safeId}_${safeVersion}.${ext}`;
  }

  private resolveExtension(imageUrl: string): string {
    const cleanUrl = imageUrl.split('?')[0] || imageUrl;
    const ext = cleanUrl.split('.').pop()?.toLowerCase();
    if (ext && ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
      return ext === 'jpeg' ? 'jpg' : ext;
    }
    return 'jpg';
  }

  private buildRenderableNativePath(uri: string): string {
    return Capacitor.convertFileSrc(uri);
  }

  private buildRenderableWebPath(imageUrl: string): string {
    return imageUrl;
  }

  private async getLocalProductsMap(): Promise<Map<string, Product>> {
    const products = await db.get('products') as Product[];
    const localById = new Map<string, Product>();

    for (const product of Array.isArray(products) ? products : []) {
      if (product?.id) {
        localById.set(product.id, product);
      }
    }

    return localById;
  }

  private async getLocalProductLookups(): Promise<{
    localById: Map<string, Product>;
    localByBarcode: Map<string, Product>;
    localByCode: Map<string, Product>;
  }> {
    const products = await db.get('products') as Product[];
    const localById = new Map<string, Product>();
    const localByBarcode = new Map<string, Product>();
    const localByCode = new Map<string, Product>();

    for (const product of Array.isArray(products) ? products : []) {
      const localId = asString(product?.id);
      if (!localId) continue;

      localById.set(localId, product);

      const barcode = asString(product?.barcode);
      if (barcode && !localByBarcode.has(barcode)) {
        localByBarcode.set(barcode, product);
      }

      const codeCandidates = uniqueStrings([
        localId,
        (product as any)?.sku,
        (product as any)?.item_code,
        (product as any)?.code,
        barcode,
      ]);

      for (const code of codeCandidates) {
        if (!localByCode.has(code)) {
          localByCode.set(code, product);
        }
      }
    }

    return { localById, localByBarcode, localByCode };
  }

  private incomingProductCodeCandidates(item: IncomingProduct): string[] {
    return uniqueStrings([
      item?.id,
      item?.sku,
      item?.item_code,
      item?.code,
      item?.barcode,
    ]);
  }

  private findLocalProductMatch(
    item: IncomingProduct,
    lookups: {
      localById: Map<string, Product>;
      localByBarcode: Map<string, Product>;
      localByCode: Map<string, Product>;
    }
  ): Product | undefined {
    const incomingId = asString(item?.id);
    if (incomingId && lookups.localById.has(incomingId)) {
      return lookups.localById.get(incomingId);
    }

    for (const code of this.incomingProductCodeCandidates(item)) {
      if (code && lookups.localById.has(code)) {
        return lookups.localById.get(code);
      }
    }

    for (const code of this.incomingProductCodeCandidates(item)) {
      if (code && lookups.localByCode.has(code)) {
        return lookups.localByCode.get(code);
      }
    }

    for (const code of this.incomingProductCodeCandidates(item)) {
      if (code && lookups.localByBarcode.has(code)) {
        return lookups.localByBarcode.get(code);
      }
    }

    return undefined;
  }

  private normalizeSingleIncomingProduct(item: IncomingProduct, localProduct?: Product): IncomingProduct {
    const imageUrl = this.resolveRemoteImageUrl(item);
    const imageVersion = this.resolveRemoteImageVersion(item, imageUrl);
    const hadRemoteImageLocally = Boolean(asString(localProduct?.imageUrl) || asString(localProduct?.imageLocalPath));

    const normalized: IncomingProduct = {
      ...item,
      name: asString(item.name) || asString(item.nombre) || localProduct?.name || '',
      price: asNumber(item.price ?? item.precio_venta, localProduct?.price ?? 0),
      cost: asNumber(item.cost ?? item.costo_unitario, localProduct?.cost ?? 0),
      category: asString(item.category) || asString(item.categoria) || localProduct?.category || 'GENERAL',
      image: item.image,
      imageUrl: imageUrl || undefined,
      imageVersion: imageVersion || undefined,
      imageLocalPath: item.imageLocalPath ?? localProduct?.imageLocalPath ?? null,
      images: uniqueStrings(Array.isArray(item.images) ? item.images : localProduct?.images || []),
      attributes: Array.isArray(item.attributes) ? item.attributes : localProduct?.attributes || [],
      variants: Array.isArray(item.variants) ? item.variants : localProduct?.variants || [],
      tariffs: Array.isArray(item.tariffs) ? item.tariffs : localProduct?.tariffs || [],
      appliedTaxIds: uniqueStrings(
        Array.isArray(item.appliedTaxIds)
          ? item.appliedTaxIds
          : (Array.isArray(item.tax_ids) ? item.tax_ids : localProduct?.appliedTaxIds || [])
      ),
      activeInWarehouses: uniqueStrings(
        Array.isArray(item.activeInWarehouses)
          ? item.activeInWarehouses
          : (Array.isArray(item.warehouse_ids) ? item.warehouse_ids : localProduct?.activeInWarehouses || [])
      ),
      isInventoriable: asBoolean(
        item.isInventoriable ?? item.is_inventoriable,
        localProduct?.isInventoriable ?? true,
      ),
    };

    delete normalized.image_url;
    delete normalized.image_version;

    if (imageUrl && imageVersion) {
      const canReuseLocalImage =
        asString(localProduct?.imageUrl) === imageUrl &&
        asString(localProduct?.imageVersion) === imageVersion &&
        asString(localProduct?.imageLocalPath).length > 0;

      if (canReuseLocalImage) {
        normalized.imageLocalPath = localProduct?.imageLocalPath || null;
        normalized.image = localProduct?.image || undefined;
        normalized.images = uniqueStrings([
          ...(Array.isArray(localProduct?.images) ? localProduct.images : []),
          localProduct?.image,
        ]);
      } else if (!this.isNativeAndroid()) {
        normalized.imageLocalPath = null;
        normalized.image = this.buildRenderableWebPath(imageUrl);
        normalized.images = uniqueStrings([normalized.image]);
      } else {
        normalized.imageLocalPath = null;
        normalized.image = undefined;
        normalized.images = [];
      }

      return normalized;
    }

    if (hadRemoteImageLocally) {
      normalized.imageLocalPath = null;
      normalized.imageUrl = undefined;
      normalized.imageVersion = undefined;
      normalized.image = undefined;
      normalized.images = [];
      return normalized;
    }

    return normalized;
  }

  async normalizeIncomingProducts(items: IncomingProduct[]): Promise<IncomingProduct[]> {
    if (!Array.isArray(items) || items.length === 0) {
      return [];
    }

    const lookups = await this.getLocalProductLookups();
    return items.map((item) => this.normalizeSingleIncomingProduct(item, this.findLocalProductMatch(item, lookups)));
  }

  private async saveLocalImage(product: Product, imageUrl: string, imageVersion: string): Promise<boolean> {
    const relativePath = this.buildRelativePath(product.id, imageVersion, imageUrl);

    await Filesystem.downloadFile({
      url: imageUrl,
      path: relativePath,
      directory: Directory.Data,
      progress: false,
    });

    const uriResult = await Filesystem.getUri({
      path: relativePath,
      directory: Directory.Data,
    });

    const fileUri = asString(uriResult.uri);
    if (!fileUri) {
      throw new Error(`No se pudo resolver la ruta local para ${product.id}.`);
    }

    const renderablePath = this.buildRenderableNativePath(fileUri);
    const nextImages = uniqueStrings([renderablePath]);

    await db.saveDocument('products', {
      ...product,
      image: renderablePath,
      images: nextImages,
      imageUrl,
      imageVersion,
      imageLocalPath: fileUri,
    });

    return true;
  }

  private async saveWebFallbackImage(product: Product, imageUrl: string, imageVersion: string): Promise<boolean> {
    const renderablePath = this.buildRenderableWebPath(imageUrl);
    const nextImages = uniqueStrings([renderablePath]);

    await db.saveDocument('products', {
      ...product,
      image: renderablePath,
      images: nextImages,
      imageUrl,
      imageVersion,
      imageLocalPath: null,
    });

    return true;
  }

  private async clearCachedImage(product: Product): Promise<boolean> {
    const hadManagedImage = Boolean(asString(product.imageUrl) || asString(product.imageLocalPath));
    if (!hadManagedImage) return false;

    await db.saveDocument('products', {
      ...product,
      image: undefined,
      images: [],
      imageUrl: undefined,
      imageVersion: undefined,
      imageLocalPath: null,
    });

    return true;
  }

  async syncSnapshotItems(items: IncomingProduct[]): Promise<{
    scanned: number;
    queued: number;
    downloaded: number;
    skipped: number;
    failed: number;
  }> {
    const incoming = Array.isArray(items) ? items : [];
    if (incoming.length === 0) {
      return { scanned: 0, queued: 0, downloaded: 0, skipped: 0, failed: 0 };
    }

    const lookups = await this.getLocalProductLookups();
    let queued = 0;
    let downloaded = 0;
    let skipped = 0;
    let failed = 0;
    let touched = 0;

    for (const rawItem of incoming) {
      const itemId = asString(rawItem?.id);
      if (!itemId) {
        skipped += 1;
        continue;
      }

      const localProduct = this.findLocalProductMatch(rawItem, lookups);
      if (!localProduct) {
        skipped += 1;
        continue;
      }

      const imageUrl = this.resolveRemoteImageUrl(rawItem);
      const imageVersion = this.resolveRemoteImageVersion(rawItem, imageUrl);

      if (!imageUrl) {
        const cleared = await this.clearCachedImage(localProduct);
        if (cleared) touched += 1;
        skipped += 1;
        continue;
      }

      const sameVersion =
        asString(localProduct.imageUrl) === imageUrl &&
        asString(localProduct.imageVersion) === (imageVersion || '') &&
        (this.isNativeAndroid() ? asString(localProduct.imageLocalPath).length > 0 : asString(localProduct.image).length > 0);

      if (sameVersion) {
        skipped += 1;
        continue;
      }

      queued += 1;

      try {
        const persisted = this.isNativeAndroid()
          ? await this.saveLocalImage(localProduct, imageUrl, imageVersion || imageUrl)
          : await this.saveWebFallbackImage(localProduct, imageUrl, imageVersion || imageUrl);

        if (persisted) {
          downloaded += 1;
          touched += 1;
        } else {
          skipped += 1;
        }
      } catch (error) {
        failed += 1;
        this.logger.warn(`[ProductImageCacheService] Failed to cache image for ${itemId}:`, error);
      }
    }

    if (touched > 0) {
      window.dispatchEvent(new CustomEvent('productsUpdated'));
    }

    return {
      scanned: incoming.length,
      queued,
      downloaded,
      skipped,
      failed,
    };
  }
}

export const productImageCacheService = new ProductImageCacheService();
