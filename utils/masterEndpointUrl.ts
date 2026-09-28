const clean = (value?: string | null) => typeof value === 'string' ? value.trim() : '';

export const normalizeMasterHost = (value?: string | null) => {
  const trimmed = clean(value);
  if (!trimmed) return '';
  try {
    const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
    return parsed.hostname || trimmed.replace(/^https?:\/\//i, '').replace(/:\d+$/, '');
  } catch {
    return trimmed.replace(/^https?:\/\//i, '').replace(/:\d+$/, '');
  }
};

const isLoopback = (host: string) => host === 'localhost' || host === '127.0.0.1';
const isLan = (host: string) => isLoopback(host)
  || /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)
  || /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host);

export const buildMasterUrlFromHost = (host?: string | null, port = 3001, preferredProtocol?: string | null) => {
  const normalizedHost = normalizeMasterHost(host);
  if (!normalizedHost) return '';
  const protocol = isLan(normalizedHost)
    ? 'http'
    : (clean(preferredProtocol).replace(/:$/, '')
      || (typeof window !== 'undefined' ? clean(window.location.protocol).replace(/:$/, '') : '')
      || 'http');
  return `${protocol}://${normalizedHost}:${port}`;
};

export const buildMasterUrlCandidates = (host?: string | null, port = 3001) => {
  const normalizedHost = normalizeMasterHost(host);
  if (!normalizedHost) return [];
  const candidates = [buildMasterUrlFromHost(normalizedHost, port)];
  if (typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '') && isLoopback(normalizedHost)) {
    candidates.push(buildMasterUrlFromHost('10.0.3.2', port, 'http'), buildMasterUrlFromHost('10.0.2.2', port, 'http'));
  }
  return Array.from(new Set(candidates.filter(Boolean)));
};
