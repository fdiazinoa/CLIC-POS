const TERMINAL_SETUP_MODE_KEY = 'clic_pos_terminal_setup_mode';
const MASTER_URL_KEY = 'CLIC_POS_MASTER_URL';
const MASTER_IP_KEY = 'pos_master_ip';

type StorageReader = Pick<Storage, 'getItem'>;

const getStorage = (): StorageReader | null => {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
};

const normalizeBaseUrl = (value: string | null): string => {
  const normalized = String(value || '').trim().replace(/\/+$/, '');
  if (!normalized) return '';

  try {
    const parsed = new URL(/^https?:\/\//i.test(normalized) ? normalized : `http://${normalized}`);
    const host = parsed.hostname;
    const isPrivateLanHost =
      host === 'localhost'
      || host === '127.0.0.1'
      || /^10\./.test(host)
      || /^192\.168\./.test(host)
      || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
    const protocol = isPrivateLanHost ? 'http:' : parsed.protocol;
    const port = parsed.port || '3001';
    return `${protocol}//${host}:${port}${parsed.pathname.replace(/\/api$/i, '').replace(/\/+$/, '')}`;
  } catch {
    const hostWithPort = normalized.includes(':') ? normalized : `${normalized}:3001`;
    return `http://${hostWithPort}`.replace(/\/api$/i, '');
  }
};

export const isClientTerminalMode = (storage: StorageReader | null = getStorage()): boolean => {
  if (!storage) return false;

  const setupMode = storage.getItem(TERMINAL_SETUP_MODE_KEY);
  if (setupMode === 'CLIENT') return true;
  if (setupMode === 'SERVER_LOCAL' || setupMode === 'SERVER_ERP' || setupMode === 'SERVER') {
    return false;
  }

  return Boolean(String(storage.getItem(MASTER_IP_KEY) || '').trim());
};

export const canUseLocalOperationalTableStore = (
  storage: StorageReader | null = getStorage()
): boolean => !isClientTerminalMode(storage);

export const resolveMasterOperationalBaseUrl = (
  storage: StorageReader | null = getStorage()
): string => {
  if (!isClientTerminalMode(storage) || !storage) return '';

  const storedMasterUrl = normalizeBaseUrl(storage.getItem(MASTER_URL_KEY));
  if (storedMasterUrl) return storedMasterUrl;

  return normalizeBaseUrl(storage.getItem(MASTER_IP_KEY));
};

export const resolveOperationalApiUrl = (
  path: string,
  storage: StorageReader | null = getStorage()
): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const masterBaseUrl = resolveMasterOperationalBaseUrl(storage);
  return masterBaseUrl ? `${masterBaseUrl}${normalizedPath}` : normalizedPath;
};
