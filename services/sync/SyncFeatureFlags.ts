export type SyncFeatureFlagName =
    | 'adaptive_polling'
    | 'sync_hint_v2'
    | 'heartbeat_v2'
    | 'private_realtime';

const DEFAULTS: Record<SyncFeatureFlagName, boolean> = {
    adaptive_polling: true,
    sync_hint_v2: true,
    heartbeat_v2: true,
    // Requires matching Supabase channel authorization before rollout.
    private_realtime: false,
};

const ENV_KEYS: Record<SyncFeatureFlagName, string> = {
    adaptive_polling: 'VITE_ADAPTIVE_POLLING_ENABLED',
    sync_hint_v2: 'VITE_SYNC_HINT_V2_ENABLED',
    heartbeat_v2: 'VITE_HEARTBEAT_V2_ENABLED',
    private_realtime: 'VITE_PRIVATE_REALTIME_ENABLED',
};

const LOCAL_PREFIX = 'clic_pos_feature_';

const parseBoolean = (value: unknown): boolean | null => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    return null;
};

export const isSyncFeatureEnabled = (name: SyncFeatureFlagName): boolean => {
    const localValue = typeof localStorage !== 'undefined'
        ? parseBoolean(localStorage.getItem(`${LOCAL_PREFIX}${name}`))
        : null;
    if (localValue !== null) return localValue;

    const env = (import.meta as any)?.env || {};
    const envValue = parseBoolean(env[ENV_KEYS[name]]);
    if (name === 'private_realtime') {
        return envValue ?? parseBoolean(env.VITE_SYNC_PRIVATE_REALTIME_ENABLED) ?? DEFAULTS[name];
    }
    return envValue ?? DEFAULTS[name];
};

export const setLocalSyncFeatureOverride = (name: SyncFeatureFlagName, enabled: boolean | null): void => {
    if (typeof localStorage === 'undefined') return;
    const key = `${LOCAL_PREFIX}${name}`;
    if (enabled === null) {
        localStorage.removeItem(key);
        return;
    }
    localStorage.setItem(key, String(enabled));
};
