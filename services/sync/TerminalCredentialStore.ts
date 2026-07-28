import { Preferences } from '@capacitor/preferences';

export interface TerminalCredentials {
    terminalId?: string | null;
    erpTerminalId?: string | null;
    terminalCode?: string | null;
    terminalName?: string | null;
    deviceId?: string | null;
    tenantId?: string | null;
    erpTenantId?: string | null;
    cloudAdminTenantId?: string | null;
    deviceToken?: string | null;
    deviceTokenSource?: string | null;
    deviceTokenUpdatedAt?: string | null;
    deviceTokenExpiresAt?: string | null;
    syncToken?: string | null;
    syncTokenExpiresAt?: string | null;
    syncTokenUpdatedAt?: string | null;
    authStatus?: string | null;
    lastAuthError?: string | null;
    lastReauthAttemptAt?: string | null;
}

const CREDENTIALS_KEY = 'clic_terminal_credentials_v1';

const getStorage = (): Storage | null => {
    try {
        if (typeof localStorage === 'undefined') return null;
        return localStorage;
    } catch {
        return null;
    }
};

const cleanToken = (value?: string | null): string | null => {
    const normalized = String(value || '').replace(/[\r\n\t]/g, '').trim();
    if (!normalized) return null;
    if (['undefined', 'null', 'nan', '[object object]'].includes(normalized.toLowerCase())) return null;
    return normalized;
};

const cleanString = (value?: string | null): string | null => {
    const normalized = String(value || '').trim();
    if (!normalized) return null;
    if (['undefined', 'null', 'nan', '[object object]'].includes(normalized.toLowerCase())) return null;
    return normalized;
};

const readJson = (value: string | null): TerminalCredentials => {
    if (!value) return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
};

const compactCredentials = (credentials: TerminalCredentials): TerminalCredentials => {
    const compacted: TerminalCredentials = {};
    Object.entries(credentials).forEach(([key, value]) => {
        if (value !== undefined && value !== null && String(value).trim() !== '') {
            (compacted as Record<string, unknown>)[key] = value;
        }
    });
    return compacted;
};

const buildFromLegacyKeys = (storage: Storage): TerminalCredentials => compactCredentials({
    terminalId: cleanString(storage.getItem('clic_erp_sync_terminal_id') || storage.getItem('CLIC_POS_TERMINAL_ID') || storage.getItem('active_terminal_id')),
    erpTerminalId: cleanString(storage.getItem('clic_erp_sync_terminal_id') || storage.getItem('CLIC_POS_TERMINAL_ID') || storage.getItem('active_terminal_id')),
    terminalCode: cleanString(storage.getItem('clic_erp_sync_terminal_code')),
    terminalName: cleanString(storage.getItem('clic_erp_sync_terminal_name')),
    deviceId: cleanString(storage.getItem('CLIC_POS_DEVICE_ID') || storage.getItem('pos_device_id') || storage.getItem('clic_pos_device_id')),
    tenantId: cleanString(storage.getItem('clic_erp_sync_tenant_id') || storage.getItem('active_tenant_id') || storage.getItem('clic_tenant_id')),
    erpTenantId: cleanString(storage.getItem('clic_erp_sync_tenant_id') || storage.getItem('active_tenant_id')),
    cloudAdminTenantId: cleanString(storage.getItem('cloud_admin_tenant_id') || storage.getItem('clic_cloud_admin_tenant_id') || storage.getItem('clic_tenant_id')),
    deviceToken: cleanToken(storage.getItem('CLIC_POS_DEVICE_TOKEN') || storage.getItem('POS_DEVICE_TOKEN') || storage.getItem('pos_device_token') || storage.getItem('clic_erp_device_token') || storage.getItem('terminalToken') || storage.getItem('activationToken')),
    deviceTokenSource: cleanString(storage.getItem('CLIC_POS_DEVICE_TOKEN_SOURCE')),
    deviceTokenUpdatedAt: cleanString(storage.getItem('CLIC_POS_DEVICE_TOKEN_UPDATED_AT')),
    deviceTokenExpiresAt: cleanString(storage.getItem('CLIC_POS_DEVICE_TOKEN_EXPIRES_AT')),
    syncToken: cleanToken(storage.getItem('clic_erp_sync_token') || storage.getItem('clic_erp_sync_auth_token') || storage.getItem('CLIC_ERP_SYNC_TOKEN') || storage.getItem('syncAuthToken') || storage.getItem('sync_auth_token') || storage.getItem('erp_sync_token')),
    syncTokenExpiresAt: cleanString(storage.getItem('clic_erp_sync_token_expires_at')),
    syncTokenUpdatedAt: cleanString(storage.getItem('clic_erp_sync_token_updated_at')),
    authStatus: cleanString(storage.getItem('clic_sync_auth_status')),
    lastAuthError: cleanString(storage.getItem('clic_sync_last_auth_error')),
    lastReauthAttemptAt: cleanString(storage.getItem('clic_sync_last_reauth_attempt_at')),
});

const mergeCredentials = (...entries: TerminalCredentials[]): TerminalCredentials => {
    const merged: TerminalCredentials = {};
    for (const entry of entries) {
        Object.entries(entry || {}).forEach(([key, value]) => {
            if (value === null || (value !== undefined && String(value).trim() !== '')) {
                (merged as Record<string, unknown>)[key] = value;
            }
        });
    }
    return merged;
};

const writeLegacyMirrors = (credentials: TerminalCredentials): void => {
    const storage = getStorage();
    if (!storage) return;
    try {
        if (credentials.terminalId) {
            storage.setItem('clic_erp_sync_terminal_id', credentials.terminalId);
        }
        if (credentials.erpTerminalId) {
            storage.setItem('clic_erp_sync_terminal_id', credentials.erpTerminalId);
        }
        if (credentials.terminalCode) {
            storage.setItem('clic_erp_sync_terminal_code', credentials.terminalCode);
        }
        if (credentials.terminalName) {
            storage.setItem('clic_erp_sync_terminal_name', credentials.terminalName);
        }
        if (credentials.deviceId) {
            storage.setItem('CLIC_POS_DEVICE_ID', credentials.deviceId);
        }
        if (credentials.tenantId || credentials.erpTenantId) {
            const tenantId = credentials.erpTenantId || credentials.tenantId || '';
            storage.setItem('clic_erp_sync_tenant_id', tenantId);
        }
        if (credentials.cloudAdminTenantId) {
            storage.setItem('cloud_admin_tenant_id', credentials.cloudAdminTenantId);
            storage.setItem('clic_cloud_admin_tenant_id', credentials.cloudAdminTenantId);
        }
        if (credentials.deviceToken) {
            storage.setItem('CLIC_POS_DEVICE_TOKEN', credentials.deviceToken);
            storage.setItem('CLIC_POS_DEVICE_TOKEN_SOURCE', credentials.deviceTokenSource || 'TERMINAL_CREDENTIAL_STORE');
            storage.setItem('CLIC_POS_DEVICE_TOKEN_UPDATED_AT', credentials.deviceTokenUpdatedAt || new Date().toISOString());
            if (credentials.deviceTokenExpiresAt) {
                storage.setItem('CLIC_POS_DEVICE_TOKEN_EXPIRES_AT', credentials.deviceTokenExpiresAt);
            }
        }
        if (credentials.syncToken) {
            storage.setItem('clic_erp_sync_token', credentials.syncToken);
            storage.setItem('clic_erp_sync_token_updated_at', credentials.syncTokenUpdatedAt || new Date().toISOString());
            if (credentials.syncTokenExpiresAt) {
                storage.setItem('clic_erp_sync_token_expires_at', credentials.syncTokenExpiresAt);
            }
        }
        if (credentials.authStatus) {
            storage.setItem('clic_sync_auth_status', credentials.authStatus);
        }
        if (credentials.lastAuthError) {
            storage.setItem('clic_sync_last_auth_error', credentials.lastAuthError);
        }
        if (credentials.lastReauthAttemptAt) {
            storage.setItem('clic_sync_last_reauth_attempt_at', credentials.lastReauthAttemptAt);
        }
    } catch {
        // Credential mirrors are best-effort; the canonical payload is also persisted below.
    }
};

export const readTerminalCredentialsSync = (): TerminalCredentials => {
    const storage = getStorage();
    if (!storage) return {};
    const stored = readJson(storage.getItem(CREDENTIALS_KEY));
    return mergeCredentials(stored, buildFromLegacyKeys(storage));
};

export const readTerminalCredentials = async (): Promise<TerminalCredentials> => {
    const local = readTerminalCredentialsSync();
    try {
        const result = await Preferences.get({ key: CREDENTIALS_KEY });
        const fromPreferences = readJson(result?.value || null);
        return mergeCredentials(fromPreferences, local);
    } catch {
        return local;
    }
};

export const saveTerminalCredentials = async (patch: TerminalCredentials): Promise<TerminalCredentials> => {
    const storage = getStorage();
    const current = readTerminalCredentialsSync();
    const next = mergeCredentials(current, patch);
    writeLegacyMirrors(next);

    try {
        storage?.setItem(CREDENTIALS_KEY, JSON.stringify(next));
    } catch {
        // A storage quota error must not erase the terminal binding.
    }

    try {
        await Preferences.set({ key: CREDENTIALS_KEY, value: JSON.stringify(next) });
    } catch {
        // Native Preferences is optional in some builds.
    }

    return next;
};

export const saveTerminalCredentialsSync = (patch: TerminalCredentials): TerminalCredentials => {
    const storage = getStorage();
    const current = readTerminalCredentialsSync();
    const next = mergeCredentials(current, patch);
    writeLegacyMirrors(next);
    try {
        storage?.setItem(CREDENTIALS_KEY, JSON.stringify(next));
    } catch {
        // A storage quota error must not erase the terminal binding.
    }
    void saveTerminalCredentials(patch);
    return next;
};

export const clearStoredSyncToken = (): void => {
    const storage = getStorage();
    if (!storage) return;
    const current = readTerminalCredentialsSync();
    const next = { ...current, syncToken: null, syncTokenExpiresAt: null, syncTokenUpdatedAt: null };
    try {
        storage.setItem(CREDENTIALS_KEY, JSON.stringify(next));
        storage.removeItem('clic_erp_sync_token');
        storage.removeItem('clic_erp_sync_token_expires_at');
        storage.removeItem('clic_erp_sync_token_updated_at');
    } catch {
        // Non-critical cleanup.
    }
    void saveTerminalCredentials(next);
};
