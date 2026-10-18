import {isTerminalAuthorizationSuperseded} from '../../utils/terminalAuthorizationGuard';
import { Preferences } from '@capacitor/preferences';
import type { BusinessConfig } from '../../types';
import { separateTerminalIdentity } from './terminalIdentity';

export interface TerminalCredentials {
    terminalId?: string | null;
    erpTerminalId?: string | null;
    terminalCode?: string | null;
    stationNumber?: string | null;
    terminalName?: string | null;
    deviceId?: string | null;
    tenantId?: string | null;
    erpTenantId?: string | null;
    cloudAdminTenantId?: string | null;
    companyId?: string | null;
    storeId?: string | null;
    deviceToken?: string | null;
    deviceTokenSource?: string | null;
    deviceTokenUpdatedAt?: string | null;
    deviceTokenExpiresAt?: string | null;
    syncToken?: string | null;
    syncTokenExpiresAt?: string | null;
    syncTokenUpdatedAt?: string | null;
    syncSessionObservation?: TerminalSessionObservation | null;
    authStatus?: string | null;
    lastAuthError?: string | null;
    lastReauthAttemptAt?: string | null;
    masterIp?: string | null;
    masterUrl?: string | null;
    setupMode?: string | null;
    syncMode?: string | null;
    configSnapshot?: BusinessConfig | null;
    identityMigrationRequired?: boolean | null;
}

const CREDENTIALS_KEY = 'clic_terminal_credentials_v1';
let credentialWriteGeneration = 0;
const AUTH_PROJECTION_MARKER='clic_terminal_auth_envelope_projection_v1';
let projectedTerminalAuthDocument:string|null=null;
export const resetTerminalAuthProjectionMemoryForTests=():void=>{projectedTerminalAuthDocument=null;};
let credentialWriteQueue: Promise<void> = Promise.resolve();
let readNativeCredentialsForProjection=async()=>{const result=await Preferences.get({key:CREDENTIALS_KEY});return result.value;};
export const setTerminalCredentialNativeReaderForTests=(reader:(()=>Promise<string|null>)|null):void=>{readNativeCredentialsForProjection=reader|| (async()=>{const result=await Preferences.get({key:CREDENTIALS_KEY});return result.value;});};
let writeNativeCredentials = (value: string) => Preferences.set({ key: CREDENTIALS_KEY, value });

export const setTerminalCredentialNativeWriterForTests = (
    writer: ((value: string) => Promise<void>) | null,
): void => {
    writeNativeCredentials = writer || ((value: string) => Preferences.set({ key: CREDENTIALS_KEY, value }));
};

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

const readConfigSnapshot = (storage: Storage): BusinessConfig | null => {
    const raw = storage.getItem('initial_terminal_config');
    if (!raw) return null;
    const parsed = readJson(raw) as BusinessConfig;
    return Array.isArray(parsed?.terminals) && parsed.terminals.length > 0 ? parsed : null;
};

const withoutConfigSnapshot = (credentials: TerminalCredentials): TerminalCredentials => {
    const { configSnapshot: _configSnapshot, ...identityCredentials } = credentials;
    return identityCredentials;
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
    terminalId: cleanString(storage.getItem('clic_erp_sync_terminal_id') || storage.getItem('erp_terminal_id')),
    erpTerminalId: cleanString(storage.getItem('clic_erp_sync_terminal_id') || storage.getItem('erp_terminal_id')),
    terminalCode: cleanString(storage.getItem('clic_erp_sync_terminal_code') || storage.getItem('CLIC_POS_TERMINAL_ID') || storage.getItem('active_terminal_id')),
    stationNumber: cleanString(storage.getItem('clic_erp_sync_station_number') || storage.getItem('clic_erp_sync_terminal_code')),
    terminalName: cleanString(storage.getItem('clic_erp_sync_terminal_name')),
    deviceId: cleanString(storage.getItem('CLIC_POS_DEVICE_ID') || storage.getItem('pos_device_id') || storage.getItem('clic_pos_device_id')),
    tenantId: cleanString(storage.getItem('clic_erp_sync_tenant_id') || storage.getItem('active_tenant_id') || storage.getItem('clic_tenant_id')),
    erpTenantId: cleanString(storage.getItem('clic_erp_sync_tenant_id') || storage.getItem('active_tenant_id')),
    cloudAdminTenantId: cleanString(storage.getItem('cloud_admin_tenant_id') || storage.getItem('clic_cloud_admin_tenant_id') || storage.getItem('clic_tenant_id')),
    companyId: cleanString(storage.getItem('clic_erp_sync_company_id')),
    storeId: cleanString(storage.getItem('clic_erp_sync_store_id') || storage.getItem('active_store_id') || storage.getItem('clic_store_id')),
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
    masterIp: cleanString(storage.getItem('pos_master_ip')),
    masterUrl: cleanString(storage.getItem('CLIC_POS_MASTER_URL')),
    setupMode: cleanString(storage.getItem('clic_pos_terminal_setup_mode')),
    syncMode: cleanString(storage.getItem('clic_sync_mode')),
});

export const normalizeTerminalCredentialsIdentity = (
    credentials: TerminalCredentials,
): TerminalCredentials => {
    const separated = separateTerminalIdentity(credentials);
    return {
        ...credentials,
        terminalId: separated.terminalId,
        erpTerminalId: separated.erpTerminalId,
        terminalCode: separated.terminalCode,
        stationNumber: separated.stationNumber,
        terminalName: separated.terminalName,
        deviceId: separated.deviceId,
        identityMigrationRequired: separated.requiresPairing,
        ...(separated.migratedLegacyIdentity ? { authStatus: 'PAIRING_REQUIRED' } : {}),
    };
};

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
        const canonicalTerminalId = separateTerminalIdentity(credentials).erpTerminalId;
        if (canonicalTerminalId) {
            storage.setItem('clic_erp_sync_terminal_id', canonicalTerminalId);
            storage.setItem('erp_terminal_id', canonicalTerminalId);
        } else {
            storage.removeItem('clic_erp_sync_terminal_id');
            storage.removeItem('erp_terminal_id');
        }
        if (credentials.terminalCode) {
            storage.setItem('clic_erp_sync_terminal_code', credentials.terminalCode);
        }
        if (credentials.stationNumber) {
            storage.setItem('clic_erp_sync_station_number', credentials.stationNumber);
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
        if (credentials.companyId) {
            storage.setItem('clic_erp_sync_company_id', credentials.companyId);
        }
        if (credentials.storeId) {
            storage.setItem('clic_erp_sync_store_id', credentials.storeId);
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
        if (credentials.masterIp) {
            storage.setItem('pos_master_ip', credentials.masterIp);
        } else if (credentials.masterIp === null) {
            storage.removeItem('pos_master_ip');
        }
        if (credentials.masterUrl) {
            storage.setItem('CLIC_POS_MASTER_URL', credentials.masterUrl);
        } else if (credentials.masterUrl === null) {
            storage.removeItem('CLIC_POS_MASTER_URL');
        }
        if (credentials.setupMode) {
            storage.setItem('clic_pos_terminal_setup_mode', credentials.setupMode);
        }
        if (credentials.syncMode) {
            storage.setItem('clic_sync_mode', credentials.syncMode);
        }
        if (credentials.configSnapshot && typeof credentials.configSnapshot === 'object') {
            storage.setItem('initial_terminal_config', JSON.stringify(credentials.configSnapshot));
        }
    } catch {
        // Credential mirrors are best-effort; the canonical payload is also persisted below.
    }
};

export const readTerminalCredentialsSync = (): TerminalCredentials => {
    const storage = getStorage();
    if (!storage) return {};
    const raw=storage.getItem(CREDENTIALS_KEY);
    if(storage.getItem(AUTH_PROJECTION_MARKER)==='1'&&raw!==projectedTerminalAuthDocument)return {...readJson(raw),authStatus:'BOUND_AUTH_MISMATCH'};
    if(projectedTerminalAuthDocument!==null&&raw===projectedTerminalAuthDocument){
        const canonical=readJson(raw),status=storage.getItem('clic_sync_auth_status')||'';
        if(/DEVICE_NOT_AUTHORIZED|NEEDS_REAUTH|BOUND_AUTH_MISMATCH|AUTH_ERROR|REVOKED/i.test(status))return {...canonical,authStatus:status};
        try{assertTerminalBindingMirrors(storage,canonical);if(storage.getItem('clic_erp_sync_token')!==canonical.syncToken||storage.getItem('clic_erp_sync_token_expires_at')!==canonical.syncTokenExpiresAt||storage.getItem('clic_erp_sync_token_updated_at')!==canonical.syncTokenUpdatedAt)throw Error('drift');}catch{return {...canonical,authStatus:'BOUND_AUTH_MISMATCH'};}
        return canonical;
    }
    const stored = readJson(raw);
    const storedIdentity = withoutConfigSnapshot(stored);
    const merged = mergeCredentials(storedIdentity, buildFromLegacyKeys(storage));
    const normalized = normalizeTerminalCredentialsIdentity(merged);
    if (
        stored.configSnapshot
        || normalized.identityMigrationRequired
        || JSON.stringify(normalized) !== JSON.stringify(merged)
    ) {
        try {
            if (stored.configSnapshot && !storage.getItem('initial_terminal_config')) {
                storage.setItem('initial_terminal_config', JSON.stringify(stored.configSnapshot));
            }
            storage.setItem(CREDENTIALS_KEY, JSON.stringify(withoutConfigSnapshot(normalized)));
            writeLegacyMirrors(normalized);
        } catch {
            // Identity migration is retried on the next boot without touching transactional stores.
        }
    }
    return normalized;
};

/**
 * Canonical terminal sync credential. All ERP sync callers must use this
 * persisted pairing/binding value instead of trusting request payload fields.
 */
export const resolvePersistedTerminalSyncToken = (): string | null =>
    cleanToken(readTerminalCredentialsSync().syncToken || null);

export const buildTerminalSyncAuthHeaders = (): Record<string, string> => {
    const syncToken = resolvePersistedTerminalSyncToken();
    return syncToken ? { 'X-Sync-Token': syncToken } : {};
};

export const readTerminalCredentials = async (): Promise<TerminalCredentials> => {
    await (await import('./BindingAuthEvidencePersistence')).recoverBindingAuthEvidence();
    const storage = getStorage();
    const local = readTerminalCredentialsSync();
    const localConfigSnapshot = storage ? readConfigSnapshot(storage) : null;
    try {
        const result = await Preferences.get({ key: CREDENTIALS_KEY });
        const fromPreferences = readJson(result?.value || null);
        return normalizeTerminalCredentialsIdentity(mergeCredentials(
            localConfigSnapshot ? { configSnapshot: localConfigSnapshot } : {},
            fromPreferences,
            local,
        ));
    } catch {
        return normalizeTerminalCredentialsIdentity(mergeCredentials(
            localConfigSnapshot ? { configSnapshot: localConfigSnapshot } : {},
            local,
        ));
    }
};

const persistTerminalCredentialsNative = (next: TerminalCredentials, generation: number): Promise<void> => {
    const operation = credentialWriteQueue.then(async () => {
        if (generation !== credentialWriteGeneration) return;
        try {
            await writeNativeCredentials(JSON.stringify(next));
        } catch {
            // Native Preferences is optional in some builds.
        }
    });
    credentialWriteQueue = operation.catch(() => undefined);
    return operation;
};

export const awaitTerminalCredentialWrites = async (): Promise<void> => {
    await credentialWriteQueue;
};

export const saveTerminalCredentials = async (patch: TerminalCredentials): Promise<TerminalCredentials> => {
    const storage = getStorage();
    const current = readTerminalCredentialsSync();
    const generation = ++credentialWriteGeneration;
    const next = normalizeTerminalCredentialsIdentity(mergeCredentials(current, patch));
    writeLegacyMirrors(next);

    try {
        storage?.setItem(CREDENTIALS_KEY, JSON.stringify(withoutConfigSnapshot(next)));
    } catch {
        // A storage quota error must not erase the terminal binding.
    }

    await persistTerminalCredentialsNative(next, generation);

    return next;
};

export const saveTerminalCredentialsSync = (patch: TerminalCredentials): TerminalCredentials => {
    const storage = getStorage();
    const current = readTerminalCredentialsSync();
    const generation = ++credentialWriteGeneration;
    const next = normalizeTerminalCredentialsIdentity(mergeCredentials(current, patch));
    writeLegacyMirrors(next);
    try {
        storage?.setItem(CREDENTIALS_KEY, JSON.stringify(withoutConfigSnapshot(next)));
    } catch {
        // A storage quota error must not erase the terminal binding.
    }
    void persistTerminalCredentialsNative(next, generation);
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

/** Strict session-only CAS; never repairs, normalizes or rotates binding metadata. */
export type TerminalSessionObservation={source:'LOCAL_OBSERVATION_OF_ERP_SYNC_AUTH';origin:string;route:'/api/sync/auth';tenantId:string;terminalId:string;deviceId:string;observedAt:string};
export type TerminalSessionSnapshot={document:string;generation:number;credentials:TerminalCredentials};
export const captureTerminalSessionSnapshot=():TerminalSessionSnapshot=>{
    const storage=getStorage(),document=storage?.getItem(CREDENTIALS_KEY);
    if(!document)throw Error('SYNC_AUTH_CANONICAL_CREDENTIALS_REQUIRED');
    let credentials:TerminalCredentials;
    try{credentials=JSON.parse(document);}catch{throw Error('SYNC_AUTH_CANONICAL_CREDENTIALS_REQUIRED');}
    if(!credentials||typeof credentials!=='object'||Array.isArray(credentials))throw Error('SYNC_AUTH_CANONICAL_CREDENTIALS_REQUIRED');
    return {document,generation:credentialWriteGeneration,credentials};
};
export const saveTerminalSessionCAS=(snapshot:TerminalSessionSnapshot,session:{token:string;expiresAt:string;observation:TerminalSessionObservation},assertCurrent:()=>void):Promise<void>=>{
    const operation=credentialWriteQueue.then(async()=>{
        const storage=getStorage();
        const current=()=>{assertCurrent();if(!storage||credentialWriteGeneration!==snapshot.generation||storage.getItem(CREDENTIALS_KEY)!==snapshot.document)throw Error('SYNC_AUTH_SESSION_CHANGED');};
        current();
        if(typeof session.token!=='string'||!session.token||session.token.trim()!==session.token||/[\r\n\t]/.test(session.token)||!Number.isFinite(Date.parse(session.expiresAt))||Date.parse(session.expiresAt)<=Date.now()||session.observation.source!=='LOCAL_OBSERVATION_OF_ERP_SYNC_AUTH')throw Error('SYNC_AUTH_SESSION_INVALID');
        const next={...JSON.parse(snapshot.document),syncToken:session.token,syncTokenExpiresAt:session.expiresAt,syncTokenUpdatedAt:session.observation.observedAt,syncSessionObservation:session.observation};
        // Preferences and localStorage are separate stores: propagate failures/partial persistence, never label them atomic/durable success.
        await writeNativeCredentials(JSON.stringify(next));
        current();
        storage!.setItem(CREDENTIALS_KEY,JSON.stringify(next));
        storage!.setItem('clic_erp_sync_token',session.token);
        storage!.setItem('clic_erp_sync_token_expires_at',session.expiresAt);
        storage!.setItem('clic_erp_sync_token_updated_at',session.observation.observedAt);
        credentialWriteGeneration++;
    });
    credentialWriteQueue=operation.catch(()=>undefined);
    return operation;
};

/** Compatibility projection only. SQL envelope remains the authority; this never pairs evidence in sync reads. */
export const projectTerminalAuthEnvelope=(before:string,after:string,assertCurrent:()=>void|Promise<void>=()=>{}):Promise<void>=>{
    const operation=credentialWriteQueue.then(async()=>{
        const storage=getStorage(),allowed=async()=>{await assertCurrent();const raw=storage?.getItem(CREDENTIALS_KEY);if(!storage||raw!==before&&raw!==after)throw Error('SYNC_BINDING_PROJECTION_CONFLICT');assertTerminalBindingMirrors(storage,JSON.parse(after));};
        await allowed();const generation=credentialWriteGeneration;
        const native=await readNativeCredentialsForProjection();if(native!==null&&native!==before&&native!==after)throw Error('SYNC_BINDING_PROJECTION_CONFLICT');
        const projected=JSON.parse(after);if(native===after&&storage!.getItem(CREDENTIALS_KEY)===after&&storage!.getItem('clic_erp_sync_token')===projected.syncToken&&storage!.getItem('clic_erp_sync_token_expires_at')===projected.syncTokenExpiresAt&&storage!.getItem('clic_erp_sync_token_updated_at')===projected.syncTokenUpdatedAt){projectedTerminalAuthDocument=after;return;}
        await writeNativeCredentials(after);
        await allowed();if(generation!==credentialWriteGeneration)throw Error('SYNC_BINDING_PROJECTION_CONFLICT');
        const next=JSON.parse(after);
        storage!.setItem(AUTH_PROJECTION_MARKER,'1');
        storage!.setItem(CREDENTIALS_KEY,after);
        storage!.setItem('clic_erp_sync_token',next.syncToken);
        storage!.setItem('clic_erp_sync_token_expires_at',next.syncTokenExpiresAt);
        storage!.setItem('clic_erp_sync_token_updated_at',next.syncTokenUpdatedAt);
        projectedTerminalAuthDocument=after;
        credentialWriteGeneration++;
    });credentialWriteQueue=operation.catch(()=>undefined);return operation;
};

const assertTerminalBindingMirrors=(storage:Storage,c:TerminalCredentials)=>{
    if(isTerminalAuthorizationSuperseded(storage)||/DEVICE_NOT_AUTHORIZED|NEEDS_REAUTH|BOUND_AUTH_MISMATCH|AUTH_ERROR|REVOKED/i.test(storage.getItem('clic_sync_auth_status')||''))throw Error('SYNC_BINDING_PROJECTION_CONFLICT');
    const keys:Record<string,unknown>={CLIC_POS_DEVICE_TOKEN:c.deviceToken,CLIC_POS_DEVICE_TOKEN_SOURCE:c.deviceTokenSource,CLIC_POS_DEVICE_TOKEN_UPDATED_AT:c.deviceTokenUpdatedAt,CLIC_POS_DEVICE_TOKEN_EXPIRES_AT:c.deviceTokenExpiresAt,CLIC_POS_DEVICE_ID:c.deviceId,clic_erp_sync_terminal_id:c.erpTerminalId||c.terminalId,clic_erp_sync_tenant_id:c.erpTenantId||c.tenantId,clic_erp_sync_company_id:c.companyId,clic_erp_sync_store_id:c.storeId};
    for(const [key,value]of Object.entries(keys)){const actual=storage.getItem(key);if(actual!==null&&actual!==value)throw Error('SYNC_BINDING_PROJECTION_CONFLICT');}
};
export const verifyTerminalAuthProjection=async(document:string):Promise<void>=>{
    const storage=getStorage();if(!storage||storage.getItem(CREDENTIALS_KEY)!==document)throw Error('SYNC_BINDING_PROJECTION_CONFLICT');const c=JSON.parse(document);assertTerminalBindingMirrors(storage,c);
    if(storage.getItem('clic_erp_sync_token')!==c.syncToken||storage.getItem('clic_erp_sync_token_expires_at')!==c.syncTokenExpiresAt||storage.getItem('clic_erp_sync_token_updated_at')!==c.syncTokenUpdatedAt||await readNativeCredentialsForProjection()!==document)throw Error('SYNC_BINDING_PROJECTION_CONFLICT');
};
