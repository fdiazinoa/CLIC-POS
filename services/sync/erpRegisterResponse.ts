import type { SyncProfile, SyncProfileSource } from './SyncProfile';

const SYNC_PROFILE_SOURCE_PRIORITY: Record<SyncProfileSource, number> = {
    ERP_REGISTER: 100,
    BACKEND_REGISTER: 90,
    CLOUD_ADMIN: 90,
    SQLITE_SYNC_PROFILE: 70,
    INITIAL_TERMINAL_CONFIG: 50,
    LOCAL_SNAPSHOT: 50,
    LEGACY_LOCAL_STORAGE: 10,
};

const getSyncProfileSourcePriority = (source?: SyncProfileSource | null): number =>
    source ? SYNC_PROFILE_SOURCE_PRIORITY[source] ?? 0 : 0;

export interface ErpRegisterAuthPayload {
    deviceToken?: string;
    terminalToken?: string;
    activationToken?: string;
    syncToken?: string;
    tokenExpiresAt?: string;
}

const pickAuthString = (...values: unknown[]): string | undefined => {
    for (const value of values) {
        if (typeof value !== 'string') continue;
        const trimmed = value.replace(/[\r\n\t]/g, '').trim();
        if (!trimmed || ['undefined', 'null', 'nan', '[object object]'].includes(trimmed.toLowerCase())) continue;
        return trimmed;
    }
    return undefined;
};

const asObject = (value: unknown): Record<string, any> =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const flattenRegisterRecords = (...sources: unknown[]): Record<string, any>[] => {
    return sources
        .map(asObject)
        .filter((record) => Object.keys(record).length > 0)
        .flatMap((record) => [
            record,
            asObject(record.auth),
            asObject(record.syncAuth),
            asObject(record.syncHeaders),
            asObject(record.sync_headers),
            asObject(record.profile),
            asObject(record.syncProfile),
            asObject(record.sync_profile),
            asObject(record.incomingProfile),
            asObject(record.incoming_profile),
            asObject(record.terminal),
            asObject(asObject(record.terminal).auth),
            asObject(asObject(record.terminal).config),
            asObject(record.terminal_config),
            asObject(asObject(record.terminal_config).config),
            asObject(asObject(record.terminal_config).auth),
            asObject(asObject(record.terminal_config).metadata),
            asObject(asObject(asObject(record.terminal_config).metadata).syncAuth),
            asObject(record.config),
            asObject(record.metadata),
            asObject(asObject(record.metadata).syncAuth),
            asObject(record.session),
        ])
        .filter((record) => Object.keys(record).length > 0);
};

export const extractErpRegisterAuth = (...sources: unknown[]): ErpRegisterAuthPayload => {
    const records = flattenRegisterRecords(...sources);
    const syncHeaders = records.find((record) =>
        record['X-Device-Token'] || record['x-device-token'] || record['X-Sync-Token'] || record['x-sync-token']
    ) || asObject(records.find((record) => record['X-Device-Token'] || record['X-Sync-Token']));

    const deviceToken = pickAuthString(
        ...records.flatMap((record) => [
            record.deviceToken,
            record.device_token,
            record.terminalToken,
            record.terminal_token,
            record.activationToken,
            record.activation_token,
            asObject(record.auth).deviceToken,
            asObject(record.auth).device_token,
            asObject(record.auth).terminalToken,
            asObject(record.auth).terminal_token,
            asObject(record.syncAuth).deviceToken,
            asObject(record.syncAuth).device_token,
            syncHeaders?.['X-Device-Token'],
            syncHeaders?.['x-device-token'],
        ])
    );
    const terminalToken = pickAuthString(
        ...records.flatMap((record) => [
            record.terminalToken,
            record.terminal_token,
            asObject(record.auth).terminalToken,
            asObject(record.auth).terminal_token,
            asObject(record.syncAuth).terminalToken,
            asObject(record.syncAuth).terminal_token,
        ])
    );
    const activationToken = pickAuthString(
        ...records.flatMap((record) => [
            record.activationToken,
            record.activation_token,
            asObject(record.auth).activationToken,
            asObject(record.auth).activation_token,
            asObject(record.syncAuth).activationToken,
            asObject(record.syncAuth).activation_token,
        ])
    );
    const syncToken = pickAuthString(
        ...records.flatMap((record) => [
            record.syncToken,
            record.sync_token,
            record.syncAuthToken,
            record.sync_auth_token,
            asObject(record.auth).syncToken,
            asObject(record.auth).sync_token,
            asObject(record.auth).syncAuthToken,
            asObject(record.auth).sync_auth_token,
            asObject(record.syncAuth).syncToken,
            asObject(record.syncAuth).sync_token,
            syncHeaders?.['X-Sync-Token'],
            syncHeaders?.['x-sync-token'],
        ])
    );
    const tokenExpiresAt = pickAuthString(
        ...records.flatMap((record) => [
            record.tokenExpiresAt,
            record.token_expires_at,
            record.expiresAt,
            record.expires_at,
            asObject(record.auth).tokenExpiresAt,
            asObject(record.auth).token_expires_at,
        ])
    );

    return { deviceToken, terminalToken, activationToken, syncToken, tokenExpiresAt };
};

export const resolveRegisterErpTerminalId = (...sources: unknown[]): string | undefined => {
    const records = flattenRegisterRecords(...sources);
    return pickAuthString(
        ...records.flatMap((record) => [
            record.erpTerminalId,
            record.erp_terminal_id,
            record.terminalId,
            record.terminal_id,
            asObject(record.terminal).id,
            asObject(record.terminal).erpTerminalId,
            asObject(record.terminal).erp_terminal_id,
            asObject(record.profile).erpTerminalId,
            asObject(record.syncProfile).erpTerminalId,
            asObject(record.incomingProfile).erpTerminalId,
        ])
    );
};

export const resolveRegisterTerminalCode = (...sources: unknown[]): string | undefined => {
    const records = flattenRegisterRecords(...sources);
    const candidates = records.flatMap((record) => [
        record.terminalCode,
        record.terminal_code,
        record.stationNumber,
        record.station_number,
        record.posCode,
        record.pos_code,
        record.code,
        record.localTerminalId,
        record.local_terminal_id,
    ]);

    return candidates
        .map((candidate) => pickAuthString(candidate))
        .find((candidate): candidate is string => Boolean(candidate && !UUID_PATTERN.test(candidate)));
};

export const resolveIncomingSyncProfileFromRegister = (
    response: unknown,
    fallbacks: Partial<SyncProfile> = {},
    contractSource: SyncProfileSource = 'ERP_REGISTER',
): Partial<SyncProfile> => {
    const root = asObject(response);
    const profileCandidate =
        root.incomingProfile
        || root.incoming_profile
        || root.syncProfile
        || root.sync_profile
        || root.profile
        || {};

    const merged: Partial<SyncProfile> = {
        ...fallbacks,
        ...(profileCandidate as Partial<SyncProfile>),
        contractSource: (profileCandidate as Partial<SyncProfile>).contractSource || contractSource,
    };

    merged.erpTerminalId = pickAuthString(
        merged.erpTerminalId,
        resolveRegisterErpTerminalId(response, fallbacks),
        fallbacks.erpTerminalId,
        (profileCandidate as Partial<SyncProfile>).erpTerminalId,
        asObject(profileCandidate).erp_terminal_id,
    );
    merged.localTerminalId = pickAuthString(
        resolveRegisterTerminalCode(response, fallbacks),
        fallbacks.localTerminalId,
        merged.localTerminalId,
        root.name,
        asObject(root.terminal).name,
    );
    merged.localTenantId = pickAuthString(
        merged.localTenantId,
        fallbacks.localTenantId,
        root.tenantId,
        root.tenant_id,
    );
    merged.localStoreId = pickAuthString(
        merged.localStoreId,
        fallbacks.localStoreId,
        root.storeId,
        root.store_id,
    );
    merged.erpBaseUrl = pickAuthString(
        merged.erpBaseUrl,
        merged.cloudBaseUrl,
        fallbacks.erpBaseUrl,
        fallbacks.cloudBaseUrl,
    );
    merged.cloudBaseUrl = pickAuthString(merged.cloudBaseUrl, merged.erpBaseUrl);

    return merged;
};

export interface SyncProfileChainValidationContext {
    erpTerminalId?: string | null;
    localTerminalId?: string | null;
    terminalName?: string | null;
}

const normalizeProfileId = (value?: string | null): string =>
    String(value || '').trim().toLowerCase();

const profileIdsMatch = (left?: string | null, right?: string | null): boolean => {
    const a = normalizeProfileId(left);
    const b = normalizeProfileId(right);
    if (!a || !b) return true;
    if (a === b) return true;

    const compactA = a.replace(/[^a-z0-9]/g, '');
    const compactB = b.replace(/[^a-z0-9]/g, '');
    if (compactA && compactB && compactA === compactB) return true;

    if (compactA.length >= 24 && compactB.length >= 24) {
        const minLength = Math.min(compactA.length, compactB.length, 32);
        return compactA.slice(0, minLength) === compactB.slice(0, minLength);
    }

    return false;
};

const collectProfileIdAliases = (...values: Array<string | null | undefined>): string[] =>
    values
        .map((value) => normalizeProfileId(value))
        .filter(Boolean);

const profileIdsMatchAny = (
    candidates: string[],
    ...aliases: Array<string | null | undefined>
): boolean => {
    const normalizedAliases = collectProfileIdAliases(...aliases);
    if (normalizedAliases.length === 0) return true;
    if (candidates.length === 0) return true;
    return candidates.some((candidate) =>
        normalizedAliases.some((alias) => profileIdsMatch(candidate, alias))
    );
};

export const validateSyncProfileChainUpgrade = (
    existingProfile: SyncProfile | null,
    incomingProfile: SyncProfile,
    context: SyncProfileChainValidationContext = {},
): { allowed: boolean; reason?: string } => {
    if (!existingProfile) return { allowed: true };

    const incomingPriority = getSyncProfileSourcePriority(incomingProfile.contractSource);
    const existingPriority = getSyncProfileSourcePriority(existingProfile.contractSource);

    if (incomingProfile.contractSource === 'ERP_REGISTER' && incomingPriority >= 100) {
        const resolvedIncomingErpTerminalId =
            incomingProfile.erpTerminalId
            || context.erpTerminalId
            || undefined;

        const tenantMatches = profileIdsMatch(
            existingProfile.localTenantId,
            incomingProfile.localTenantId,
        );

        const existingTerminalAliases = collectProfileIdAliases(
            existingProfile.erpTerminalId,
            existingProfile.localTerminalId,
        );
        const incomingTerminalAliases = collectProfileIdAliases(
            resolvedIncomingErpTerminalId,
            incomingProfile.erpTerminalId,
            incomingProfile.localTerminalId,
            context.erpTerminalId,
            context.localTerminalId,
            context.terminalName,
        );

        const erpTerminalMatches = profileIdsMatchAny(
            existingTerminalAliases,
            resolvedIncomingErpTerminalId,
            incomingProfile.erpTerminalId,
            incomingProfile.localTerminalId,
            context.erpTerminalId,
            context.localTerminalId,
            context.terminalName,
        );

        const localTerminalMatches = profileIdsMatchAny(
            collectProfileIdAliases(existingProfile.localTerminalId),
            incomingProfile.localTerminalId,
            incomingProfile.erpTerminalId,
            context.localTerminalId,
            context.terminalName,
            context.erpTerminalId,
        ) || profileIdsMatchAny(
            incomingTerminalAliases,
            existingProfile.localTerminalId,
            existingProfile.erpTerminalId,
            context.localTerminalId,
            context.terminalName,
        );

        if (tenantMatches && erpTerminalMatches) {
            return { allowed: true };
        }

        if (tenantMatches && localTerminalMatches) {
            return { allowed: true };
        }

        // ERP register always replaces lower-priority local/legacy profiles.
        if (incomingPriority > existingPriority) {
            return { allowed: true, reason: 'ERP_REGISTER priority override' };
        }

        return {
            allowed: false,
            reason: 'ERP_REGISTER profile chain mismatch (tenant/erpTerminal/localTerminal)',
        };
    }

    if (incomingPriority >= existingPriority) {
        return { allowed: true };
    }

    return {
        allowed: false,
        reason: `Incoming profile priority ${incomingPriority} is lower than existing ${existingPriority}`,
    };
};

export const resolveNormalizedRegisterDeviceToken = (...sources: unknown[]): string | undefined => {
    const auth = extractErpRegisterAuth(...sources);
    return auth.deviceToken || auth.terminalToken || auth.activationToken;
};
