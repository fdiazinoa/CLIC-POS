import type { BusinessConfig, TerminalConfigSnapshot } from '../../types';
import { db } from '../../utils/db';
import { loadSyncProfile, type SyncProfile } from './SyncProfile';

export const POS_CATALOG_EDIT_DISABLED_MESSAGE =
    'El ERP no autoriza cambios de catálogo para esta terminal. Activa "Permitir cambios de catálogo desde POS" y sincroniza la configuración.';

export type PosCatalogEditAuthorization = {
    allowed: boolean;
    governedByErp: boolean;
    reason: 'NOT_ERP_MANAGED' | 'ENABLED' | 'DISABLED' | 'CONFIG_MISSING';
};

const asRecord = (value: unknown): Record<string, any> =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, any>
        : {};

const readEnabled = (source: unknown): boolean | null => {
    const record = asRecord(source);
    const value = asRecord(record.posCatalogEdits).enabled
        ?? asRecord(record.pos_catalog_edits).enabled;
    return typeof value === 'boolean' ? value : null;
};

const readSnapshotEnabled = (snapshotValue: unknown): boolean | null => {
    const snapshot = asRecord(snapshotValue as TerminalConfigSnapshot);
    const terminal = asRecord(snapshot.terminal);
    const resolved = asRecord(snapshot.resolved);
    const resolvedTerminal = asRecord(resolved.terminal);
    const candidates = [
        asRecord(snapshot.config),
        asRecord(terminal.config),
        asRecord(resolvedTerminal.config),
        asRecord(resolved.config),
        asRecord(asRecord(snapshot.terminal_config).config),
        asRecord(asRecord(snapshot.terminalConfig).config),
    ];
    for (const candidate of candidates) {
        const enabled = readEnabled(candidate);
        if (enabled !== null) return enabled;
    }
    return null;
};

const terminalMatches = (terminal: BusinessConfig['terminals'][number], ids: Set<string>): boolean => {
    const terminalConfig = terminal?.config;
    const candidates = [
        terminal?.id,
        terminalConfig?.erpTerminalId,
        terminalConfig?.erpBinding?.terminalId,
        terminalConfig?.stationNumber,
    ].map(value => String(value || '').trim()).filter(Boolean);
    return candidates.some(candidate => ids.has(candidate));
};

export const resolvePosCatalogEditAuthorization = (
    config: BusinessConfig | null | undefined,
    profile: Pick<SyncProfile, 'contractedProduct' | 'cloudChannel' | 'localTerminalId' | 'erpTerminalId'>,
    terminalId?: string | null,
): PosCatalogEditAuthorization => {
    const governedByErp = profile.contractedProduct === 'POS_ERP' || profile.cloudChannel === 'ERP_ACTIVE';
    if (!governedByErp) return { allowed: true, governedByErp: false, reason: 'NOT_ERP_MANAGED' };

    if (!config || !Array.isArray(config.terminals)) {
        return { allowed: false, governedByErp: true, reason: 'CONFIG_MISSING' };
    }

    const ids = new Set([
        terminalId,
        profile.localTerminalId,
        profile.erpTerminalId,
    ].map(value => String(value || '').trim()).filter(Boolean));
    const terminal = config.terminals.find(candidate => terminalMatches(candidate, ids));
    if (!terminal) return { allowed: false, governedByErp: true, reason: 'CONFIG_MISSING' };

    const directEnabled = readEnabled(terminal.config);
    if (directEnabled !== null) {
        return { allowed: directEnabled, governedByErp: true, reason: directEnabled ? 'ENABLED' : 'DISABLED' };
    }

    const snapshots: unknown[] = [terminal.config?.erpSnapshot];
    const snapshotIds = [terminal.id, terminal.config?.erpTerminalId, terminal.config?.erpBinding?.terminalId];
    for (const snapshotId of snapshotIds) {
        if (snapshotId && config.terminalSnapshots?.[snapshotId]) snapshots.push(config.terminalSnapshots[snapshotId]);
    }
    for (const snapshot of snapshots) {
        const enabled = readSnapshotEnabled(snapshot);
        if (enabled !== null) {
            return { allowed: enabled, governedByErp: true, reason: enabled ? 'ENABLED' : 'DISABLED' };
        }
    }

    return { allowed: false, governedByErp: true, reason: 'CONFIG_MISSING' };
};

export const resolveCurrentPosCatalogEditAuthorization = (
    config: BusinessConfig | null | undefined,
    terminalId?: string | null,
): PosCatalogEditAuthorization => resolvePosCatalogEditAuthorization(config, loadSyncProfile(), terminalId);

export const assertCurrentPosCatalogEditAuthorized = async (): Promise<void> => {
    const profile = loadSyncProfile();
    if (profile.contractedProduct !== 'POS_ERP' && profile.cloudChannel !== 'ERP_ACTIVE') return;
    const stored = await db.get('config');
    const config = (Array.isArray(stored) ? stored[0] : stored) as BusinessConfig | null | undefined;
    const authorization = resolvePosCatalogEditAuthorization(config, profile, profile.localTerminalId || profile.erpTerminalId);
    if (!authorization.allowed) throw new Error(POS_CATALOG_EDIT_DISABLED_MESSAGE);
};
