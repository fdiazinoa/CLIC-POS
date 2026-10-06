import { extractErpRegisterAuth, resolveNormalizedRegisterDeviceToken } from './erpRegisterResponse';

/** The bind response is credential authority; candidate downloads are never fallback sources. */
export const resolveSetupRegisterCredentials = (
  candidate: boolean, authoritative: unknown, ...legacyFallbacks: unknown[]
) => {
  const sources = candidate ? [authoritative] : [authoritative, ...legacyFallbacks];
  const registerAuth = extractErpRegisterAuth(...sources);
  const normalizedDeviceToken = resolveNormalizedRegisterDeviceToken(...sources, registerAuth);
  if (candidate && !normalizedDeviceToken && !registerAuth.syncToken) {
    throw new Error('DEVICE_TOKEN_MISSING_FROM_REGISTER');
  }
  return { registerAuth, normalizedDeviceToken };
};

/** App accepts only the explicit credential fields forwarded by the binding selector. */
export const forwardedSetupCredentialSource = (value: Record<string, unknown>) => ({
  deviceToken: value.deviceToken, terminalToken: value.terminalToken,
  activationToken: value.activationToken, syncToken: value.syncToken, tokenExpiresAt: value.tokenExpiresAt,
});

const credentialKeys = new Set(['deviceToken', 'device_token', 'terminalToken', 'terminal_token',
  'activationToken', 'activation_token', 'syncToken', 'sync_token', 'syncAuthToken', 'sync_auth_token',
  'tokenExpiresAt', 'token_expires_at', 'tokenSource', 'tokenUpdatedAt',
  'X-Device-Token', 'x-device-token', 'X-Sync-Token', 'x-sync-token', 'Authorization', 'authorization']);
const containers = new Set(['config', 'metadata', 'auth', 'syncAuth', 'sync_auth', 'syncHeaders', 'sync_headers',
  'terminal', 'terminal_config', 'erpSnapshot', 'resolved', 'business_config', 'businessConfig', 'session']);

/** Copy recognized POS auth/config containers; fiscal/provider integration secrets remain untouched. */
export const isolateCandidateSetupConfig = <T>(value: T): T => {
  const visit = (current: unknown): unknown => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return current;
    return Object.fromEntries(Object.entries(current).filter(([key]) => !credentialKeys.has(key)).map(([key, child]) => {
      if (containers.has(key)) return [key, visit(child)];
      if (key === 'terminals' && Array.isArray(child)) return [key, child.map(visit)];
      if (['terminalSnapshots', 'terminal_snapshots'].includes(key) && child && typeof child === 'object') {
        return [key, Object.fromEntries(Object.entries(child).map(([id, snapshot]) => [id, visit(snapshot)]))];
      }
      return [key, child];
    }));
  };
  return visit(value) as T;
};
