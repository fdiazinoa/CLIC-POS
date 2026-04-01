import { db } from './db';

export const POS_CATALOG_DEBUG_TAG = '[POS-CFG-74000171]';
export const POS_CATALOG_DEBUG_BARCODE = '74000171';
export const POS_CATALOG_DEBUG_LOCAL_ID = 'prod-171';
export const POS_IMAGE_DEBUG_TAG = '[POS-IMG-CATALOG]';

const POS_IMAGE_DEBUG_PRODUCTS = [
  {
    barcode: '74000171',
    localId: 'prod-171',
    nameIncludes: 'baguette',
  },
  {
    barcode: '74000170',
    localId: 'prod-170',
    nameIncludes: 'pan sobao',
  },
];

const asStr = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : value != null ? String(value).trim() : '';

const emitNativeLog = (stage: string, payload?: Record<string, unknown>) => {
  try {
    const runtimeWindow = window as any;
    const bridge = runtimeWindow?.AndroidPrinter;
    if (!bridge || typeof bridge.debugLog !== 'function') return;
    bridge.debugLog(JSON.stringify({
      tag: 'ClicPOSDebug',
      message: `${POS_CATALOG_DEBUG_TAG} ${stage}`,
      data: payload || null,
    }));
  } catch {
    // Ignore native logging errors outside Android runtime.
  }
};

const emitNativeLogWithPrefix = (prefix: string, stage: string, payload?: Record<string, unknown>) => {
  try {
    const runtimeWindow = window as any;
    const bridge = runtimeWindow?.AndroidPrinter;
    if (!bridge || typeof bridge.debugLog !== 'function') return;
    bridge.debugLog(JSON.stringify({
      tag: 'ClicPOSDebug',
      message: `${prefix} ${stage}`,
      data: payload || null,
    }));
  } catch {
    // Ignore native logging errors outside Android runtime.
  }
};

export const posCatalogDebugCodeCandidates = (item: Record<string, unknown> | null | undefined): string[] => {
  if (!item || typeof item !== 'object') return [];
  return Array.from(new Set([
    asStr(item.id),
    asStr(item.sku),
    asStr(item.item_code),
    asStr(item.code),
    asStr(item.barcode),
  ].filter(Boolean)));
};

export const posCatalogDebugMatchesRaw = (item: unknown): boolean => {
  if (!item || typeof item !== 'object') return false;
  const record = item as Record<string, unknown>;
  const codes = posCatalogDebugCodeCandidates(record);
  return (
    codes.includes(POS_CATALOG_DEBUG_LOCAL_ID) ||
    codes.includes(POS_CATALOG_DEBUG_BARCODE) ||
    asStr(record.name).toLowerCase().includes('baguette')
  );
};

export const posImageDebugMatchesRaw = (item: unknown): boolean => {
  if (!item || typeof item !== 'object') return false;
  const record = item as Record<string, unknown>;
  const codes = posCatalogDebugCodeCandidates(record);
  const normalizedName = asStr(record.name).toLowerCase();

  return POS_IMAGE_DEBUG_PRODUCTS.some((product) =>
    codes.includes(product.localId) ||
    codes.includes(product.barcode) ||
    normalizedName.includes(product.nameIncludes)
  );
};

export const posCatalogDebugSummarizeItem = (item: Record<string, unknown> | null | undefined) => {
  if (!item || typeof item !== 'object') return null;
  return {
    id: asStr(item.id),
    name: asStr(item.name),
    description: asStr(item.description),
    sku: asStr(item.sku),
    item_code: asStr(item.item_code),
    code: asStr(item.code),
    barcode: asStr(item.barcode),
    image: asStr(item.image).slice(0, 96),
    imageUrl: asStr(item.imageUrl || item.image_url || (item.metadata as any)?.image_url).slice(0, 96),
    imageLocalPath: asStr(item.imageLocalPath).slice(0, 96),
  };
};

export const posCatalogDebugLog = (stage: string, payload?: Record<string, unknown>): void => {
  emitNativeLog(stage, payload);
  if (payload && Object.keys(payload).length > 0) {
    console.info(POS_CATALOG_DEBUG_TAG, stage, payload);
  } else {
    console.info(POS_CATALOG_DEBUG_TAG, stage);
  }
};

export const posImageDebugLog = (stage: string, payload?: Record<string, unknown>): void => {
  emitNativeLogWithPrefix(POS_IMAGE_DEBUG_TAG, stage, payload);
  if (payload && Object.keys(payload).length > 0) {
    console.info(POS_IMAGE_DEBUG_TAG, stage, payload);
  } else {
    console.info(POS_IMAGE_DEBUG_TAG, stage);
  }
};

export const posCatalogDebugNow = (): number => {
  try {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
  } catch {
    // ignore
  }

  return Date.now();
};

export const posCatalogDebugElapsedMs = (startedAt: number): number => {
  const elapsed = posCatalogDebugNow() - startedAt;
  return Number.isFinite(elapsed) ? Math.round(elapsed) : 0;
};

export async function posCatalogDebugLogDbRows(reason: string): Promise<void> {
  try {
    const products = (await db.get('products')) as Record<string, unknown>[];
    if (!Array.isArray(products)) {
      posCatalogDebugLog('DB scan failed', { reason, error: 'products not array' });
      return;
    }

    const rows = products
      .filter((product) => posCatalogDebugMatchesRaw(product))
      .map((product) => posCatalogDebugSummarizeItem(product))
      .filter(Boolean);

    posCatalogDebugLog('DB rows', {
      reason,
      count: rows.length,
      totalProducts: products.length,
      rows,
    });
  } catch (error) {
    posCatalogDebugLog('DB scan exception', {
      reason,
      error: String((error as Error)?.message || error),
    });
  }
}
