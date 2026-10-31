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
  SYNC_V3_CART_LEGACY_LINE:
    'Este ticket tiene líneas creadas antes de la autorización de venta actual. Reábrelo desde el mapa de mesas.',
  SYNC_V3_RETAINED_TAX_CLASSIFICATION_CHANGED:
    'Los impuestos de un artículo del ticket cambiaron en el maestro. Revisa el ticket antes de emitir.',
  SYNC_V3_RETAINED_OWNER_REQUIRED:
    'Falta la evidencia autorizada del catálogo original del ticket. Avisa a soporte para recuperar esa evidencia antes de continuar.',
  SYNC_V3_ARTICLE_SOURCE_CHANGED:
    'El artículo cambió en el maestro autorizado y el ticket conserva una copia anterior. Vuelve a agregar ese artículo para cobrarlo con el catálogo de hoy.',
  SYNC_V3_BINDING_CHANGED:
    'La terminal cambió de vinculación. Reinicia el POS para recargar la autorización.',
  SYNC_V3_BASELINE_MIGRATION_REQUIRED:
    'El maestro del ERP cambió y esta caja necesita un inventario base nuevo, pero ya registró ventas con el anterior. No se puede cobrar hasta migrar el inventario. Las devoluciones deben conservar la foto de la factura original y requieren su evidencia y autorización fiscal. Avisa a soporte.',
  SYNC_V3_INVENTORY_COVERAGE_REQUIRED:
    'Esta caja ya registró movimientos de inventario y no puede adoptar un inventario base nuevo. Avisa a soporte para migrar el inventario de la caja.',
  SYNC_V3_CATALOG_SEMANTICS_CHANGED:
    'El ERP cambió impuestos, tarifas o unidades de artículos que esta caja ya vendió, así que su inventario base quedó desalineado. Avisa a soporte antes de volver a cobrar.',
  SYNC_V3_STOCK_AUTHORITY_INVALID:
    'El inventario de esta caja ya no coincide con el maestro autorizado. Sincroniza en Ajustes → Sincronización; si el problema sigue, avisa a soporte.',
  SYNC_V3_RUNTIME_VERSION_CHANGED:
    'El catálogo se actualizó mientras se procesaba la operación. Inténtalo de nuevo.',
  SYNC_V3_REFUND_ORIGINAL_CHANGED:
    'La factura que intentas acreditar cambió o ya no está como estaba. Abre el ticket de nuevo y repite la devolución.',
  SYNC_V3_REFUND_ORIGINAL_NOT_REFUNDABLE:
    'Este documento no admite devolución: ya fue acreditado por completo o no es una venta.',
  SYNC_V3_FROZEN_FISCAL_SOURCE_CHANGED:
    'Los importes fiscales del ticket no coinciden con la foto autorizada. Revisa el estado del documento en el historial antes de reintentar; si persiste, avisa a soporte.',
  SYNC_V3_DUPLICATE_TRANSACTION_MISMATCH:
    'La operación no coincide con otra ya registrada. Actualiza el historial y revisa el estado de la devolución antes de reintentar.',
  SYNC_V3_CONFIG_REQUIRED:
    'La configuración de la caja no está disponible. Reconecta y vuelve a sincronizar.',
  SYNC_V3_CART_MIXED_VERSION:
    'El ticket mezcla inventarios de distintas fechas y no se puede procesar así. Reábrelo desde el historial; si persiste, avisa a soporte.',
};

export const describeV3Error = (error: unknown): string => {
  const raw = String((error as { message?: unknown })?.message ?? error ?? '').trim();
  if (!raw) return 'No se pudo completar la operación.';
  const code = raw.split(':')[0].trim().toUpperCase();
  return V3_ERROR_MESSAGES[code] || raw;
};
