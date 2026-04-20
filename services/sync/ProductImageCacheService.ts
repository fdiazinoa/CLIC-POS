import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import type { BusinessConfig, Product, TariffPrice, Warehouse } from '../../types';
import { db } from '../../utils/db';
import {
  canonicalizeTariffEntries,
  canonicalizeWarehouseIds,
  canonicalizeWarehouseRecord,
  deriveWarehouseIdsFromStockBalances,
  deriveWarehouseIdsFromSettings,
} from '../../utils/masterIdentity';
import { extractWarehouseStockBalances, productIdentityCandidates } from '../../utils/productReferences';

type IncomingProduct = Partial<Product> & Record<string, any>;

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const asObject = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
const asArray = <T = any>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
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

const normalizeTariffEntries = (value: unknown): TariffPrice[] => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => asObject(entry))
      .filter((entry) => Object.keys(entry).length > 0)
      .map((entry) => {
        const tariffId = asString(entry.tariffId ?? entry.tariff_id ?? entry.id ?? entry.code ?? entry.tariffCode ?? entry.tariff_code ?? entry.name);
        if (!tariffId) return null;

        return {
          ...entry,
          tariffId,
          price: asNumber(entry.price),
        };
      })
      .filter((entry): entry is TariffPrice => Boolean(entry));
  }

  const objectEntries = asObject(value);
  if (Object.keys(objectEntries).length === 0) return [];

  return Object.entries(objectEntries)
    .map(([key, rawValue]) => {
      if (typeof rawValue === 'number' || typeof rawValue === 'string') {
        return {
          tariffId: asString(key),
          price: asNumber(rawValue),
        };
      }

      const entry = asObject(rawValue);
      const tariffId = asString(entry.tariffId ?? entry.tariff_id ?? entry.id ?? entry.code ?? entry.tariffCode ?? entry.tariff_code ?? key);
      if (!tariffId) return null;

      return {
        ...entry,
        tariffId,
        price: asNumber(entry.price),
      };
    })
    .filter((entry): entry is TariffPrice => Boolean(entry));
};

const normalizeTaxIdList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return uniqueStrings(
      value.map((entry) =>
        typeof entry === 'string'
          ? entry
          : asString((entry as Record<string, unknown>)?.id)
            || asString((entry as Record<string, unknown>)?.code)
            || asString((entry as Record<string, unknown>)?.tax_id)
            || asString((entry as Record<string, unknown>)?.taxCode)
      )
    );
  }

  if (typeof value === 'string') {
    return uniqueStrings(value.split(',').map((entry) => entry.trim()));
  }

  return [];
};

type NormalizationContext = {
  tariffs: BusinessConfig['tariffs'];
  warehouses: Warehouse[];
};

const resolveIncomingTaxIds = (item: IncomingProduct, localProduct?: Product): string[] => {
  const metadata = asObject(item.metadata);
  const candidates: unknown[] = [
    item.appliedTaxIds,
    item.tax_ids,
    item.taxIds,
    item.tax_codes,
    metadata.appliedTaxIds,
    metadata.tax_ids,
    metadata.taxIds,
    metadata.tax_codes,
    metadata.taxes,
    localProduct?.appliedTaxIds,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeTaxIdList(candidate);
    if (normalized.length > 0) {
      return normalized;
    }
  }

  return [];
};

class ProductImageCacheService {
  private readonly imageFolder = 'product-images';
  private readonly logger = console;

  private isNativeAndroid(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  }

  private readMasterUrl(): string | null {
    return asString(localStorage.getItem('CLIC_POS_MASTER_URL')) || null;
  }

  private rewriteLoopbackHostname(urlValue: string, masterUrlValue: string | null): string {
    if (!masterUrlValue || !this.isNativeAndroid()) {
      return urlValue;
    }

    try {
      const urlObj = new URL(urlValue);
      if (urlObj.hostname !== 'localhost' && urlObj.hostname !== '127.0.0.1') {
        return urlValue;
      }

      const masterObj = new URL(masterUrlValue);
      urlObj.protocol = masterObj.protocol;
      urlObj.hostname = masterObj.hostname;
      return urlObj.toString();
    } catch {
      return urlValue;
    }
  }

  private resolveRelativeImageBaseUrl(masterUrl: string | null): string | null {
    const env = (import.meta as any)?.env || {};
    const candidates = uniqueStrings([
      env.VITE_SUPABASE_URL,
      localStorage.getItem('CLIC_SUPABASE_URL'),
      localStorage.getItem('SUPABASE_URL'),
      localStorage.getItem('CLIC_ERP_BASE_URL'),
      localStorage.getItem('erp_base_url'),
      masterUrl,
    ]);

    for (const candidate of candidates) {
      try {
        const normalized = this.rewriteLoopbackHostname(candidate, masterUrl);
        const urlObj = new URL(normalized);
        return urlObj.toString().replace(/\/$/, '');
      } catch {
        continue;
      }
    }

    return null;
  }

  private resolveRemoteImageUrl(item: IncomingProduct): string | null {
    const rawUrl =
      asString(item.imageUrl) ||
      asString(item.image_url) ||
      asString(item.metadata?.image_url) ||
      asString(item.image);

    if (!rawUrl) return null;
    if (rawUrl.startsWith('blob:') || rawUrl.startsWith('data:')) return rawUrl;

    try {
      const masterUrl = this.readMasterUrl();

      // Handle relative paths (e.g. "storage/v1/..." or "/storage/v1/...")
      if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
        const baseUrl = this.resolveRelativeImageBaseUrl(masterUrl);
        if (!baseUrl) return rawUrl;

        const path = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`;
        return new URL(path, `${baseUrl}/`).toString();
      }

      if (this.isNativeAndroid() && (rawUrl.includes('localhost') || rawUrl.includes('127.0.0.1'))) {
        return this.rewriteLoopbackHostname(rawUrl, masterUrl);
      }

      return rawUrl;
    } catch (e) {
      this.logger.warn(`[ProductImageCacheService] Failed to rewrite remote URL: ${rawUrl}`, e);
      return rawUrl;
    }
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
    localByIdentity: Map<string, Product>;
  }> {
    const products = await db.get('products') as Product[];
    const localByIdentity = new Map<string, Product>();

    for (const product of Array.isArray(products) ? products : []) {
      for (const candidate of productIdentityCandidates(product)) {
        if (!localByIdentity.has(candidate)) {
          localByIdentity.set(candidate, product);
        }
      }
    }

    return { localByIdentity };
  }

  private findLocalProductMatch(
    item: IncomingProduct,
    lookups: {
      localByIdentity: Map<string, Product>;
    }
  ): Product | undefined {
    for (const candidate of productIdentityCandidates(item)) {
      if (candidate && lookups.localByIdentity.has(candidate)) {
        return lookups.localByIdentity.get(candidate);
      }
    }

    return undefined;
  }

  private normalizeSingleIncomingProduct(
    item: IncomingProduct,
    localProduct?: Product,
    context: NormalizationContext = { tariffs: [], warehouses: [] }
  ): IncomingProduct {
    const imageUrl = this.resolveRemoteImageUrl(item);
    const imageVersion = this.resolveRemoteImageVersion(item, imageUrl);
    const metadata = asObject(item.metadata);
    const incomingOperationalFlags = asObject(item.operationalFlags ?? item.operational_flags);
    const localOperationalFlags = asObject(localProduct?.operationalFlags);
    const recipeDetails = asArray(item.recipeDetails ?? item.recipe_details);
    const incomingWarehouseSettings = asObject(item.warehouseSettings);
    const metadataWarehouseSettings = asObject(metadata.warehouseSettings);
    const normalizedWarehouseSettings = canonicalizeWarehouseRecord(
      Object.keys(incomingWarehouseSettings).length > 0
        ? incomingWarehouseSettings
        : (Object.keys(metadataWarehouseSettings).length > 0
            ? metadataWarehouseSettings
            : (localProduct?.warehouseSettings || {})),
      context.warehouses || []
    );
    const incomingStockBalances = extractWarehouseStockBalances(
      item.stockBalances,
      item.stock_balances,
      item.stockBalancesByWarehouse,
      item.stock_balances_by_warehouse,
      item.warehouseStockBalances,
      item.warehouse_stock_balances,
    );
    const metadataStockBalances = extractWarehouseStockBalances(
      metadata.stockBalances,
      metadata.stock_balances,
      metadata.stockBalancesByWarehouse,
      metadata.stock_balances_by_warehouse,
      metadata.warehouseStockBalances,
      metadata.warehouse_stock_balances,
    );
    const normalizedStockBalances = canonicalizeWarehouseRecord(
      Object.keys(incomingStockBalances).length > 0
        ? incomingStockBalances
        : (Object.keys(metadataStockBalances).length > 0
            ? metadataStockBalances
            : (localProduct?.stockBalances || {})),
      context.warehouses || []
    );
    const incomingActiveWarehouseIds = Array.isArray(item.activeInWarehouses)
      ? item.activeInWarehouses
      : (Array.isArray(item.warehouse_ids)
          ? item.warehouse_ids
          : (Array.isArray(item.warehouseIds)
              ? item.warehouseIds
              : (Array.isArray(item.active_in_warehouses) ? item.active_in_warehouses : [])));
    const metadataActiveWarehouseIds = Array.isArray(metadata.activeInWarehouses)
      ? metadata.activeInWarehouses
      : (Array.isArray(metadata.warehouse_ids)
          ? metadata.warehouse_ids
          : (Array.isArray(metadata.warehouseIds)
              ? metadata.warehouseIds
              : (Array.isArray(metadata.active_in_warehouses) ? metadata.active_in_warehouses : [])));
    let derivedActiveWarehouseIds = incomingActiveWarehouseIds;
    if (derivedActiveWarehouseIds.length === 0) {
      derivedActiveWarehouseIds = metadataActiveWarehouseIds;
    }
    if (derivedActiveWarehouseIds.length === 0) {
      derivedActiveWarehouseIds = deriveWarehouseIdsFromSettings(normalizedWarehouseSettings);
    }
    if (derivedActiveWarehouseIds.length === 0) {
      derivedActiveWarehouseIds = deriveWarehouseIdsFromSettings(metadata.warehouseSettings);
    }
    if (derivedActiveWarehouseIds.length === 0) {
      derivedActiveWarehouseIds = deriveWarehouseIdsFromStockBalances(normalizedStockBalances);
    }
    if (derivedActiveWarehouseIds.length === 0) {
      derivedActiveWarehouseIds = deriveWarehouseIdsFromStockBalances(metadataStockBalances);
    }
    if (derivedActiveWarehouseIds.length === 0) {
      derivedActiveWarehouseIds = deriveWarehouseIdsFromSettings(localProduct?.warehouseSettings);
    }
    if (derivedActiveWarehouseIds.length === 0) {
      derivedActiveWarehouseIds = deriveWarehouseIdsFromStockBalances(localProduct?.stockBalances);
    }
    if (derivedActiveWarehouseIds.length === 0) {
      derivedActiveWarehouseIds = localProduct?.activeInWarehouses || [];
    }
    const rawKitInventoryMode = asString(item.kitInventoryMode ?? item.kit_inventory_mode).toUpperCase();
    const kitInventoryMode =
      rawKitInventoryMode === 'FINISHED_GOOD' || rawKitInventoryMode === 'COMPONENT_CONSUMPTION'
        ? rawKitInventoryMode
        : localProduct?.kitInventoryMode;

    const normalized: IncomingProduct = {
      ...item,
      name: asString(item.name) || asString(item.nombre) || localProduct?.name || '',
      price: asNumber(item.price ?? item.precio_venta, localProduct?.price ?? 0),
      cost: asNumber(item.cost ?? item.costo_unitario, localProduct?.cost ?? 0),
      category: asString(item.category) || asString(item.categoria) || localProduct?.category || 'GENERAL',
      image: localProduct?.image || undefined,
      imageUrl: localProduct?.imageUrl || undefined,
      imageVersion: localProduct?.imageVersion || undefined,
      imageLocalPath: localProduct?.imageLocalPath || null,
      images: uniqueStrings([
        ...(Array.isArray(localProduct?.images) ? localProduct.images : []),
        localProduct?.image,
      ]),
      attributes: Array.isArray(item.attributes) ? item.attributes : localProduct?.attributes || [],
      variants: Array.isArray(item.variants) ? item.variants : localProduct?.variants || [],
      tariffs: canonicalizeTariffEntries(
        normalizeTariffEntries(item.tariffs).length > 0
          ? normalizeTariffEntries(item.tariffs)
          : (normalizeTariffEntries(metadata.tariffs).length > 0 ? normalizeTariffEntries(metadata.tariffs) : localProduct?.tariffs || []),
        context.tariffs || []
      ),
      recipeDetails: recipeDetails.length > 0 ? recipeDetails : localProduct?.recipeDetails || [],
      appliedTaxIds: resolveIncomingTaxIds(item, localProduct),
      stockBalances: normalizedStockBalances,
      warehouseSettings: normalizedWarehouseSettings,
      activeInWarehouses: canonicalizeWarehouseIds(derivedActiveWarehouseIds, context.warehouses || []),
      isInventoriable: asBoolean(
        item.isInventoriable ?? item.is_inventoriable,
        localProduct?.isInventoriable ?? true,
      ),
      kitInventoryMode,
      batchYield: asNumber(item.batchYield ?? item.batch_yield, localProduct?.batchYield ?? 1),
      measurementUnit: asString(item.measurementUnit ?? item.measurement_unit) || localProduct?.measurementUnit || 'Unidad',
      purchaseUnit: asString(item.purchaseUnit ?? item.purchase_unit) || localProduct?.purchaseUnit || 'Unidad',
      conversionFactor: asNumber(item.conversionFactor ?? item.conversion_factor, localProduct?.conversionFactor ?? 1),
      operationalFlags: {
        isWeighted: asBoolean(incomingOperationalFlags.isWeighted, asBoolean(localOperationalFlags.isWeighted, false)),
        trackInventory: asBoolean(incomingOperationalFlags.trackInventory, asBoolean(localOperationalFlags.trackInventory, true)),
        autoPrintLabel: asBoolean(incomingOperationalFlags.autoPrintLabel, asBoolean(localOperationalFlags.autoPrintLabel, false)),
        promptPrice: asBoolean(incomingOperationalFlags.promptPrice, asBoolean(localOperationalFlags.promptPrice, false)),
        integersOnly: asBoolean(incomingOperationalFlags.integersOnly, asBoolean(localOperationalFlags.integersOnly, false)),
        ageRestricted: asBoolean(incomingOperationalFlags.ageRestricted, asBoolean(localOperationalFlags.ageRestricted, false)),
        allowNegativeStock: asBoolean(incomingOperationalFlags.allowNegativeStock, asBoolean(localOperationalFlags.allowNegativeStock, false)),
        excludeFromPromotions: asBoolean(incomingOperationalFlags.excludeFromPromotions, asBoolean(localOperationalFlags.excludeFromPromotions, false)),
        excludeFromLoyalty: asBoolean(incomingOperationalFlags.excludeFromLoyalty, asBoolean(localOperationalFlags.excludeFromLoyalty, false)),
        usesLots: asBoolean(incomingOperationalFlags.usesLots, asBoolean(localOperationalFlags.usesLots, false)),
        usesSerial: asBoolean(incomingOperationalFlags.usesSerial, asBoolean(localOperationalFlags.usesSerial, false)),
      },
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
        normalized.imageUrl = imageUrl;
        normalized.imageVersion = imageVersion;
        normalized.images = uniqueStrings([
          ...(Array.isArray(localProduct?.images) ? localProduct.images : []),
          localProduct?.image,
        ]);
      } else if (!this.isNativeAndroid()) {
        normalized.imageLocalPath = null;
        normalized.image = this.buildRenderableWebPath(imageUrl);
        normalized.images = uniqueStrings([normalized.image]);
        normalized.imageUrl = imageUrl;
        normalized.imageVersion = imageVersion;
      }
      return normalized;
    }

    return normalized;
  }

  private async getNormalizationContext(): Promise<NormalizationContext> {
    const [configRaw, warehousesRaw] = await Promise.all([
      db.get('config'),
      db.get('warehouses'),
    ]);

    const config = configRaw as unknown as BusinessConfig | null;
    const warehouses = warehousesRaw as unknown as Warehouse[] | null;

    return {
      tariffs: Array.isArray(config?.tariffs) ? config.tariffs : [],
      warehouses: Array.isArray(warehouses) ? warehouses : [],
    };
  }

  async normalizeIncomingProducts(items: IncomingProduct[]): Promise<IncomingProduct[]> {
    if (!Array.isArray(items) || items.length === 0) {
      return [];
    }

    const [lookups, context] = await Promise.all([
      this.getLocalProductLookups(),
      this.getNormalizationContext(),
    ]);
    return items.map((item) => this.normalizeSingleIncomingProduct(item, this.findLocalProductMatch(item, lookups), context));
  }

  private async saveLocalImage(product: Product, imageUrl: string, imageVersion: string): Promise<boolean> {
    const relativePath = this.buildRelativePath(product.id, imageVersion, imageUrl);

    try {
      await Filesystem.mkdir({
        path: this.imageFolder,
        directory: Directory.Data,
        recursive: true,
      });
    } catch (error) {
      const message = String((error as Error)?.message || error || '');
      const alreadyExists = /exist/i.test(message);
      if (!alreadyExists) {
        throw error;
      }
    }

    await Filesystem.downloadFile({
      url: imageUrl,
      path: relativePath,
      directory: Directory.Data,
      progress: false,
      recursive: true,
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
