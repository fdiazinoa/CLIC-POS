export const ERP_TERMINAL_UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const cleanIdentityString = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    if (!normalized) return null;
    if (['undefined', 'null', 'nan', '[object object]'].includes(normalized.toLowerCase())) return null;
    return normalized;
};

export const isCanonicalErpTerminalId = (value: unknown): value is string => {
    const normalized = cleanIdentityString(value);
    return Boolean(normalized && ERP_TERMINAL_UUID_PATTERN.test(normalized));
};

export const normalizeCanonicalErpTerminalId = (value: unknown): string | null => {
    const normalized = cleanIdentityString(value);
    return normalized && ERP_TERMINAL_UUID_PATTERN.test(normalized) ? normalized : null;
};

const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};

const identityRecords = (source: unknown): Record<string, unknown>[] => {
    if (typeof source === 'string') return [{ erpTerminalId: source }];
    const root = asRecord(source);
    const terminal = asRecord(root.terminal);
    return [
        root,
        asRecord(root.auth),
        terminal,
        asRecord(terminal.auth),
        asRecord(root.profile),
        asRecord(root.syncProfile),
        asRecord(root.sync_profile),
        asRecord(root.incomingProfile),
        asRecord(root.incoming_profile),
        asRecord(root.terminal_config),
        asRecord(root.config),
    ];
};

export const resolveCanonicalErpTerminalId = (...sources: unknown[]): string | undefined => {
    const candidates = sources.flatMap(identityRecords).flatMap((record) => [
        record.erp_terminal_id,
        record.erpTerminalId,
        record.terminal_id,
        record.terminalId,
        record.id,
    ]);
    return candidates
        .map(normalizeCanonicalErpTerminalId)
        .find((value): value is string => Boolean(value));
};

export interface SeparatedTerminalIdentity {
    erpTerminalId: string | null;
    terminalId: string | null;
    terminalCode: string | null;
    stationNumber: string | null;
    terminalName: string | null;
    deviceId: string | null;
    requiresPairing: boolean;
    migratedLegacyIdentity: boolean;
}

export const separateTerminalIdentity = (input: {
    erpTerminalId?: unknown;
    terminalId?: unknown;
    terminalCode?: unknown;
    stationNumber?: unknown;
    terminalName?: unknown;
    deviceId?: unknown;
}): SeparatedTerminalIdentity => {
    const rawTechnicalId = cleanIdentityString(input.erpTerminalId)
        || cleanIdentityString(input.terminalId);
    const erpTerminalId = normalizeCanonicalErpTerminalId(input.erpTerminalId)
        || normalizeCanonicalErpTerminalId(input.terminalId);
    const explicitCode = cleanIdentityString(input.terminalCode)
        || cleanIdentityString(input.stationNumber);
    const legacyCode = !erpTerminalId && rawTechnicalId ? rawTechnicalId : null;
    const terminalCode = explicitCode || legacyCode;
    return {
        erpTerminalId,
        terminalId: erpTerminalId,
        terminalCode,
        stationNumber: cleanIdentityString(input.stationNumber) || terminalCode,
        terminalName: cleanIdentityString(input.terminalName),
        deviceId: cleanIdentityString(input.deviceId),
        requiresPairing: !erpTerminalId,
        migratedLegacyIdentity: Boolean(rawTechnicalId && !erpTerminalId),
    };
};

export class CanonicalErpTerminalIdError extends Error {
    readonly code = 'CANONICAL_ERP_TERMINAL_ID_MISSING';

    constructor() {
        super(
            'El ERP no devolvió un UUID canónico válido para la terminal. '
            + 'La vinculación quedó pendiente; vuelve a autorizar y seleccionar la terminal.'
        );
        this.name = 'CanonicalErpTerminalIdError';
    }
}

export const requireCanonicalErpTerminalId = (...sources: unknown[]): string => {
    const resolved = resolveCanonicalErpTerminalId(...sources);
    if (!resolved) throw new CanonicalErpTerminalIdError();
    return resolved;
};
