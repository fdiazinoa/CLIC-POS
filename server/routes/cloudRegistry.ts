import { Router } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';

const router = Router();

const DOTENV_FILES = ['.env.local', '.env'];
const LANDLORD_PROFILE = 'landlord';
const TABLE_CANDIDATES = [
    { schema: LANDLORD_PROFILE, table: 'tenant_server_registry' },
    { schema: LANDLORD_PROFILE, table: 'tenant_servers' },
];
const REGISTER_RPC_CANDIDATES = [
    'register_tenant_server_endpoint',
    'upsert_tenant_server_endpoint',
];
const RESOLVE_RPC_CANDIDATES = [
    'resolve_tenant_server_endpoint',
    'get_tenant_server_endpoint',
];

type TenantIdentity = {
    tenantId?: string | null;
    tenantSlug?: string | null;
    tenantEmail?: string | null;
};

type CloudEndpointRecord = TenantIdentity & {
    deviceId: string;
    terminalId: string;
    terminalName?: string | null;
    hostname?: string | null;
    protocol: string;
    port: number;
    localIp: string;
    localIps: string[];
    endpointUrl: string;
    isPrimary: boolean;
    lastSeenAt: string;
    status: 'ONLINE';
};

const parseDotEnvFile = (): Record<string, string> => {
    const collected: Record<string, string> = {};

    for (const fileName of DOTENV_FILES) {
        const absolutePath = path.resolve(process.cwd(), fileName);
        if (!fs.existsSync(absolutePath)) continue;

        const content = fs.readFileSync(absolutePath, 'utf8');
        for (const rawLine of content.split('\n')) {
            const line = rawLine.trim();
            if (!line || line.startsWith('#')) continue;

            const equalIndex = line.indexOf('=');
            if (equalIndex <= 0) continue;

            const key = line.slice(0, equalIndex).trim();
            const value = line.slice(equalIndex + 1).trim();
            if (!key || key in collected) continue;

            collected[key] = value.replace(/^['"]|['"]$/g, '');
        }
    }

    return collected;
};

const fileEnv = parseDotEnvFile();

const getEnvValue = (...keys: string[]) => {
    for (const key of keys) {
        const processValue = process.env[key];
        if (typeof processValue === 'string' && processValue.trim().length > 0) {
            return processValue.trim();
        }

        const fileValue = fileEnv[key];
        if (typeof fileValue === 'string' && fileValue.trim().length > 0) {
            return fileValue.trim();
        }
    }

    return '';
};

const getSupabaseConfig = () => {
    const supabaseUrl = getEnvValue('SUPABASE_URL', 'VITE_SUPABASE_URL');
    const serviceRoleKey = getEnvValue('SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_SERVICE_ROLE_KEY');
    return {
        supabaseUrl,
        serviceRoleKey,
        isConfigured: Boolean(supabaseUrl && serviceRoleKey),
    };
};

const normalizeOptional = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
};

const normalizeEmail = (value: unknown): string | null => {
    const email = normalizeOptional(value);
    return email ? email.toLowerCase() : null;
};

const normalizeBoolean = (value: unknown, fallback = false): boolean => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'si'].includes(normalized)) return true;
        if (['false', '0', 'no'].includes(normalized)) return false;
    }
    return fallback;
};

const normalizePort = (value: unknown, fallback = 3001): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const dedupeStrings = (values: Array<string | null | undefined>) =>
    Array.from(new Set(values.map((value) => (value || '').trim()).filter(Boolean)));

const getLocalIpv4Addresses = (): string[] => {
    const interfaces = os.networkInterfaces();
    const addresses: string[] = [];

    for (const key of Object.keys(interfaces)) {
        for (const address of interfaces[key] || []) {
            if (address.family === 'IPv4' && !address.internal) {
                addresses.push(address.address);
            }
        }
    }

    return dedupeStrings(addresses);
};

const getPreferredIp = (requestedIp?: string | null): string | null => {
    const preferred = normalizeOptional(requestedIp);
    const localIps = getLocalIpv4Addresses();
    if (preferred && localIps.includes(preferred)) return preferred;
    return localIps[0] || preferred || null;
};

const getJsonHeaders = (serviceRoleKey: string, schema: string, method: 'GET' | 'POST' | 'PATCH') => {
    const schemaHeader = method === 'GET' ? 'Accept-Profile' : 'Content-Profile';

    return {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        [schemaHeader]: schema,
    };
};

const safeFetchJson = async (url: string, init: RequestInit) => {
    const response = await fetch(url, init);

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        const error = new Error(`HTTP ${response.status} ${errorText}`.trim());
        (error as Error & { status?: number }).status = response.status;
        throw error;
    }

    const text = await response.text();
    if (!text) return null;

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
};

const buildPublishedRecord = (body: Record<string, unknown>): CloudEndpointRecord | null => {
    const deviceId = normalizeOptional(body.deviceId);
    const terminalId = normalizeOptional(body.terminalId);
    const tenantId = normalizeOptional(body.tenantId);
    const tenantSlug = normalizeOptional(body.tenantSlug);
    const tenantEmail = normalizeEmail(body.tenantEmail);
    const localIp = getPreferredIp(normalizeOptional(body.localIp));

    if (!deviceId || !terminalId || !localIp || (!tenantId && !tenantSlug && !tenantEmail)) {
        return null;
    }

    const protocol = normalizeOptional(body.protocol) || 'http';
    const port = normalizePort(body.port, 3001);
    const hostname = normalizeOptional(body.hostname) || os.hostname();
    const localIps = dedupeStrings([
        localIp,
        ...(Array.isArray(body.localIps) ? body.localIps.map((value) => normalizeOptional(value)).filter(Boolean) : []),
        ...getLocalIpv4Addresses(),
    ]);

    return {
        tenantId,
        tenantSlug,
        tenantEmail,
        deviceId,
        terminalId,
        terminalName: normalizeOptional(body.terminalName),
        hostname,
        protocol,
        port,
        localIp,
        localIps,
        endpointUrl: `${protocol}://${localIp}:${port}`,
        isPrimary: normalizeBoolean(body.isPrimary, true),
        lastSeenAt: new Date().toISOString(),
        status: 'ONLINE',
    };
};

const normalizeResolvedRecord = (row: Record<string, any> | null | undefined) => {
    if (!row) return null;

    const localIp = normalizeOptional(
        row.local_ip
        || row.localIp
        || row.server_ip
        || row.master_ip
    );
    const endpointUrl = normalizeOptional(row.endpoint_url || row.endpointUrl);
    const protocol = normalizeOptional(row.protocol)
        || (endpointUrl?.startsWith('https://') ? 'https' : 'http')
        || 'http';
    const port = normalizePort(row.port, endpointUrl ? Number(new URL(endpointUrl).port || 3001) : 3001);
    const localIps = dedupeStrings([
        localIp,
        ...(Array.isArray(row.local_ips) ? row.local_ips : []),
        ...(Array.isArray(row.localIps) ? row.localIps : []),
    ]);

    const preferredIp = localIp || localIps[0] || null;
    if (!preferredIp && !endpointUrl) return null;

    return {
        tenantId: normalizeOptional(row.tenant_id || row.tenantId),
        tenantSlug: normalizeOptional(row.tenant_slug || row.tenantSlug),
        tenantEmail: normalizeEmail(row.tenant_email || row.tenantEmail),
        deviceId: normalizeOptional(row.device_id || row.deviceId),
        terminalId: normalizeOptional(row.terminal_id || row.terminalId),
        terminalName: normalizeOptional(row.terminal_name || row.terminalName),
        hostname: normalizeOptional(row.hostname),
        protocol,
        port,
        localIp: preferredIp,
        localIps,
        endpointUrl: endpointUrl || `${protocol}://${preferredIp}:${port}`,
        isPrimary: Boolean(row.is_primary ?? row.isPrimary ?? true),
        lastSeenAt: normalizeOptional(row.last_seen_at || row.lastSeenAt),
        status: normalizeOptional(row.status) || 'ONLINE',
    };
};

const tryRegisterViaRpc = async (supabaseUrl: string, serviceRoleKey: string, payload: CloudEndpointRecord) => {
    for (const rpcName of REGISTER_RPC_CANDIDATES) {
        try {
            const data = await safeFetchJson(`${supabaseUrl}/rest/v1/rpc/${rpcName}`, {
                method: 'POST',
                headers: getJsonHeaders(serviceRoleKey, LANDLORD_PROFILE, 'POST'),
                body: JSON.stringify({
                    p_tenant_id: payload.tenantId,
                    p_tenant_slug: payload.tenantSlug,
                    p_tenant_email: payload.tenantEmail,
                    p_device_id: payload.deviceId,
                    p_terminal_id: payload.terminalId,
                    p_terminal_name: payload.terminalName,
                    p_hostname: payload.hostname,
                    p_protocol: payload.protocol,
                    p_port: payload.port,
                    p_local_ip: payload.localIp,
                    p_local_ips: payload.localIps,
                    p_endpoint_url: payload.endpointUrl,
                    p_is_primary: payload.isPrimary,
                    p_last_seen_at: payload.lastSeenAt,
                    p_status: payload.status,
                }),
            });

            if (Array.isArray(data) && data.length > 0) return normalizeResolvedRecord(data[0]);
            if (data && typeof data === 'object') return normalizeResolvedRecord(data as Record<string, any>);
        } catch (error) {
            const status = (error as Error & { status?: number }).status;
            if (status === 404 || status === 401 || status === 403) continue;
            console.warn(`[cloudRegistry] register RPC ${rpcName} failed:`, error);
        }
    }

    return null;
};

const tryResolveViaRpc = async (supabaseUrl: string, serviceRoleKey: string, identity: TenantIdentity) => {
    for (const rpcName of RESOLVE_RPC_CANDIDATES) {
        try {
            const data = await safeFetchJson(`${supabaseUrl}/rest/v1/rpc/${rpcName}`, {
                method: 'POST',
                headers: getJsonHeaders(serviceRoleKey, LANDLORD_PROFILE, 'POST'),
                body: JSON.stringify({
                    p_tenant_id: identity.tenantId || null,
                    p_tenant_slug: identity.tenantSlug || null,
                    p_tenant_email: identity.tenantEmail || null,
                }),
            });

            if (Array.isArray(data) && data.length > 0) return normalizeResolvedRecord(data[0]);
            if (data && typeof data === 'object') return normalizeResolvedRecord(data as Record<string, any>);
        } catch (error) {
            const status = (error as Error & { status?: number }).status;
            if (status === 404 || status === 401 || status === 403) continue;
            console.warn(`[cloudRegistry] resolve RPC ${rpcName} failed:`, error);
        }
    }

    return null;
};

const buildIdentityQuery = (identity: TenantIdentity) => {
    if (identity.tenantId) return `tenant_id=eq.${encodeURIComponent(identity.tenantId)}`;
    if (identity.tenantSlug) return `tenant_slug=eq.${encodeURIComponent(identity.tenantSlug)}`;
    if (identity.tenantEmail) return `tenant_email=eq.${encodeURIComponent(identity.tenantEmail)}`;
    return '';
};

const tryFindExistingRow = async (
    supabaseUrl: string,
    serviceRoleKey: string,
    schema: string,
    table: string,
    payload: CloudEndpointRecord
) => {
    try {
        const query = new URLSearchParams({
            select: 'id',
            tenant_id: `eq.${payload.tenantId || ''}`,
            device_id: `eq.${payload.deviceId}`,
            limit: '1',
        });
        const data = await safeFetchJson(`${supabaseUrl}/rest/v1/${table}?${query.toString()}`, {
            method: 'GET',
            headers: getJsonHeaders(serviceRoleKey, schema, 'GET'),
        });
        return Array.isArray(data) && data.length > 0 ? data[0]?.id : null;
    } catch (error) {
        console.warn(`[cloudRegistry] existing row lookup failed for ${schema}.${table}:`, error);
        return null;
    }
};

const tryRegisterViaTable = async (supabaseUrl: string, serviceRoleKey: string, payload: CloudEndpointRecord) => {
    const tablePayload = {
        tenant_id: payload.tenantId,
        tenant_slug: payload.tenantSlug,
        tenant_email: payload.tenantEmail,
        device_id: payload.deviceId,
        terminal_id: payload.terminalId,
        terminal_name: payload.terminalName,
        hostname: payload.hostname,
        protocol: payload.protocol,
        port: payload.port,
        local_ip: payload.localIp,
        local_ips: payload.localIps,
        endpoint_url: payload.endpointUrl,
        is_primary: payload.isPrimary,
        last_seen_at: payload.lastSeenAt,
        status: payload.status,
    };

    for (const candidate of TABLE_CANDIDATES) {
        try {
            const existingId = await tryFindExistingRow(
                supabaseUrl,
                serviceRoleKey,
                candidate.schema,
                candidate.table,
                payload
            );

            const method = existingId ? 'PATCH' : 'POST';
            const suffix = existingId ? `?id=eq.${encodeURIComponent(existingId)}&select=*` : '?select=*';
            const data = await safeFetchJson(`${supabaseUrl}/rest/v1/${candidate.table}${suffix}`, {
                method,
                headers: getJsonHeaders(serviceRoleKey, candidate.schema, method),
                body: JSON.stringify(existingId ? tablePayload : tablePayload),
            });

            if (Array.isArray(data) && data.length > 0) return normalizeResolvedRecord(data[0]);
            if (data && typeof data === 'object') return normalizeResolvedRecord(data as Record<string, any>);
        } catch (error) {
            console.warn(`[cloudRegistry] register table fallback failed for ${candidate.schema}.${candidate.table}:`, error);
        }
    }

    return null;
};

const tryResolveViaTable = async (supabaseUrl: string, serviceRoleKey: string, identity: TenantIdentity) => {
    const identityQuery = buildIdentityQuery(identity);
    if (!identityQuery) return null;

    for (const candidate of TABLE_CANDIDATES) {
        try {
            const query = new URLSearchParams({
                select: '*',
                limit: '1',
                order: 'last_seen_at.desc',
            });
            const url = `${supabaseUrl}/rest/v1/${candidate.table}?${identityQuery}&${query.toString()}`;
            const data = await safeFetchJson(url, {
                method: 'GET',
                headers: getJsonHeaders(serviceRoleKey, candidate.schema, 'GET'),
            });

            if (Array.isArray(data) && data.length > 0) return normalizeResolvedRecord(data[0]);
        } catch (error) {
            console.warn(`[cloudRegistry] resolve table fallback failed for ${candidate.schema}.${candidate.table}:`, error);
        }
    }

    return null;
};

router.post('/publish', async (req, res) => {
    const payload = buildPublishedRecord(req.body || {});
    if (!payload) {
        return res.status(400).json({ error: 'tenantId/tenantSlug/tenantEmail, deviceId y terminalId son requeridos.' });
    }

    const { supabaseUrl, serviceRoleKey, isConfigured } = getSupabaseConfig();
    if (!isConfigured) {
        return res.status(503).json({ error: 'Cloud registry no configurado en este APK.' });
    }

    try {
        const resolved =
            await tryRegisterViaRpc(supabaseUrl, serviceRoleKey, payload)
            || await tryRegisterViaTable(supabaseUrl, serviceRoleKey, payload);

        if (!resolved) {
            return res.status(424).json({
                error: 'Cloud registry no disponible. Cree la RPC o tabla de registro en Cloud-Admin.',
                expectedRpc: REGISTER_RPC_CANDIDATES,
                expectedTables: TABLE_CANDIDATES,
            });
        }

        return res.json({ ok: true, endpoint: resolved });
    } catch (error) {
        console.error('[cloudRegistry] publish failed:', error);
        return res.status(500).json({ error: 'No se pudo publicar el endpoint del servidor.' });
    }
});

router.get('/resolve', async (req, res) => {
    const identity: TenantIdentity = {
        tenantId: normalizeOptional(req.query.tenantId),
        tenantSlug: normalizeOptional(req.query.tenantSlug),
        tenantEmail: normalizeEmail(req.query.tenantEmail),
    };

    if (!identity.tenantId && !identity.tenantSlug && !identity.tenantEmail) {
        return res.status(400).json({ error: 'tenantId, tenantSlug o tenantEmail es requerido.' });
    }

    const { supabaseUrl, serviceRoleKey, isConfigured } = getSupabaseConfig();
    if (!isConfigured) {
        return res.status(503).json({ error: 'Cloud registry no configurado en este APK.' });
    }

    try {
        const resolved =
            await tryResolveViaRpc(supabaseUrl, serviceRoleKey, identity)
            || await tryResolveViaTable(supabaseUrl, serviceRoleKey, identity);

        if (!resolved) {
            return res.status(404).json({ error: 'No hay servidor publicado para este tenant.' });
        }

        return res.json({ ok: true, endpoint: resolved });
    } catch (error) {
        console.error('[cloudRegistry] resolve failed:', error);
        return res.status(500).json({ error: 'No se pudo resolver el servidor maestro desde cloud.' });
    }
});

export default router;
