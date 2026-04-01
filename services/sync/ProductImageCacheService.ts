import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import type { Product } from '../../types';
import { db } from '../../utils/db';

type IncomingProduct = Partial<Product> & Record<string, any>;

/** Incluye números: el JSON del ERP/master suele mandar barcode/sku como number. */
const asString = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value).trim();
};
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

const uniqueStrings = (values: unknown[]): string[] =>
  Array.from(new Set(values.map((value) => asString(value)).filter(Boolean)));

class ProductImageCacheService {
  private readonly imageFolder = 'product-images';
  private readonly logger = console;

  private isNativeAndroid(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  }

  /** Origen del ERP (mismas claves que erpSyncLifecycle) para armar URL absoluta de imágenes relativas. */
  private getErpWebOrigin(): string | null {
    try {
      const env = ((import.meta as unknown as { env?: Record<string, string> }).env) || {};
      const candidates = [
        typeof localStorage !== 'undefined' ? localStorage.getItem('CLIC_ERP_BASE_URL') : '',
        typeof localStorage !== 'undefined' ? localStorage.getItem('CLIC_ERP_SYNC_URL') : '',
        typeof localStorage !== 'undefined' ? localStorage.getItem('erp_base_url') : '',
        env.VITE_ERP_BASE_URL || '',
        env.VITE_SYNC_API_URL || '',
      ];
      for (const c of candidates) {
        const raw = (c || '').trim();
        if (!raw) continue;
        const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/\//, '')}`;
        return new URL(withProto).origin;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  /** Convierte ruta relativa o //cdn... en URL descargable por Filesystem/fetch. */
  private toAbsoluteImageDownloadUrl(candidate: string): string | null {
    const t = candidate.trim();
    if (!t) return null;
    if (/^https?:\/\//i.test(t)) return t;
    if (t.startsWith('//')) {
      return `https:${t}`;
    }
    if (t.startsWith('/')) {
      const origin = this.getErpWebOrigin();
      if (!origin) return null;
      return `${origin}${t}`;
    }
    return null;
  }

  private resolveRemoteImageUrl(item: IncomingProduct): string | null {
    const candidates = [
      asString(item.imageUrl),
      asString(item.image_url),
      asString(item.metadata?.image_url),
      asString(item.foto_url),
      asString(item.photo_url),
      asString(item.thumbnail_url),
      asString(item.picture_url),
      asString(item.imagen),
      asString(item.image),
    ];
    for (const c of candidates) {
      const abs = this.toAbsoluteImageDownloadUrl(c);
      if (abs) return abs;
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
    byId: Map<string, Product>;
    byBarcode: Map<string, Product>;
  }> {
    const products = await db.get('products') as Product[];
    const byId = new Map<string, Product>();
    const byBarcode = new Map<string, Product>();

    for (const product of Array.isArray(products) ? products : []) {
      if (!product?.id) continue;
      byId.set(product.id, product);

      const barcode = asString(product.barcode);
      if (barcode && !byBarcode.has(barcode)) {
        byBarcode.set(barcode, product);
      }
    }

    return { byId, byBarcode };
  }

  /** Códigos candidatos del payload (ERP / snapshot / master) para cruzar con barcode local. */
  private incomingProductCodeCandidates(item: IncomingProduct): string[] {
    const fromArr = Array.isArray(item?.barcodes)
      ? (item.barcodes as unknown[]).map((b) => asString(b)).filter(Boolean)
      : [];
    const single = [
      asString(item?.barcode),
      asString(item?.codigo_barras),
      asString(item?.codigoBarras),
      asString(item?.sku),
      asString(item?.item_code),
      asString(item?.code),
      asString(item?.referencia),
      asString(item?.ref),
      asString(item?.numero_articulo),
      ...fromArr,
    ].filter(Boolean);
    return [...new Set(single)];
  }

  private resolveIncomingLocalProduct(
    item: IncomingProduct,
    localById: Map<string, Product>,
    localByBarcode: Map<string, Product>,
  ): Product | undefined {
    const incomingId = asString(item?.id);
    if (incomingId && localById.has(incomingId)) {
      return localById.get(incomingId);
    }

    for (const code of this.incomingProductCodeCandidates(item)) {
      if (code && localByBarcode.has(code)) {
        return localByBarcode.get(code);
      }
    }

    const skuLike = asString(item?.sku) || asString(item?.item_code) || asString(item?.code);
    if (skuLike && localByBarcode.has(skuLike)) {
      return localByBarcode.get(skuLike);
    }
    if (skuLike && localById.has(skuLike)) {
      return localById.get(skuLike);
    }

    return undefined;
  }

  private normalizeSingleIncomingProduct(item: IncomingProduct, localProduct?: Product): IncomingProduct {
    const imageUrl = this.resolveRemoteImageUrl(item);
    const imageVersion = this.resolveRemoteImageVersion(item, imageUrl);
    const hadRemoteImageLocally = Boolean(asString(localProduct?.imageUrl) || asString(localProduct?.imageLocalPath));
    const incomingMentionsImage =
      Object.prototype.hasOwnProperty.call(item, 'image') ||
      Object.prototype.hasOwnProperty.call(item, 'imageUrl') ||
      Object.prototype.hasOwnProperty.call(item, 'image_url') ||
      Object.prototype.hasOwnProperty.call(item, 'imageVersion') ||
      Object.prototype.hasOwnProperty.call(item, 'image_version') ||
      Object.prototype.hasOwnProperty.call(item, 'images') ||
      (
        item.metadata &&
        typeof item.metadata === 'object' &&
        (
          Object.prototype.hasOwnProperty.call(item.metadata, 'image_url') ||
          Object.prototype.hasOwnProperty.call(item.metadata, 'image_version') ||
          Object.prototype.hasOwnProperty.call(item.metadata, 'image')
        )
      );
    const canonicalId = asString(localProduct?.id) || asString(item?.id);

    const normalized: IncomingProduct = {
      ...item,
      id: canonicalId || item.id,
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

    if (hadRemoteImageLocally && incomingMentionsImage) {
      normalized.imageLocalPath = null;
      normalized.imageUrl = undefined;
      normalized.imageVersion = undefined;
      normalized.image = undefined;
      normalized.images = [];
      return normalized;
    }

    if (hadRemoteImageLocally) {
      normalized.imageLocalPath = localProduct?.imageLocalPath || null;
      normalized.imageUrl = localProduct?.imageUrl || undefined;
      normalized.imageVersion = localProduct?.imageVersion || undefined;
      normalized.image = localProduct?.image || undefined;
      normalized.images = uniqueStrings([
        ...(Array.isArray(localProduct?.images) ? localProduct.images : []),
        localProduct?.image,
      ]);
      return normalized;
    }

    return normalized;
  }

  async normalizeIncomingProducts(items: IncomingProduct[]): Promise<IncomingProduct[]> {
    if (!Array.isArray(items) || items.length === 0) {
      return [];
    }

    const { byId: localById, byBarcode: localByBarcode } = await this.getLocalProductLookups();
    return items.map((item) => {
      const localProduct = this.resolveIncomingLocalProduct(item, localById, localByBarcode);
      return this.normalizeSingleIncomingProduct(item, localProduct);
    });
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

    const localById = await this.getLocalProductsMap();
    const localByBarcode = new Map<string, Product>();
    for (const p of localById.values()) {
      const bc = asString(p.barcode);
      if (bc && !localByBarcode.has(bc)) {
        localByBarcode.set(bc, p);
      }
    }

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

      let localProduct = localById.get(itemId);
      if (!localProduct) {
        for (const code of this.incomingProductCodeCandidates(rawItem)) {
          const hit = localByBarcode.get(code);
          if (hit) {
            localProduct = hit;
            break;
          }
        }
      }
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
          const refreshed = (await db.getDocument('products', localProduct.id)) as Product | null;
          if (refreshed?.id) {
            localById.set(refreshed.id, refreshed);
            const rbc = asString(refreshed.barcode);
            if (rbc) localByBarcode.set(rbc, refreshed);
          }
        } else {
          skipped += 1;
        }
      } catch (error) {
        this.logger.warn(`[ProductImageCacheService] Failed to cache native image for ${itemId}. Falling back to remote URL.`, error);

        try {
          const fallbackPersisted = await this.saveWebFallbackImage(localProduct, imageUrl, imageVersion || imageUrl);

          if (fallbackPersisted) {
            downloaded += 1;
            touched += 1;
            const refreshed = (await db.getDocument('products', localProduct.id)) as Product | null;
            if (refreshed?.id) {
              localById.set(refreshed.id, refreshed);
              const rbc = asString(refreshed.barcode);
              if (rbc) localByBarcode.set(rbc, refreshed);
            }
            continue;
          }
        } catch (fallbackError) {
          this.logger.warn(`[ProductImageCacheService] Failed to persist fallback image for ${itemId}:`, fallbackError);
        }

        failed += 1;
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
