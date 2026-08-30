export type TerminalAuthorizationBlock = {
  terminalId?: string | null;
  terminalLabel: string;
  message: string;
};

export const TERMINAL_AUTHORIZATION_BLOCK_STORAGE_KEY = 'clic_terminal_authorization_block';

type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem' | 'removeItem'>;

const normalizeIdentity = (value: unknown): string => String(value || '').trim().toUpperCase();

const asRecord = (value: unknown): Record<string, any> => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {}
);

const getStorage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

export const readPersistedTerminalAuthorizationBlock = (
  storage: StorageReader | null = getStorage(),
): TerminalAuthorizationBlock | null => {
  if (!storage) return null;

  try {
    const parsed = asRecord(JSON.parse(storage.getItem(TERMINAL_AUTHORIZATION_BLOCK_STORAGE_KEY) || 'null'));
    const terminalLabel = String(parsed.terminalLabel || '').trim();
    const message = String(parsed.message || '').trim();
    if (!terminalLabel || !message) return null;
    return {
      terminalId: String(parsed.terminalId || '').trim() || null,
      terminalLabel,
      message,
    };
  } catch {
    return null;
  }
};

export const persistTerminalAuthorizationBlock = (
  block: TerminalAuthorizationBlock,
  storage: StorageWriter | null = getStorage(),
): void => {
  if (!storage) return;
  storage.setItem(TERMINAL_AUTHORIZATION_BLOCK_STORAGE_KEY, JSON.stringify({
    terminalId: String(block.terminalId || '').trim() || null,
    terminalLabel: String(block.terminalLabel || '').trim() || 'Caja vinculada',
    message: String(block.message || '').trim(),
  }));
};

export const clearPersistedTerminalAuthorizationBlock = (
  storage: StorageWriter | null = getStorage(),
): void => {
  storage?.removeItem(TERMINAL_AUTHORIZATION_BLOCK_STORAGE_KEY);
};

export const isTerminalAuthorizationSuperseded = (
  storage: StorageReader | null = getStorage(),
): boolean => {
  if (!storage) return false;
  const lastAuthError = normalizeIdentity(storage.getItem('clic_sync_last_auth_error'));
  return lastAuthError === 'DEVICE_SUPERSEDED'
    || Boolean(readPersistedTerminalAuthorizationBlock(storage));
};

export const isDeviceExplicitlyAuthorizedByBootstrap = (
  bootstrap: unknown,
  requestedDeviceId: string,
): boolean => {
  const payload = asRecord(bootstrap);
  const terminal = asRecord(
    payload.terminal
    || asRecord(payload.terminal_config).terminal
    || asRecord(payload.terminalConfig).terminal,
  );
  const config = asRecord(terminal.config || asRecord(payload.terminal_config).config || asRecord(payload.terminalConfig).config);
  const profile = asRecord(payload.profile || payload.terminal_profile || payload.terminalProfile);
  const metadata = asRecord(terminal.metadata || config.metadata || payload.metadata);
  const auth = asRecord(payload.authorization || payload.auth || terminal.authorization || terminal.auth);
  const normalizedRequestedDeviceId = normalizeIdentity(requestedDeviceId);
  if (!normalizedRequestedDeviceId) return false;

  const explicitAuthorizationValues = [
    payload.device_authorized,
    payload.deviceAuthorized,
    auth.device_authorized,
    auth.deviceAuthorized,
  ].filter((value) => typeof value === 'boolean') as boolean[];
  if (explicitAuthorizationValues.includes(false)) return false;

  const statusText = [
    payload.status,
    payload.authorization_status,
    payload.authorizationStatus,
    payload.device_status,
    payload.deviceStatus,
    terminal.status,
    terminal.authorization_status,
    terminal.authorizationStatus,
    config.status,
    config.authorization_status,
    profile.status,
    auth.status,
    auth.authorization_status,
  ].map(normalizeIdentity).filter(Boolean).join('|');

  const revoked = Boolean(
    payload.revoked
    || payload.is_revoked
    || payload.isRevoked
    || payload.requires_reauth
    || payload.requiresReauth
    || payload.reauth_required
    || payload.reauthRequired
    || terminal.revoked
    || terminal.is_revoked
    || terminal.isRevoked
    || terminal.requires_reauth
    || terminal.requiresReauth
    || config.revoked
    || config.is_revoked
    || config.requires_reauth
    || metadata.revoked
    || metadata.is_revoked
    || metadata.requires_reauth
    || auth.revoked
    || auth.requires_reauth
    || /REVOKED|SUPERSEDED|DEVICE_NOT_AUTHORIZED|TAKEOVER_REQUIRED|WAITING_CLOUD_ADMIN_REAUTHORIZATION|NEEDS_REAUTH|LOCKED_AUTH_REQUIRED/.test(statusText)
  );
  if (revoked) return false;

  // Top-level `device_id` is intentionally excluded: bootstrap APIs commonly
  // echo the requesting device there, which is not proof of authorization.
  const authoritativeDeviceIds = [
    payload.authorized_device_id,
    payload.authorizedDeviceId,
    payload.current_device_id,
    payload.currentDeviceId,
    payload.canonical_device_id,
    payload.canonicalDeviceId,
    terminal.authorized_device_id,
    terminal.authorizedDeviceId,
    terminal.current_device_id,
    terminal.currentDeviceId,
    terminal.canonical_device_id,
    terminal.canonicalDeviceId,
    terminal.device_id,
    terminal.deviceId,
    config.authorized_device_id,
    config.authorizedDeviceId,
    config.current_device_id,
    config.currentDeviceId,
    config.canonical_device_id,
    config.canonicalDeviceId,
    profile.authorized_device_id,
    profile.authorizedDeviceId,
    profile.current_device_id,
    profile.currentDeviceId,
    profile.canonical_device_id,
    profile.canonicalDeviceId,
    metadata.authorized_device_id,
    metadata.authorizedDeviceId,
    metadata.bound_device_id,
    metadata.boundDeviceId,
    metadata.canonical_device_id,
    metadata.canonicalDeviceId,
    auth.authorized_device_id,
    auth.authorizedDeviceId,
    auth.current_device_id,
    auth.currentDeviceId,
    auth.canonical_device_id,
    auth.canonicalDeviceId,
  ].map(normalizeIdentity).filter(Boolean);

  return authoritativeDeviceIds.includes(normalizedRequestedDeviceId);
};
