export type ProductionOutputMode = 'KDS' | 'PRINTER' | 'AMBOS';

const normalizeModeToken = (value: unknown): string => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, '_');

export const normalizeProductionOutputMode = (value: unknown): ProductionOutputMode => {
  const normalized = normalizeModeToken(value);
  if (
    normalized === 'AMBOS'
    || normalized === 'BOTH'
    || normalized === 'KDS_PRINTER'
    || normalized === 'PRINTER_KDS'
    || normalized === 'PANTALLA_IMPRESORA'
    || normalized === 'PANTALLA_E_IMPRESORA'
    || normalized === 'MONITOR_TICKET'
  ) return 'AMBOS';
  if (normalized === 'PRINTER' || normalized === 'TICKET' || normalized === 'IMPRESORA') return 'PRINTER';
  return 'KDS';
};

export const resolveProductionOutputTargets = (value: unknown) => {
  const mode = normalizeProductionOutputMode(value);
  return {
    mode,
    shouldPrint: mode === 'PRINTER' || mode === 'AMBOS',
    shouldSendKds: mode === 'KDS' || mode === 'AMBOS',
  };
};
