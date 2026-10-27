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
