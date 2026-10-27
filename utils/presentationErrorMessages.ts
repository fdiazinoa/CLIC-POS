/**
 * The presentations feature fails with protocol codes. A cashier needs to know what to do,
 * and the code must stay visible for support, so the raw value is never hidden.
 */
const HINTS: Record<string, string> = {
  INVENTORY_PRESENTATION_SCOPE_CHANGED:
    'El almacén, la tarifa o las categorías de venta de esta caja no coinciden con la configuración del ERP. Sincroniza la configuración de la terminal y vuelve a intentar.',
  INVENTORY_PRESENTATION_CONTEXT_CHANGED:
    'La configuración de la caja cambió mientras se descargaban las presentaciones. Reintenta.',
  INVENTORY_PRESENTATION_CACHE_REQUIRED:
    'Esta caja no tiene las presentaciones descargadas. Conéctala y pulsa Reintentar.',
  INVENTORY_PRESENTATION_ERP_DENIED:
    'El ERP tiene las presentaciones deshabilitadas para esta caja. Habilítalas o sincroniza la configuración.',
  INVENTORY_PRESENTATION_AUTH_REQUIRED:
    'La caja no tiene una sesión autorizada vigente. Renueva la sesión desde Diagnóstico fiscal.',
  INVENTORY_PRESENTATION_AUTH_CHANGED:
    'La autorización de la caja cambió durante la descarga. Reintenta.',
  INVENTORY_PRESENTATION_NATIVE_REQUIRED:
    'El almacenamiento de presentaciones no está disponible en este equipo. Reinstala el APK.',
  INVENTORY_PRESENTATION_LOCAL_REQUIRED:
    'La caja no tiene el identificador local del almacén de venta. Sincroniza la configuración de la terminal.',
  INVENTORY_PRESENTATION_MASTER_REQUIRED:
    'La presentación del artículo no está descargada en esta caja. Reintenta con conexión.',
  INVENTORY_PRESENTATION_TARIFF_FORBIDDEN:
    'La tarifa del artículo no está habilitada para esta caja. Revisa las tarifas permitidas en el ERP.',
};

export const describePresentationError = (error: unknown): string => {
  const raw = String((error as { message?: unknown })?.message ?? error ?? '').trim();
  if (!raw) return 'Las presentaciones no están disponibles en esta caja.';
  const candidates = raw.split(/[^A-Za-z0-9_]+/).map(part => part.trim().toUpperCase()).filter(Boolean);
  const code = candidates.find(part => /^INVENTORY_PRESENTATION_[A-Z0-9_]+$/.test(part)) || candidates[0] || '';
  if (HINTS[code]) return HINTS[code];
  if (/^INVENTORY_PRESENTATION_HTTP_5/.test(code)) return 'El ERP no respondió a tiempo. Reintenta en unos segundos.';
  if (/^INVENTORY_PRESENTATION_HTTP_/.test(code)) return 'El ERP rechazó la descarga de presentaciones. Reintenta y revisa la habilitación de la caja.';
  return raw;
};
