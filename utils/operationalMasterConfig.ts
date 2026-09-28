import { buildMasterUrlCandidates, normalizeMasterHost } from './masterEndpointUrl';

export type OperationalMasterConfigSource = 'STORED' | 'CLOUD' | 'LAN';

export type OperationalMasterConfigCandidate = {
  host: string;
  source: OperationalMasterConfigSource;
};

export type OperationalMasterConfigResult<T> = {
  baseUrl: string;
  config: T;
  source: OperationalMasterConfigSource;
};

export type ClientMasterAuthority<T = Record<string, unknown>> =
  | ({ status: 'VALIDATED' } & OperationalMasterConfigResult<T>)
  | { status: 'UNAVAILABLE' };

export const unavailableClientMasterAuthority = (): ClientMasterAuthority<never> => ({
  status: 'UNAVAILABLE',
});

export async function runJournalGuardedMasterDiscovery<T>(
  assertJournalAllowsRemoteAuthority: () => void,
  discover: () => Promise<T>,
): Promise<T> {
  assertJournalAllowsRemoteAuthority();
  return discover();
}

type ResolveOperationalMasterConfigOptions<T> = {
  storedHosts: Array<string | null | undefined>;
  resolveCloudHost: () => Promise<string | null | undefined>;
  discoverLanHosts: () => Promise<Array<string | null | undefined>>;
  validate: (baseUrl: string, config: T) => void;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  rejectHosts?: string[];
  onCandidateFailure?: (candidate: OperationalMasterConfigCandidate, baseUrl: string, error: unknown) => void;
};

/**
 * Resolves a client Master without allowing one bad/stale candidate to abort
 * the remaining cloud/LAN fallbacks. Nothing is persisted by this helper;
 * callers may mirror only the validated result.
 */
export async function resolveOperationalMasterConfig<T = Record<string, unknown>>(
  options: ResolveOperationalMasterConfigOptions<T>,
): Promise<OperationalMasterConfigResult<T> | null> {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const candidates: OperationalMasterConfigCandidate[] = [];
  const attempted = new Set<string>();
  const rejectedHosts = new Set((options.rejectHosts || []).map(normalizeMasterHost).map(host => host.toLowerCase()).filter(Boolean));

  const isForbiddenHost = (host: string): boolean => {
    const normalized = normalizeMasterHost(host).toLowerCase();
    return !normalized
      || normalized === 'localhost'
      || normalized === '::1'
      || normalized === '[::1]'
      || normalized === '0.0.0.0'
      || normalized === '::'
      || /^127\./.test(normalized)
      || rejectedHosts.has(normalized);
  };

  const append = (values: Array<string | null | undefined>, source: OperationalMasterConfigSource) => {
    values.forEach((value) => {
      const host = normalizeMasterHost(value || '');
      if (host && !candidates.some(candidate => candidate.host === host)) candidates.push({ host, source });
    });
  };

  const tryPendingCandidates = async (): Promise<OperationalMasterConfigResult<T> | null> => {
    for (const candidate of candidates) {
      if (isForbiddenHost(candidate.host)) {
        options.onCandidateFailure?.(
          candidate,
          candidate.host,
          new Error('MASTER_SELF_ENDPOINT: candidate rejected before config fetch.'),
        );
        continue;
      }
      for (const baseUrl of buildMasterUrlCandidates(candidate.host)) {
        if (attempted.has(baseUrl)) continue;
        attempted.add(baseUrl);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetchImpl(`${baseUrl}/api/config`, { signal: controller.signal });
          if (!response.ok) throw new Error(`MASTER_CONFIG_HTTP_${response.status}`);
          const config = await response.json() as T;
          options.validate(baseUrl, config);
          return { baseUrl, config, source: candidate.source };
        } catch (error) {
          options.onCandidateFailure?.(candidate, baseUrl, error);
          // A self endpoint, transport/HTTP/JSON failure, or invalid contract is
          // candidate-local. Continue through the approved fallback order.
        } finally {
          clearTimeout(timeoutId);
        }
      }
    }
    return null;
  };

  append(options.storedHosts, 'STORED');
  let result = await tryPendingCandidates();
  if (result) return result;

  try {
    append([await options.resolveCloudHost()], 'CLOUD');
  } catch {
    // LAN discovery remains available when cloud registry is offline.
  }
  result = await tryPendingCandidates();
  if (result) return result;

  try {
    append(await options.discoverLanHosts(), 'LAN');
  } catch {
    return null;
  }
  return tryPendingCandidates();
}

export async function resolveClientMasterAuthority<T = Record<string, unknown>>(
  options: ResolveOperationalMasterConfigOptions<T>,
): Promise<ClientMasterAuthority<T>> {
  const result = await resolveOperationalMasterConfig(options);
  return result ? { status: 'VALIDATED', ...result } : { status: 'UNAVAILABLE' };
}

type ClientMasterStartupOptions<TConfig, TRefresh> = {
  hydrateLocalIps: () => Promise<string[]>;
  resolveAuthority: (localIps: string[]) => Promise<ClientMasterAuthority<TConfig>>;
  persistValidated: (authority: Extract<ClientMasterAuthority<TConfig>, { status: 'VALIDATED' }>) => void | Promise<void>;
  applyValidatedConfig: (config: TConfig) => Promise<TConfig>;
  initialize: (authority: ClientMasterAuthority<TConfig>, config: TConfig | null) => Promise<void>;
  refresh: (
    authority: Extract<ClientMasterAuthority<TConfig>, { status: 'VALIDATED' }>,
    config: TConfig,
  ) => Promise<TRefresh>;
  fallbackConfig: TConfig;
};

export type ClientMasterStartupResult<TConfig, TRefresh> = {
  authority: ClientMasterAuthority<TConfig>;
  config: TConfig;
  refresh: TRefresh | null;
  localIps: string[];
};

/**
 * Executes the real client startup barrier. A remote adapter can only be
 * initialized after local identity hydration, full validation, and atomic
 * persistence have all succeeded. UNAVAILABLE still initializes local state,
 * but never invokes the remote refresh callback.
 */
export async function runClientMasterStartup<TConfig, TRefresh>(
  options: ClientMasterStartupOptions<TConfig, TRefresh>,
): Promise<ClientMasterStartupResult<TConfig, TRefresh>> {
  const localIps = Array.from(new Set(
    (await options.hydrateLocalIps()).map(normalizeMasterHost).filter(Boolean),
  ));
  let authority: ClientMasterAuthority<TConfig> = { status: 'UNAVAILABLE' };
  let activeConfig = options.fallbackConfig;

  if (localIps.length > 0) {
    authority = await options.resolveAuthority(localIps);
  }

  if (authority.status === 'VALIDATED') {
    try {
      await options.persistValidated(authority);
      activeConfig = await options.applyValidatedConfig(authority.config);
    } catch (error) {
      authority = { status: 'UNAVAILABLE' };
      await options.initialize(authority, activeConfig);
      throw error;
    }
  }

  await options.initialize(authority, activeConfig);
  if (authority.status === 'UNAVAILABLE') {
    return { authority, config: activeConfig, refresh: null, localIps };
  }

  const refreshed = await options.refresh(authority, activeConfig);
  return { authority, config: activeConfig, refresh: refreshed, localIps };
}
