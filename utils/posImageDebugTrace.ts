/**
 * Trazas acotadas para diagnosticar imágenes de catálogo en Android.
 * Filtrar logcat: adb logcat | grep POS-IMG-74000171
 */
import { db } from './db';

export const POS_IMAGE_DEBUG_TAG = '[POS-IMG-74000171]';
export const POS_IMAGE_DEBUG_BARCODE = '74000171';
export const POS_IMAGE_DEBUG_LOCAL_ID = 'prod-171';

const asStr = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : value != null ? String(value).trim() : '';

const emitNativeLog = (stage: string, payload?: Record<string, unknown>) => {
  try {
    const runtimeWindow = window as any;
    const bridge = runtimeWindow?.AndroidPrinter;
    if (!bridge || typeof bridge.debugLog !== 'function') return;
    bridge.debugLog(JSON.stringify({
      tag: 'ClicPOSDebug',
      message: `${POS_IMAGE_DEBUG_TAG} ${stage}`,
      data: payload || null,
    }));
  } catch {
    // Ignore native logging errors in web/runtime without bridge.
  }
};

export function posImageDebugIncomingCodes(item: Record<string, unknown> | null | undefined): string[] {
  if (!item || typeof item !== 'object') return [];
  const fromArr = Array.isArray(item.barcodes)
    ? (item.barcodes as unknown[]).map((entry) => asStr(entry)).filter(Boolean)
    : [];
  const single = [
    asStr(item.barcode),
    asStr(item.codigo_barras),
    asStr(item.codigoBarras),
    asStr(item.sku),
    asStr(item.item_code),
    asStr(item.code),
    ...fromArr,
  ].filter(Boolean);
  return [...new Set(single)];
}

export function posImageDebugMatchesRaw(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false;
  const data = item as Record<string, unknown>;
  const id = asStr(data.id);
  const codes = posImageDebugIncomingCodes(data);
  return (
    id === POS_IMAGE_DEBUG_LOCAL_ID ||
    codes.includes(POS_IMAGE_DEBUG_BARCODE) ||
    id.endsWith('-171') ||
    id === '171'
  );
}

export function posImageDebugLog(stage: string, payload?: Record<string, unknown>): void {
  emitNativeLog(stage, payload);
  if (payload && Object.keys(payload).length > 0) {
    console.info(POS_IMAGE_DEBUG_TAG, stage, payload);
  } else {
    console.info(POS_IMAGE_DEBUG_TAG, stage);
  }
}

export async function posImageDebugLogDbRows(reason: string): Promise<void> {
  try {
    const products = (await db.get('products')) as Record<string, unknown>[];
    if (!Array.isArray(products)) {
      console.info(POS_IMAGE_DEBUG_TAG, 'DB scan', { reason, error: 'products not an array' });
      return;
    }

    const matches = products.filter((product) => {
      const id = asStr(product?.id);
      const barcode = asStr(product?.barcode);
      const codes = [barcode, ...posImageDebugIncomingCodes(product)];
      return (
        id === POS_IMAGE_DEBUG_LOCAL_ID ||
        codes.includes(POS_IMAGE_DEBUG_BARCODE) ||
        id.endsWith('-171')
      );
    });

    const summaries = matches.map((product) => ({
      id: asStr(product?.id),
      barcode: asStr(product?.barcode),
      name: asStr(product?.name).slice(0, 40),
      image:
        typeof product?.image === 'string'
          ? `${product.image.slice(0, 72)}${(product.image as string).length > 72 ? '…' : ''}`
          : product?.image,
      imageUrl: product?.imageUrl,
      imageVersion: product?.imageVersion,
      imageLocalPath:
        typeof product?.imageLocalPath === 'string'
          ? `${(product.imageLocalPath as string).slice(0, 72)}${(product.imageLocalPath as string).length > 72 ? '…' : ''}`
          : product?.imageLocalPath,
    }));

    console.info(POS_IMAGE_DEBUG_TAG, 'DB rows (candidates)', {
      reason,
      count: matches.length,
      totalProducts: products.length,
      rows: summaries,
    });
    emitNativeLog('DB rows (candidates)', {
      reason,
      count: matches.length,
      totalProducts: products.length,
      rows: summaries,
    });
  } catch (error) {
    console.warn(POS_IMAGE_DEBUG_TAG, 'DB scan failed', { reason, error });
    emitNativeLog('DB scan failed', {
      reason,
      error: String((error as Error)?.message || error),
    });
  }
}
