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

type ResolveOperationalMasterConfigOptions<T> = {
  storedHosts: Array<string | null | undefined>;
  resolveCloudHost: () => Promise<string | null | undefined>;
  discoverLanHosts: () => Promise<Array<string | null | undefined>>;
  validate: (baseUrl: string, config: T) => void;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
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
  const timeoutMs = options.timeoutMs ?? 3000;
  const candidates: OperationalMasterConfigCandidate[] = [];
  const attempted = new Set<string>();

  const append = (values: Array<string | null | undefined>, source: OperationalMasterConfigSource) => {
    values.forEach((value) => {
      const host = normalizeMasterHost(value || '');
      if (host && !candidates.some(candidate => candidate.host === host)) candidates.push({ host, source });
    });
  };

  const tryPendingCandidates = async (): Promise<OperationalMasterConfigResult<T> | null> => {
    for (const candidate of candidates) {
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
