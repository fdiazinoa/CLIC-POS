import type { BusinessConfig, User } from '../../types';

export const MASTER_PAIRING_CONFIG_TIMEOUT_MS = 12_000;
export const MASTER_PAIRING_USERS_TIMEOUT_MS = 6_000;
export const MASTER_PAIRING_STARTUP_WINDOW_MS = 30_000;
export const MASTER_PAIRING_INITIAL_RETRY_MS = 750;
export const MASTER_PAIRING_MAX_RETRY_MS = 3_000;

export type MasterPairingFailureCode =
  | 'CONFIG_HTTP_ERROR'
  | 'CONFIG_INVALID_JSON'
  | 'CONFIG_NETWORK_ERROR'
  | 'CONFIG_TIMEOUT';

export class MasterPairingConnectionError extends Error {
  constructor(
    public readonly code: MasterPairingFailureCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'MasterPairingConnectionError';
  }
}

type FetchLike = typeof fetch;

interface MasterPairingStartupRetryOptions {
  maxWaitMs?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
  onRetry?: (state: { attempt: number; elapsedMs: number; nextDelayMs: number; error: unknown }) => void;
}

const fetchWithTimeout = async (
  url: string,
  timeoutMs: number,
  fetchImpl: FetchLike,
): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
};

const readConfig = async (baseUrl: string, fetchImpl: FetchLike): Promise<BusinessConfig> => {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${baseUrl}/api/config`,
      MASTER_PAIRING_CONFIG_TIMEOUT_MS,
      fetchImpl,
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new MasterPairingConnectionError(
        'CONFIG_TIMEOUT',
        `La Maestra no respondió dentro de ${MASTER_PAIRING_CONFIG_TIMEOUT_MS / 1000} segundos.`,
        { cause: error },
      );
    }
    throw new MasterPairingConnectionError(
      'CONFIG_NETWORK_ERROR',
      'No fue posible alcanzar el servicio de configuración de la Maestra.',
      { cause: error },
    );
  }

  if (!response.ok) {
    throw new MasterPairingConnectionError(
      'CONFIG_HTTP_ERROR',
      `El servicio de configuración de la Maestra respondió ${response.status}.`,
    );
  }

  try {
    return await response.json() as BusinessConfig;
  } catch (error) {
    throw new MasterPairingConnectionError(
      'CONFIG_INVALID_JSON',
      'La Maestra devolvió una configuración inválida.',
      { cause: error },
    );
  }
};

const readOptionalUsers = async (baseUrl: string, fetchImpl: FetchLike): Promise<User[] | null> => {
  try {
    const response = await fetchWithTimeout(
      `${baseUrl}/api/users`,
      MASTER_PAIRING_USERS_TIMEOUT_MS,
      fetchImpl,
    );
    if (!response.ok) return null;
    const payload = await response.json();
    return Array.isArray(payload) ? payload as User[] : null;
  } catch {
    // El roster se refresca después mediante sync. Su indisponibilidad no debe
    // hacer que una Master operativa aparezca como desconectada.
    return null;
  }
};

export const fetchMasterPairingResources = async (
  baseUrl: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ config: BusinessConfig; users: User[] | null }> => {
  const usersPromise = readOptionalUsers(baseUrl, fetchImpl);
  const config = await readConfig(baseUrl, fetchImpl);
  const users = await usersPromise;
  return { config, users };
};

const isRetryableStartupError = (error: unknown): boolean => {
  if (!(error instanceof MasterPairingConnectionError)) return false;
  if (error.code === 'CONFIG_NETWORK_ERROR' || error.code === 'CONFIG_TIMEOUT') return true;
  if (error.code !== 'CONFIG_HTTP_ERROR') return false;
  const status = Number(error.message.match(/\b(\d{3})\b/)?.[1]);
  return Number.isFinite(status) && status >= 500;
};

export const waitForMasterPairingResources = async (
  baseUrl: string,
  fetchImpl: FetchLike = fetch,
  options: MasterPairingStartupRetryOptions = {},
): Promise<{ config: BusinessConfig; users: User[] | null }> => {
  const maxWaitMs = Math.max(0, options.maxWaitMs ?? MASTER_PAIRING_STARTUP_WINDOW_MS);
  const maxDelayMs = Math.max(1, options.maxDelayMs ?? MASTER_PAIRING_MAX_RETRY_MS);
  let nextDelayMs = Math.min(
    maxDelayMs,
    Math.max(1, options.initialDelayMs ?? MASTER_PAIRING_INITIAL_RETRY_MS),
  );
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((delayMs: number) => new Promise<void>(resolve => {
    globalThis.setTimeout(resolve, delayMs);
  }));
  const startedAt = now();
  let attempt = 0;

  while (true) {
    attempt += 1;
    try {
      return await fetchMasterPairingResources(baseUrl, fetchImpl);
    } catch (error) {
      const elapsedMs = Math.max(0, now() - startedAt);
      const remainingMs = maxWaitMs - elapsedMs;
      if (!isRetryableStartupError(error) || remainingMs <= 0) throw error;

      const delayMs = Math.min(nextDelayMs, remainingMs);
      options.onRetry?.({ attempt, elapsedMs, nextDelayMs: delayMs, error });
      await sleep(delayMs);
      nextDelayMs = Math.min(maxDelayMs, Math.ceil(nextDelayMs * 1.7));
    }
  }
};
