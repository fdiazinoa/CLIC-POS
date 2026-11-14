/**
 * Marcas de reservas diferidas del APK. La reserva elige el NCF sin escribir recibo ni
 * mover el puntero; el commit de la venta escribe ambos. Solo los NCF marcados en esta
 * sesión se liquidan fiscalmente al commit: importaciones y documentos históricos nunca
 * reciben efectos fiscales por accidente.
 */
const deferred = new Set<string>();

export const markDeferredFiscalReservation = (ncf: string): void => {
  if (ncf) deferred.add(ncf);
};

export const isDeferredFiscalReservation = (ncf: string): boolean => deferred.has(ncf);

export const clearDeferredFiscalReservation = (ncf: string): void => {
  if (ncf) deferred.delete(ncf);
};
