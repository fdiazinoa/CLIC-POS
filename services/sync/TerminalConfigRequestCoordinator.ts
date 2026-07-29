export type TerminalConfigSyncReason =
  | 'startup'
  | 'pairing'
  | 'config_push'
  | 'connection_restored'
  | 'manual_sync'
  | 'safety_check';

export interface TerminalConfigCacheEntry {
  configVersion: string | null;
  etag: string | null;
  lastValidAt: string | null;
  lastCheckedAt: string | null;
}

export interface TerminalConfigRequestResult<T> {
  status: 'applied' | 'unchanged';
  payload?: T;
  configVersion: string | null;
  etag: string | null;
  durationMs: number;
  approximateBytes: number;
}

type RequestInput<T> = {
  baseUrl: string;
  terminalId: string;
  tenantId?: string | null;
  deviceId?: string | null;
  reason: TerminalConfigSyncReason;
  apply?: (payload: T) => Promise<void>;
  deferPersistence?: boolean;
  signal?: AbortSignal;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const CACHE_PREFIX = 'clic_pos_terminal_config_cache:';
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 300_000];
const NON_RETRYABLE_STATUS = new Set([400, 401, 403, 404]);

const trimTrailingSlashes = (value: string) => value.replace(/\/+$/, '');
const normalize = (value: unknown): string | null => {
  const result = String(value ?? '').trim();
  return result || null;
};

const anonymize = (value: string): string => {
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
};

const jitter = (delayMs: number): number => {
  const spread = delayMs * 0.2;
  return Math.max(0, Math.round(delayMs - spread + Math.random() * spread * 2));
};

const parseRetryAfterMs = (response: Response): number | null => {
  const value = response.headers.get('Retry-After');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : null;
};

const wait = (delayMs: number, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(new DOMException('Aborted', 'AbortError'));
    return;
  }
  const timeoutId = globalThis.setTimeout(resolve, delayMs);
  signal?.addEventListener('abort', () => {
    globalThis.clearTimeout(timeoutId);
    reject(new DOMException('Aborted', 'AbortError'));
  }, { once: true });
});

export class TerminalConfigRequestCoordinator {
  private readonly inFlight = new Map<string, Promise<TerminalConfigRequestResult<any>>>();
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    private readonly storage: StorageLike = globalThis.localStorage,
    private readonly fetcher: typeof fetch = globalThis.fetch,
    private readonly retryDelaysMs: number[] = RETRY_DELAYS_MS,
    private readonly sleeper: (delayMs: number, signal?: AbortSignal) => Promise<void> = wait,
  ) {}

  readCache(terminalId: string): TerminalConfigCacheEntry {
    try {
      const raw = this.storage.getItem(`${CACHE_PREFIX}${terminalId}`);
      if (!raw) {
        return { configVersion: null, etag: null, lastValidAt: null, lastCheckedAt: null };
      }
      const parsed = JSON.parse(raw);
      return {
        configVersion: normalize(parsed?.configVersion),
        etag: normalize(parsed?.etag),
        lastValidAt: normalize(parsed?.lastValidAt),
        lastCheckedAt: normalize(parsed?.lastCheckedAt),
      };
    } catch {
      return { configVersion: null, etag: null, lastValidAt: null, lastCheckedAt: null };
    }
  }

  clear(terminalId?: string): void {
    if (terminalId) {
      this.controllers.get(terminalId)?.abort();
      this.controllers.delete(terminalId);
      this.storage.removeItem(`${CACHE_PREFIX}${terminalId}`);
      return;
    }
    this.controllers.forEach((controller) => controller.abort());
    this.controllers.clear();
  }

  cancel(terminalId?: string): void {
    if (terminalId) {
      this.controllers.get(terminalId)?.abort();
      this.controllers.delete(terminalId);
      return;
    }
    this.controllers.forEach((controller) => controller.abort());
    this.controllers.clear();
  }

  commitApplied(
    terminalId: string,
    metadata: { configVersion?: string | null; etag?: string | null },
  ): void {
    const now = new Date().toISOString();
    this.writeCache(terminalId, {
      configVersion: normalize(metadata.configVersion),
      etag: normalize(metadata.etag),
      lastValidAt: now,
      lastCheckedAt: now,
    });
  }

  request<T>(input: RequestInput<T>): Promise<TerminalConfigRequestResult<T>> {
    const existing = this.inFlight.get(input.terminalId);
    if (existing) {
      console.info('[CONFIG_SYNC]', {
        terminal: anonymize(input.terminalId),
        reason: input.reason,
        result: 'skipped_in_flight',
      });
      return existing as Promise<TerminalConfigRequestResult<T>>;
    }

    const controller = new AbortController();
    this.controllers.set(input.terminalId, controller);
    const abortFromCaller = () => controller.abort();
    input.signal?.addEventListener('abort', abortFromCaller, { once: true });

    const operation = this.execute<T>(input, controller.signal)
      .finally(() => {
        input.signal?.removeEventListener('abort', abortFromCaller);
        if (this.controllers.get(input.terminalId) === controller) {
          this.controllers.delete(input.terminalId);
        }
        this.inFlight.delete(input.terminalId);
      });
    this.inFlight.set(input.terminalId, operation);
    return operation;
  }

  private async execute<T>(
    input: RequestInput<T>,
    signal: AbortSignal,
  ): Promise<TerminalConfigRequestResult<T>> {
    let attempt = 0;
    while (true) {
      const startedAt = Date.now();
      const cache = this.readCache(input.terminalId);
      const params = new URLSearchParams();
      if (input.tenantId) params.set('tenant_id', input.tenantId);
      if (input.deviceId) params.set('device_id', input.deviceId);
      if (cache.configVersion) params.set('current_version', cache.configVersion);
      const endpoint = `${trimTrailingSlashes(input.baseUrl)}/api/setup/initial-config/${encodeURIComponent(input.terminalId)}${params.size ? `?${params}` : ''}`;
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (cache.etag) headers['If-None-Match'] = cache.etag;
      if (input.deviceId) {
        headers['X-Device-Id'] = input.deviceId;
        headers['X-POS-Device-Id'] = input.deviceId;
      }

      try {
        const response = await this.fetcher(endpoint, { method: 'GET', headers, signal });
        const durationMs = Date.now() - startedAt;
        if (response.status === 304) {
          this.writeCache(input.terminalId, {
            ...cache,
            lastCheckedAt: new Date().toISOString(),
          });
          this.log(input, response.status, cache.configVersion, cache.configVersion, durationMs, 'unchanged', 0);
          return {
            status: 'unchanged',
            configVersion: cache.configVersion,
            etag: cache.etag,
            durationMs,
            approximateBytes: 0,
          };
        }

        if (!response.ok) {
          const error = new Error(`Terminal config request failed (${response.status})`) as Error & {
            status?: number;
            retryAfterMs?: number | null;
          };
          error.status = response.status;
          error.retryAfterMs = parseRetryAfterMs(response);
          throw error;
        }

        const text = await response.text();
        const payload = JSON.parse(text) as T;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          throw new Error('Invalid initial-config payload');
        }
        await input.apply?.(payload);

        const configVersion = normalize(
          response.headers.get('X-Config-Version')
          || (payload as any).config_version
          || (payload as any).configVersion,
        );
        const etag = normalize(response.headers.get('ETag'));
        const now = new Date().toISOString();
        if (!input.deferPersistence) {
          this.writeCache(input.terminalId, {
            configVersion,
            etag,
            lastValidAt: now,
            lastCheckedAt: now,
          });
        }
        this.log(input, response.status, cache.configVersion, configVersion, durationMs, 'applied', text.length);
        return {
          status: 'applied',
          payload,
          configVersion,
          etag,
          durationMs,
          approximateBytes: text.length,
        };
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') throw error;
        const status = Number((error as any)?.status || 0);
        const retryable = !status || (!NON_RETRYABLE_STATUS.has(status) && (status === 408 || status === 429 || status >= 500));
        if (!retryable || attempt >= this.retryDelaysMs.length) {
          this.log(input, status, cache.configVersion, null, Date.now() - startedAt, 'failed', 0);
          throw error;
        }
        const retryDelay = Number((error as any)?.retryAfterMs) || jitter(this.retryDelaysMs[attempt]);
        console.warn('[CONFIG_SYNC]', {
          terminal: anonymize(input.terminalId),
          reason: input.reason,
          result: 'failed',
          httpStatus: status || null,
          nextRetryMs: retryDelay,
        });
        attempt += 1;
        await this.sleeper(Math.min(retryDelay, 300_000), signal);
      }
    }
  }

  private writeCache(terminalId: string, entry: TerminalConfigCacheEntry): void {
    this.storage.setItem(`${CACHE_PREFIX}${terminalId}`, JSON.stringify(entry));
  }

  private log(
    input: RequestInput<unknown>,
    httpStatus: number,
    previousVersion: string | null,
    nextVersion: string | null,
    durationMs: number,
    result: 'applied' | 'unchanged' | 'failed',
    approximateBytes: number,
  ): void {
    console.info('[CONFIG_SYNC]', {
      terminal: anonymize(input.terminalId),
      device: input.deviceId ? anonymize(input.deviceId) : null,
      reason: input.reason,
      httpStatus,
      previousVersion,
      nextVersion,
      durationMs,
      result,
      approximateBytes,
    });
  }
}

export const terminalConfigRequestCoordinator = new TerminalConfigRequestCoordinator();
