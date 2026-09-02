import type {
    MasterNumberRangeEntityType,
    MasterNumberRangeRecord,
} from '../db/DatabaseAdapter';

const SUPPORTED_TYPES = new Set<MasterNumberRangeEntityType>(['CUSTOMER', 'SUPPLIER', 'ITEM']);

const asObject = (value: unknown): Record<string, any> | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;

const asInteger = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
};

export const normalizeMasterNumberRange = (value: unknown): MasterNumberRangeRecord | null => {
    const source = asObject(value);
    if (!source) return null;
    const rawType = String(source.entity_type ?? source.entityType ?? '').trim().toUpperCase();
    const entityType = rawType === 'CLI' ? 'CUSTOMER'
        : rawType === 'PRO' ? 'SUPPLIER'
            : rawType === 'ART' ? 'ITEM'
                : rawType as MasterNumberRangeEntityType;
    const id = String(source.id ?? source.range_id ?? source.rangeId ?? '').trim();
    const prefix = String(source.prefix ?? '').trim();
    const startNumber = asInteger(source.start_number ?? source.startNumber);
    const endNumber = asInteger(source.end_number ?? source.endNumber);
    const nextNumber = asInteger(source.next_number ?? source.nextNumber);
    const lastIssuedNumber = asInteger(source.last_issued_number ?? source.lastIssuedNumber);
    const padding = asInteger(source.padding);

    if (!id || !prefix || !SUPPORTED_TYPES.has(entityType) || startNumber === null
        || endNumber === null || nextNumber === null || padding === null
        || startNumber < 0 || endNumber < startNumber || nextNumber < startNumber || padding < 1) {
        return null;
    }

    const effectiveNext = Math.max(nextNumber, (lastIssuedNumber ?? (startNumber - 1)) + 1);
    const remoteStatus = String(source.status ?? 'ACTIVE').trim().toUpperCase() || 'ACTIVE';
    return {
        id,
        entityType,
        prefix,
        startNumber,
        endNumber,
        nextNumber: effectiveNext,
        lastIssuedNumber,
        padding,
        status: effectiveNext > endNumber && remoteStatus === 'ACTIVE' ? 'EXHAUSTED' : remoteStatus,
        updatedAt: String(source.updated_at ?? source.updatedAt ?? new Date(0).toISOString()),
        lastReportedNumber: asInteger(source.last_reported_number ?? source.lastReportedNumber) ?? lastIssuedNumber,
        progressPending: Boolean(source.progress_pending ?? source.progressPending),
        blockedReason: source.blocked_reason ?? source.blockedReason ?? null,
        terminalId: source.terminal_id ?? source.terminalId ?? null,
    };
};

export const extractMasterNumberRanges = (payload: unknown): MasterNumberRangeRecord[] => {
    const root = asObject(payload);
    if (!root) return [];
    const terminalConfig = asObject(root.terminal_config ?? root.terminalConfig);
    const snapshot = asObject(root.snapshot) ?? root;
    const candidates = [
        asObject(terminalConfig?.resolved)?.master_number_ranges,
        asObject(terminalConfig?.resolved)?.masterNumberRanges,
        terminalConfig?.master_number_ranges,
        terminalConfig?.masterNumberRanges,
        asObject(snapshot.resolved)?.master_number_ranges,
        asObject(snapshot.resolved)?.masterNumberRanges,
        snapshot.master_number_ranges,
        snapshot.masterNumberRanges,
    ];
    const rows = candidates.find(Array.isArray) as unknown[] | undefined;
    if (!rows) return [];
    return rows.map(normalizeMasterNumberRange).filter((row): row is MasterNumberRangeRecord => !!row);
};

export const mergeMasterNumberRange = (
    local: MasterNumberRangeRecord | undefined,
    remote: MasterNumberRangeRecord,
): MasterNumberRangeRecord => {
    if (!local) return remote;
    const nextNumber = Math.max(local.nextNumber, remote.nextNumber);
    const lastIssuedNumber = Math.max(
        local.lastIssuedNumber ?? (local.startNumber - 1),
        remote.lastIssuedNumber ?? (remote.startNumber - 1),
    );
    const remoteIsNewer = Date.parse(remote.updatedAt) > Date.parse(local.updatedAt);
    const preserveLocalBlock = local.status === 'REVOKED'
        || (local.status === 'BLOCKED' && !remoteIsNewer);
    const status = preserveLocalBlock
        ? local.status
        : nextNumber > remote.endNumber && remote.status === 'ACTIVE'
            ? 'EXHAUSTED'
            : remote.status;
    return {
        ...remote,
        nextNumber,
        lastIssuedNumber,
        status,
        updatedAt: remoteIsNewer ? remote.updatedAt : local.updatedAt,
        lastReportedNumber: Math.max(
            local.lastReportedNumber ?? (local.startNumber - 1),
            remote.lastReportedNumber ?? (remote.startNumber - 1),
        ),
        progressPending: local.progressPending || remote.progressPending ||
            lastIssuedNumber > (local.lastReportedNumber ?? (local.startNumber - 1)),
        blockedReason: preserveLocalBlock ? local.blockedReason : remote.blockedReason,
        terminalId: remote.terminalId || local.terminalId || null,
    };
};

export const formatMasterNumberCode = (range: MasterNumberRangeRecord, value: number): string =>
    `${range.prefix.replace(/-+$/, '')}-${String(value).padStart(range.padding, '0')}`;

export const applyMasterNumberToDocument = <T extends { id: string; [key: string]: any }>(
    entityType: MasterNumberRangeEntityType,
    document: T,
    range: MasterNumberRangeRecord,
    value: number,
    sourceTerminalId: string,
) => {
    const code = formatMasterNumberCode(range, value);
    const codeFields = entityType === 'CUSTOMER'
        ? { customer_code: code, customerCode: code }
        : entityType === 'SUPPLIER'
            ? { supplier_code: code, supplierCode: code }
            : { sku: code };
    return {
        ...document,
        ...codeFields,
        external_code: code,
        externalCode: code,
        created_source: 'POS',
        source_terminal_id: sourceTerminalId,
        master_number_range_id: range.id,
        master_number_value: value,
    };
};

export const hasMasterCode = (entityType: MasterNumberRangeEntityType, document: Record<string, any>): boolean =>
    Boolean(entityType === 'CUSTOMER'
        ? document.customer_code ?? document.customerCode ?? document.external_code ?? document.externalCode
        : entityType === 'SUPPLIER'
            ? document.supplier_code ?? document.supplierCode ?? document.external_code ?? document.externalCode
            : document.sku ?? document.external_code ?? document.externalCode);

export const buildNumberedCustomerMutation = (
    customer: { id: string; [key: string]: any },
    terminalId: string,
    now: string,
) => ({
    id: `master-number-customer-${customer.id}`,
    customerId: customer.id,
    operation: 'UPSERT',
    customer,
    terminalId,
    createdAt: now,
    updatedAt: now,
    syncStatus: 'PENDING',
});

export const masterNumberRangeDiagnostics = (range: MasterNumberRangeRecord) => {
    const total = range.endNumber - range.startNumber + 1;
    const remaining = Math.max(range.endNumber - range.nextNumber + 1, 0);
    const consumed = Math.min(Math.max(total - remaining, 0), total);
    return {
        ...range,
        nextCode: remaining > 0 ? formatMasterNumberCode(range, range.nextNumber) : null,
        remaining,
        consumedPercent: total > 0 ? Math.round((consumed / total) * 100) : 100,
        warning: total > 0 && remaining / total <= 0.2,
    };
};
