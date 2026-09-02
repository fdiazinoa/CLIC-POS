import { dbAdapter } from '../db';
import type { MasterNumberRangeEntityType, MasterNumberRangeRecord } from '../db/DatabaseAdapter';
import { apiSyncAdapter } from './ApiSyncAdapter';
import { permissionService } from './PermissionService';
import { resolveCanonicalErpTerminalId } from './terminalIdentity';
import { syncPolicy } from './SyncProfile';
import {
    extractMasterNumberRanges,
    masterNumberRangeDiagnostics,
} from './masterNumberRangeContract';

export const MASTER_NUMBER_RANGE_EXHAUSTED_MESSAGE =
    'La terminal agotó el rango asignado. Conéctala y solicita un nuevo rango.';

const notifyUpdated = () => {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('masterNumberRangesUpdated'));
};

const firstText = (...values: unknown[]): string => {
    for (const value of values) {
        const normalized = String(value ?? '').trim();
        if (normalized) return normalized;
    }
    return '';
};

export const persistMasterNumberRangesFromSnapshot = async (snapshot: unknown, terminalHint?: string | null): Promise<number> => {
    const ranges = extractMasterNumberRanges(snapshot);
    if (!ranges.length) return 0;
    if (!dbAdapter.upsertMasterNumberRanges) {
        throw new Error('El almacenamiento local no soporta rangos numéricos de maestros.');
    }
    const context = await resolveProgressContext(terminalHint);
    if (!context.terminalId) throw new Error('MASTER_NUMBER_RANGE_TERMINAL_ID_MISSING');
    await dbAdapter.upsertMasterNumberRanges(ranges.map(range => ({ ...range, terminalId: context.terminalId })));
    notifyUpdated();
    return ranges.length;
};

export const getMasterNumberRanges = async (): Promise<MasterNumberRangeRecord[]> =>
    dbAdapter.getMasterNumberRanges ? dbAdapter.getMasterNumberRanges() : [];

export const getMasterNumberRangeDiagnostics = async () =>
    (await getMasterNumberRanges()).map(masterNumberRangeDiagnostics);

export const createNumberedMaster = async <T extends { id: string; [key: string]: any }>(
    entityType: MasterNumberRangeEntityType,
    collectionName: 'customers' | 'suppliers' | 'products',
    document: T,
    terminalId = permissionService.getTerminalId(),
): Promise<T> => {
    // A retry of the same UUID returns the already committed master. User-entered
    // fields cannot bypass allocation for a genuinely new record.
    const existing = await dbAdapter.getDocument<T>(collectionName, document.id);
    if (existing) return existing;
    const context = await resolveProgressContext(terminalId);
    if (!context.terminalId || !dbAdapter.commitNumberedMasterCreation) {
        throw new Error(MASTER_NUMBER_RANGE_EXHAUSTED_MESSAGE);
    }
    const result = await dbAdapter.commitNumberedMasterCreation({
        entityType,
        collectionName,
        document,
        sourceTerminalId: context.terminalId,
        localTerminalId: terminalId || context.terminalId,
    });
    notifyUpdated();
    return result.document as T;
};

const resolveProgressContext = async (terminalHint?: string | null) => {
    const config = await dbAdapter.getCollection<any>('config');
    const source: Record<string, any> = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
    const localTerminalId = firstText(terminalHint, permissionService.getTerminalId(), localStorage.getItem('active_terminal_id'));
    const terminal = (Array.isArray(source.terminals) ? source.terminals : []).find((entry: any) =>
        entry.id === localTerminalId || entry.config?.erpTerminalId === localTerminalId
        || entry.config?.erpBinding?.terminalId === localTerminalId,
    );
    const erpBinding = terminal?.config?.erpBinding ?? source.erpBinding ?? source.erp_binding ?? {};
    const metadata = source.metadata ?? {};
    return {
        tenantId: firstText(erpBinding.tenantId, erpBinding.tenant_id, metadata.tenantId, metadata.tenant_id, source.tenantId, source.tenant_id, localStorage.getItem('clic_erp_sync_tenant_id')),
        companyId: firstText(erpBinding.companyId, erpBinding.company_id, metadata.companyId, metadata.company_id, source.companyId, source.company_id),
        terminalId: resolveCanonicalErpTerminalId(
            erpBinding.terminalId, erpBinding.terminal_id, terminal?.config?.erpTerminalId,
            terminal?.id, terminalHint, localStorage.getItem('clic_erp_sync_terminal_id'),
        ) || '',
    };
};

export const getPendingMasterNumberRanges = async (): Promise<MasterNumberRangeRecord[]> => {
    const context = await resolveProgressContext();
    return (await getMasterNumberRanges()).filter(range => {
        const lastIssued = range.lastIssuedNumber ?? (range.startNumber - 1);
        const lastReported = range.lastReportedNumber ?? (range.startNumber - 1);
        return range.terminalId === context.terminalId && range.status !== 'BLOCKED'
            && (range.progressPending || lastIssued > lastReported);
    });
};

/** Called only after the existing master transport receives a successful ERP ACK. */
export const markNumberedMasterSynced = async (document: Record<string, any> | undefined): Promise<void> => {
    const rangeId = String(document?.master_number_range_id || '');
    const value = document?.master_number_value;
    if (!rangeId || !Number.isSafeInteger(value)) return;
    await dbAdapter.saveDocument('masterNumberSyncReceipts', {
        id: `${rangeId}:${value}`,
        rangeId,
        value,
        masterId: document?.id,
        terminalId: document?.source_terminal_id,
        confirmedAt: new Date().toISOString(),
    });
    notifyUpdated();
};

export const reportPendingMasterNumberRangeProgress = async (): Promise<number> => {
    if (!dbAdapter.markMasterNumberRangeProgressReported) return 0;
    // The new endpoint belongs to ERP, not to the local Master LAN API.
    if (syncPolicy.resolve().kind !== 'ERP_ACTIVE') return 0;
    const ranges = await getPendingMasterNumberRanges();
    if (!ranges.length) return 0;

    const context = await resolveProgressContext();
    if (!context.tenantId || !context.companyId || !context.terminalId) {
        throw new Error('MASTER_NUMBER_RANGE_PROGRESS_CONTEXT_MISSING');
    }

    const acknowledgements = await dbAdapter.getCollection<any>('masterNumberSyncReceipts');
    const readyRanges = ranges.flatMap(range => {
        let confirmed = range.lastReportedNumber ?? (range.startNumber - 1);
        const issued = range.lastIssuedNumber ?? (range.startNumber - 1);
        const confirmedValues = new Set((Array.isArray(acknowledgements) ? acknowledgements : [])
            .filter(row => row.rangeId === range.id && row.terminalId === context.terminalId)
            .map(row => Number(row.value)));
        while (confirmed < issued && confirmedValues.has(confirmed + 1)) confirmed += 1;
        return confirmed > (range.lastReportedNumber ?? (range.startNumber - 1))
            ? [{ range, lastIssuedNumber: confirmed }]
            : [];
    });
    if (!readyRanges.length) return 0;
    // One range per request lets an ownership rejection quarantine only that range.
    const batch = readyRanges.slice(0, 1);

    try {
        const response = await apiSyncAdapter.pushMasterNumberRangeProgress(context.terminalId, {
            tenant_id: context.tenantId,
            company_id: context.companyId,
            terminal_id: context.terminalId,
            ranges: batch.map(entry => ({
                range_id: entry.range.id,
                last_issued_number: entry.lastIssuedNumber,
            })),
        });
        if (response.httpStatus !== 200 || response.data?.status !== 'success') {
            throw new Error('MASTER_NUMBER_RANGE_PROGRESS_NOT_ACKNOWLEDGED');
        }
        for (const entry of batch) {
            await dbAdapter.markMasterNumberRangeProgressReported(entry.range.id, entry.lastIssuedNumber);
        }
        notifyUpdated();
        return batch.length;
    } catch (error: any) {
        const message = String(error?.message || '');
        const wrongTerminal = error?.code === 'MASTER_NUMBER_RANGE_SCOPE_MISMATCH'
            || /MASTER_NUMBER_RANGE_SCOPE_MISMATCH|el rango no pertenece a esta terminal|range.*does not belong/i.test(message);
        if (wrongTerminal && dbAdapter.blockMasterNumberRange) {
            for (const entry of batch) {
                await dbAdapter.blockMasterNumberRange(entry.range.id, 'RANGE_BELONGS_TO_ANOTHER_TERMINAL');
            }
            notifyUpdated();
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('masterNumberRangeRefreshRequired'));
            }
            await import('./SyncManager').then(({ syncManager }) =>
                syncManager.refreshTerminalResolvedConfig(undefined, { forceRemoteFetch: true }),
            ).catch(refreshError => {
                console.warn('[MasterNumberRanges] La configuración nueva sigue pendiente.', refreshError);
            });
        }
        throw error;
    }
};
