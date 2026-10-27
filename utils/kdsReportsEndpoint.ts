/**
 * Where the KDS service listens, resolved the same way the kitchen screen resolves it.
 *
 * The reports view used to hardcode port 8001 while `KitchenDisplay` honoured the paired
 * port, so a kitchen running on another port showed the live tickets and empty reports.
 */

const DEFAULT_KDS_PORT = '8001';
const PORT_PATTERN = /^\d{2,5}$/;

export const readStoredKdsPort = (): string | null => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem('CLIC_POS_KDS_PORT') || window.localStorage.getItem('KDS_PORT');
  } catch {
    return null;
  }
};

export const resolveKdsReportsPort = (input?: {
  search?: string;
  storedPort?: string | null;
}): string => {
  const search = input?.search ?? (typeof window !== 'undefined' ? String(window.location?.search || '') : '');
  let fromParams = '';
  try {
    fromParams = String(new URLSearchParams(search).get('kdsPort') || '').trim();
  } catch {
    fromParams = '';
  }
  const stored = String(input?.storedPort ?? readStoredKdsPort() ?? '').trim();
  const candidate = fromParams || stored || DEFAULT_KDS_PORT;
  return PORT_PATTERN.test(candidate) ? candidate : DEFAULT_KDS_PORT;
};

export const resolveKdsReportsBaseUrl = (input?: {
  override?: string;
  hostname?: string;
  search?: string;
  storedPort?: string | null;
}): string => {
  const explicit = String(input?.override || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const hostname = String(
    input?.hostname ?? (typeof window !== 'undefined' ? window.location?.hostname : '') ?? '',
  ).trim();
  const host = !hostname || hostname === '0.0.0.0' ? 'localhost' : hostname;
  return `http://${host}:${resolveKdsReportsPort({ search: input?.search, storedPort: input?.storedPort })}`;
};

export interface KdsAreaEndpoint {
  kds_host?: unknown;
  kds_port?: unknown;
  modo_salida?: unknown;
  mode?: unknown;
}

/**
 * The kitchen may run on another device: if a production area declares its KDS host,
 * the reports must go there instead of the terminal's own host.
 */
export const resolveKdsReportsBaseUrlForAreas = (areas: readonly KdsAreaEndpoint[] | null | undefined): string | null => {
  const usable = (areas || [])
    .map((area) => ({
      host: String(area?.kds_host ?? '').trim(),
      port: String(area?.kds_port ?? '').trim(),
      mode: String(area?.modo_salida ?? area?.mode ?? '').trim().toUpperCase(),
    }))
    .filter((area) => area.host.length > 0);
  if (!usable.length) return null;
  // A real kitchen output wins over an area that only prints.
  const chosen = usable.find((area) => area.mode === 'KDS' || area.mode === 'AMBOS') || usable[0];
  if (/^https?:\/\//i.test(chosen.host)) return chosen.host.replace(/\/+$/, '');
  const host = chosen.host.replace(/\/+$/, '');
  const port = PORT_PATTERN.test(chosen.port) ? chosen.port : DEFAULT_KDS_PORT;
  return `http://${host}${/:\d+$/.test(host) ? '' : `:${port}`}`;
};
