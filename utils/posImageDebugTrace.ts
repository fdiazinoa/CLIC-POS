/**
 * Trazas acotadas para diagnosticar imágenes de catálogo (APK / SQLite).
 * Filtrar logcat: adb logcat | grep POS-IMG-74000171
 */
import { db } from './db';

export const POS_IMAGE_DEBUG_TAG = '[POS-IMG-74000171]';
export const POS_IMAGE_DEBUG_BARCODE = '74000171';
export const POS_IMAGE_DEBUG_LOCAL_ID = 'prod-171';

const asStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : v != null ? String(v).trim() : '');

/** Candidatos de código de barras / SKU en payload ERP o POS. */
export function posImageDebugIncomingCodes(item: Record<string, unknown> | null | undefined): string[] {
  if (!item || typeof item !== 'object') return [];
  const anyItem = item as Record<string, unknown>;
  const fromArr = Array.isArray(anyItem.barcodes)
    ? (anyItem.barcodes as unknown[]).map((b) => asStr(b)).filter(Boolean)
    : [];
  const single = [
    asStr(anyItem.barcode),
    asStr(anyItem.codigo_barras),
    asStr(anyItem.codigoBarras),
    asStr(anyItem.sku),
    asStr(anyItem.item_code),
    asStr(anyItem.code),
    ...fromArr,
  ].filter(Boolean);
  return [...new Set(single)];
}

export function posImageDebugMatchesRaw(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false;
  const o = item as Record<string, unknown>;
  const id = asStr(o.id);
  const codes = posImageDebugIncomingCodes(o);
  return (
    id === POS_IMAGE_DEBUG_LOCAL_ID ||
    codes.includes(POS_IMAGE_DEBUG_BARCODE) ||
    id.endsWith('-171') ||
    id === '171'
  );
}

export function posImageDebugLog(stage: string, payload?: Record<string, unknown>): void {
  if (payload && Object.keys(payload).length > 0) {
    console.info(POS_IMAGE_DEBUG_TAG, stage, payload);
  } else {
    console.info(POS_IMAGE_DEBUG_TAG, stage);
  }
}

/** Resumen de filas en BD que pueden corresponder al artículo de prueba. */
export async function posImageDebugLogDbRows(reason: string): Promise<void> {
  try {
    const products = (await db.get('products')) as Record<string, unknown>[];
    if (!Array.isArray(products)) {
      console.info(POS_IMAGE_DEBUG_TAG, 'DB scan', { reason, error: 'products not an array' });
      return;
    }
    const matches = products.filter((p) => {
      const id = asStr(p?.id);
      const bc = asStr(p?.barcode);
      const codes = [bc, ...posImageDebugIncomingCodes(p)];
      return (
        id === POS_IMAGE_DEBUG_LOCAL_ID ||
        codes.includes(POS_IMAGE_DEBUG_BARCODE) ||
        id.endsWith('-171')
      );
    });
    const summaries = matches.map((p) => ({
      id: asStr(p?.id),
      barcode: asStr(p?.barcode),
      name: asStr(p?.name)?.slice(0, 40),
      image: typeof p?.image === 'string' ? `${p.image.slice(0, 72)}${(p.image as string).length > 72 ? '…' : ''}` : p?.image,
      imageUrl: p?.imageUrl,
      imageVersion: p?.imageVersion,
      imageLocalPath:
        typeof p?.imageLocalPath === 'string'
          ? `${(p.imageLocalPath as string).slice(0, 72)}${(p.imageLocalPath as string).length > 72 ? '…' : ''}`
          : p?.imageLocalPath,
    }));
    console.info(POS_IMAGE_DEBUG_TAG, 'DB rows (candidates)', { reason, count: matches.length, totalProducts: products.length, rows: summaries });
  } catch (e) {
    console.warn(POS_IMAGE_DEBUG_TAG, 'DB scan failed', { reason, e });
  }
}
