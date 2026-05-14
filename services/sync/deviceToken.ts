export const SYNC_DEVICE_TOKEN_KEY = 'CLIC_POS_DEVICE_TOKEN';

const LEGACY_SYNC_DEVICE_TOKEN_KEYS = ['POS_DEVICE_TOKEN', 'pos_device_token'] as const;

interface SyncDeviceTokenResolution {
    token: string | null;
    sourceKey: string | null;
    migratedFrom: string | null;
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
    const token = String(value || '').trim();
    return token || null;
};

export const resolveSyncDeviceToken = (): SyncDeviceTokenResolution => {
    const storage = getStorage();
    if (!storage) {
        return { token: null, sourceKey: null, migratedFrom: null };
    }

    const primaryToken = cleanToken(storage.getItem(SYNC_DEVICE_TOKEN_KEY));
    if (primaryToken) {
        return { token: primaryToken, sourceKey: SYNC_DEVICE_TOKEN_KEY, migratedFrom: null };
    }

    for (const key of LEGACY_SYNC_DEVICE_TOKEN_KEYS) {
        const legacyToken = cleanToken(storage.getItem(key));
        if (!legacyToken) continue;

        storage.setItem(SYNC_DEVICE_TOKEN_KEY, legacyToken);
        return { token: legacyToken, sourceKey: SYNC_DEVICE_TOKEN_KEY, migratedFrom: key };
    }

    return { token: null, sourceKey: null, migratedFrom: null };
};

export const getSyncDeviceToken = (): string | null => resolveSyncDeviceToken().token;

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

    return {
        token,
        created: true,
        migratedFrom: null
    };
};
