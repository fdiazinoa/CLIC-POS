/**
 * V3 rejects with stable codes; the raw code in a toast is unactionable for the cashier.
 * Unknown codes keep the original text so new failures are never hidden.
 */
const V3_ERROR_MESSAGES: Record<string, string> = {
  SYNC_V3_WAREHOUSE_UNAVAILABLE:
    'Este artículo no está activo en el almacén de esta caja. Actívalo en el ERP o cambia el almacén de la terminal.',
  SYNC_V3_STOCK_INSUFFICIENT:
    'No hay existencia suficiente en el almacén de esta caja para este artículo.',
  SYNC_V3_ARTICLE_UNAVAILABLE:
    'El artículo ya no está disponible en el maestro autorizado. Actualiza el catálogo.',
  SYNC_V3_OPERATIONAL_WINDOW_HELD:
    'El catálogo se está actualizando. Intenta de nuevo en unos segundos.',
  SYNC_V3_OFFLINE_CACHED_RUNTIME_REQUIRED:
    'La caja no tiene un catálogo autorizado. Reconecta y vuelve a sincronizar.',
  SYNC_V3_BINDING_CHANGED:
    'La terminal cambió de vinculación. Reinicia el POS para recargar la autorización.',
};

export const describeV3Error = (error: unknown): string => {
  const raw = String((error as { message?: unknown })?.message ?? error ?? '').trim();
  if (!raw) return 'No se pudo completar la operación.';
  const code = raw.split(':')[0].trim().toUpperCase();
  return V3_ERROR_MESSAGES[code] || raw;
};
