export const SYNC_DEVICE_TOKEN_KEY = 'CLIC_POS_DEVICE_TOKEN';

const SYNC_DEVICE_TOKEN_SOURCE_KEY = 'CLIC_POS_DEVICE_TOKEN_SOURCE';
const SYNC_DEVICE_TOKEN_UPDATED_AT_KEY = 'CLIC_POS_DEVICE_TOKEN_UPDATED_AT';
const SYNC_DEVICE_TOKEN_EXPIRES_AT_KEY = 'CLIC_POS_DEVICE_TOKEN_EXPIRES_AT';
const LEGACY_SYNC_DEVICE_TOKEN_KEYS = [
    'POS_DEVICE_TOKEN',
    'pos_device_token',
    'clic_erp_device_token',
    'terminalToken',
    'activationToken',
] as const;

interface SyncDeviceTokenResolution {
    token: string | null;
    sourceKey: string | null;
    migratedFrom: string | null;
    updatedAt?: string | null;
    expiresAt?: string | null;
}

interface EnsureSyncDeviceTokenResult {
    token: string;
    created: boolean;
    migratedFrom: string | null;
}

const getStorage = (): Storage | null => {
    try {
        if (typeof localStorage === 'undefined') return null;
        return localStorage;
    } catch {
        return null;
    }
};

const cleanToken = (value: string | null): string | null => {
    const token = String(value || '').replace(/[\r\n\t]/g, '').trim();
    if (!token) return null;
    if (['undefined', 'null', 'nan', '[object object]'].includes(token.toLowerCase())) return null;
    return token || null;
};

export const resolveSyncDeviceToken = (): SyncDeviceTokenResolution => {
    const storage = getStorage();
    if (!storage) {
        return { token: null, sourceKey: null, migratedFrom: null };
    }

    const primaryToken = cleanToken(storage.getItem(SYNC_DEVICE_TOKEN_KEY));
    if (primaryToken) {
        return {
            token: primaryToken,
            sourceKey: storage.getItem(SYNC_DEVICE_TOKEN_SOURCE_KEY) || SYNC_DEVICE_TOKEN_KEY,
            migratedFrom: null,
            updatedAt: storage.getItem(SYNC_DEVICE_TOKEN_UPDATED_AT_KEY),
            expiresAt: storage.getItem(SYNC_DEVICE_TOKEN_EXPIRES_AT_KEY),
        };
    }

    for (const key of LEGACY_SYNC_DEVICE_TOKEN_KEYS) {
        const legacyToken = cleanToken(storage.getItem(key));
        if (!legacyToken) continue;

        storage.setItem(SYNC_DEVICE_TOKEN_KEY, legacyToken);
        storage.setItem(SYNC_DEVICE_TOKEN_SOURCE_KEY, key);
        storage.setItem(SYNC_DEVICE_TOKEN_UPDATED_AT_KEY, new Date().toISOString());
        return {
            token: legacyToken,
            sourceKey: key,
            migratedFrom: key,
            updatedAt: storage.getItem(SYNC_DEVICE_TOKEN_UPDATED_AT_KEY),
            expiresAt: storage.getItem(SYNC_DEVICE_TOKEN_EXPIRES_AT_KEY),
        };
    }

    return { token: null, sourceKey: null, migratedFrom: null };
};

export const getSyncDeviceToken = (): string | null => resolveSyncDeviceToken().token;

export const persistSyncDeviceToken = (
    token: string | null | undefined,
    sourceKey = 'ERP_REGISTER',
    expiresAt?: string | null
): boolean => {
    const cleaned = cleanToken(token || null);
    const storage = getStorage();
    if (!cleaned || !storage) return false;

    storage.setItem(SYNC_DEVICE_TOKEN_KEY, cleaned);
    storage.setItem(SYNC_DEVICE_TOKEN_SOURCE_KEY, sourceKey);
    storage.setItem(SYNC_DEVICE_TOKEN_UPDATED_AT_KEY, new Date().toISOString());
    if (expiresAt && String(expiresAt).trim()) {
        storage.setItem(SYNC_DEVICE_TOKEN_EXPIRES_AT_KEY, String(expiresAt).trim());
    }
    return true;
};

export const previewSyncDeviceToken = (token?: string | null): string | null => {
    const cleaned = cleanToken(token || null);
    if (!cleaned) return null;
    if (cleaned.length <= 10) return `${cleaned.slice(0, 2)}...${cleaned.slice(-2)}`;
    return `${cleaned.slice(0, 6)}...${cleaned.slice(-4)}`;
};

export const ensureSyncDeviceToken = (createToken: () => string): EnsureSyncDeviceTokenResult => {
    const existing = resolveSyncDeviceToken();
    if (existing.token) {
        return {
            token: existing.token,
            created: false,
            migratedFrom: existing.migratedFrom
        };
    }

    const token = cleanToken(createToken());
    if (!token) {
        throw new Error('Unable to create sync device token');
    }

    const storage = getStorage();
    storage?.setItem(SYNC_DEVICE_TOKEN_KEY, token);
    storage?.setItem(SYNC_DEVICE_TOKEN_SOURCE_KEY, 'LOCAL_GENERATED');
    storage?.setItem(SYNC_DEVICE_TOKEN_UPDATED_AT_KEY, new Date().toISOString());

    return {
        token,
        created: true,
        migratedFrom: null
    };
};
