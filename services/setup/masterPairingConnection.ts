import type { BusinessConfig, User } from '../../types';

export const MASTER_PAIRING_CONFIG_TIMEOUT_MS = 12_000;
export const MASTER_PAIRING_USERS_TIMEOUT_MS = 6_000;

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
