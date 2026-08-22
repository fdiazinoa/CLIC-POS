import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { normalizeErpSyncApiBase, resolveErpSyncApiBase } from '../../utils/erpBaseUrl';
import { resolveLocalDeviceId } from '../../utils/deviceRevocation';
import { readTerminalCredentialsSync } from './TerminalCredentialStore';
import { getSyncDeviceToken } from './deviceToken';

export type PrivateRealtimeScope = {
    tenantId: string;
    storeId: string;
    terminalId: string;
    deviceId: string;
};

const clean = (value: unknown): string => String(value || '').trim();

export const buildPrivateSyncTopic = (scope: Pick<PrivateRealtimeScope, 'tenantId' | 'storeId' | 'terminalId'>): string =>
    `sync:${clean(scope.tenantId)}:${clean(scope.storeId)}:${clean(scope.terminalId)}`;

const decodeJwtPayload = (token: string): Record<string, any> => {
    try {
        const encoded = token.split('.')[1] || '';
        const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
        return JSON.parse(globalThis.atob(padded));
    } catch {
        return {};
    }
};

export const tokenHasPrivateRealtimeScope = (token: string, scope: PrivateRealtimeScope): boolean => {
    const metadata = decodeJwtPayload(token).app_metadata || {};
    return clean(metadata.sync_tenant_id) === scope.tenantId
        && clean(metadata.sync_store_id) === scope.storeId
        && clean(metadata.sync_terminal_id) === scope.terminalId
        && clean(metadata.sync_device_id) === scope.deviceId;
};

let privateClient: SupabaseClient | null = null;

const getPrivateClient = (): SupabaseClient => {
    if (privateClient) return privateClient;
    const env = (import.meta as any).env || {};
    const url = clean(env.VITE_SUPABASE_URL) || 'https://placeholder.supabase.co';
    const anonKey = clean(env.VITE_SUPABASE_ANON_KEY) || 'placeholder-anon-key';
    privateClient = createClient(url, anonKey, {
        auth: {
            storageKey: 'clic-pos-private-realtime-auth',
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false,
        },
    });
    return privateClient;
};

const resolveScope = (input: Partial<PrivateRealtimeScope>): PrivateRealtimeScope => {
    const scope = {
        tenantId: clean(input.tenantId),
        storeId: clean(input.storeId),
        terminalId: clean(input.terminalId),
        deviceId: clean(input.deviceId || resolveLocalDeviceId()),
    };
    if (!scope.tenantId || !scope.storeId || !scope.terminalId || !scope.deviceId) {
        throw new Error('El binding privado de Realtime está incompleto.');
    }
    return scope;
};

export const ensurePrivateRealtimeAuthorization = async (
    input: Partial<PrivateRealtimeScope>,
    erpBaseUrl?: string | null,
): Promise<{ client: SupabaseClient; scope: PrivateRealtimeScope }> => {
    const scope = resolveScope(input);
    const client = getPrivateClient();
    let { data: { session } } = await client.auth.getSession();

    if (!session?.access_token || session.user?.is_anonymous !== true) {
        const anonymous = await client.auth.signInAnonymously();
        if (anonymous.error || !anonymous.data.session) {
            throw new Error(`No se pudo crear la identidad dedicada de Realtime: ${anonymous.error?.message || 'sesión ausente'}`);
        }
        session = anonymous.data.session;
    }

    if (!tokenHasPrivateRealtimeScope(session.access_token, scope)) {
        const credentials = readTerminalCredentialsSync();
        const syncToken = clean(credentials.syncToken);
        const deviceToken = clean(getSyncDeviceToken() || credentials.deviceToken);
        const apiBase = normalizeErpSyncApiBase(erpBaseUrl) || resolveErpSyncApiBase();
        if (!apiBase || !syncToken) {
            throw new Error('No hay endpoint ERP o sync token para autorizar Realtime privado.');
        }

        const response = await fetch(`${apiBase}/realtime/authorize`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session.access_token}`,
                'X-Sync-Token': syncToken,
                ...(deviceToken ? { 'X-Device-Token': deviceToken } : {}),
                'X-Device-Id': scope.deviceId,
                'X-POS-Device-Id': scope.deviceId,
            },
            body: JSON.stringify({
                tenant_id: scope.tenantId,
                store_id: scope.storeId,
                terminal_id: scope.terminalId,
                device_id: scope.deviceId,
            }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(`ERP rechazó la autorización privada de Realtime (${payload?.code || response.status}).`);
        }

        const refreshed = await client.auth.refreshSession();
        session = refreshed.data.session;
        if (refreshed.error || !session?.access_token || !tokenHasPrivateRealtimeScope(session.access_token, scope)) {
            throw new Error('La sesión renovada no contiene el scope privado autorizado.');
        }
    }

    return { client, scope };
};
