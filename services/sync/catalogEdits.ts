import { db } from '../../utils/db';
import { dbAdapter } from '../db';
import { apiSyncAdapter } from './ApiSyncAdapter';
import { readTerminalCredentialsSync } from './TerminalCredentialStore';
import { loadSyncProfile } from './SyncProfile';
import { CatalogEditQueue, type CatalogEdit, type CatalogScope } from './CatalogEditQueue';
import type { BusinessConfig, Permission, RoleDefinition, User } from '../../types';
import { v4 as uuid } from 'uuid';
import { buildStaleTaxConflictRebase, canonicalizeTaxMutationValues } from '../../utils/taxIdentity';
export const catalogEditsEnabled = () => import.meta.env.VITE_POS_CATALOG_EDITS_ENABLED === 'true';
export function catalogScopeMatches(scope: CatalogScope) {
    const profile = loadSyncProfile();
    const credentials = readTerminalCredentialsSync();
    const tenantId = credentials.erpTenantId || credentials.tenantId || profile.erpTenantId || profile.cloudTenantId;
    const deviceId = credentials.deviceId || localStorage.getItem('CLIC_POS_DEVICE_ID');
    const companyId = credentials.companyId || localStorage.getItem('clic_erp_sync_company_id');
    return catalogEditsEnabled() && profile.cloudChannel === 'ERP_ACTIVE'
        && profile.erpTerminalId === scope.terminalId
        && tenantId === scope.tenantId && Boolean(deviceId) && deviceId === scope.deviceId
        && (!companyId || companyId === scope.companyId)
        && (profile.erpBaseUrl || profile.cloudBaseUrl || '').replace(/\/$/, '') === scope.baseUrl.replace(/\/$/, '');
}
export const readCatalogEdits = async (): Promise<CatalogEdit[]> => ((await db.get('catalogEdits')) || []) as CatalogEdit[];

export function shouldShowCatalogEditInSyncMonitor(
    edit: Pick<CatalogEdit, 'status' | 'resolution'>,
    canViewConflicts: boolean,
): boolean {
    // Resolved edits remain in durable storage as an audit trail, but they no
    // longer belong to the operational queue shown in the sync monitor.
    if (edit.resolution) return false;
    return canViewConflicts || !['CONFLICT', 'REJECTED'].includes(String(edit.status || '').toUpperCase());
}

export const CATALOG_CONFLICT_PERMISSIONS = {
    view: 'POS_CATALOG_CONFLICT_VIEW',
    retry: 'POS_CATALOG_CONFLICT_RETRY',
    discard: 'POS_CATALOG_CONFLICT_DISCARD',
    acceptErp: 'POS_CATALOG_CONFLICT_ACCEPT_ERP',
    force: 'POS_CATALOG_CONFLICT_FORCE',
} as const satisfies Record<string, Permission>;

export function hasCatalogConflictPermission(user: User | null | undefined, roles: RoleDefinition[], permission: Permission): boolean {
    if (!user) return false;
    const roleId = String(user.roleId || user.role || '').trim().toUpperCase();
    const role = roles.find(candidate => String(candidate.id || '').trim().toUpperCase() === roleId);
    return Boolean(role?.permissions.includes('ALL') || role?.permissions.includes(permission));
}

async function persistConflictResolution(edits: CatalogEdit[]) {
    if (dbAdapter.saveDocumentsAtomically) {
        await dbAdapter.saveDocumentsAtomically(edits.map(document => ({ collectionName: 'catalogEdits', document })), false);
        return;
    }
    await Promise.all(edits.map(edit => db.saveDocument('catalogEdits', edit)));
}

export const canResolveCatalogEdit = (
    edit: Pick<CatalogEdit, 'status' | 'syncError'>,
    action: 'RETRY' | 'DISCARD' | 'ACCEPT_ERP' | 'FORCE',
): boolean => (
    ['CONFLICT', 'REJECTED'].includes(edit.status)
    || (action === 'DISCARD' && edit.status === 'PENDING' && Boolean(edit.syncError))
);

export async function resolveCatalogConflict(
    edit: CatalogEdit,
    action: 'RETRY' | 'DISCARD' | 'ACCEPT_ERP' | 'FORCE',
    actorId: string,
): Promise<CatalogEdit | null> {
    if (!actorId?.trim() || !canResolveCatalogEdit(edit, action)) {
        throw new Error('El cambio ya no tiene un conflicto pendiente de resolución.');
    }
    if (action === 'FORCE' && edit.conflictCurrent === undefined) {
        throw new Error('Actualiza el conflicto para obtener el valor vigente del ERP antes de forzar.');
    }
    const all = await readCatalogEdits();
    const current = all.find(candidate => candidate.id === edit.id);
    if (!current || !canResolveCatalogEdit(current, action)) {
        throw new Error('El conflicto cambió. Refresca la lista antes de continuar.');
    }
    const resolvedAt = new Date().toISOString();
    const resolution = action === 'ACCEPT_ERP' ? 'ERP_ACCEPTED' : action === 'DISCARD' ? 'DISCARDED' : action === 'FORCE' ? 'FORCED' : 'RETRIED';
    const resolved: CatalogEdit = {
        ...current, status: 'REJECTED', syncStatus: 'SYNCED', syncError: undefined,
        resolution, resolvedBy: actorId, resolvedAt,
        message: action === 'ACCEPT_ERP' ? 'Se aceptó el valor vigente del ERP.'
            : action === 'DISCARD' ? 'El cambio local fue descartado.'
            : action === 'FORCE' ? 'Se creó una actualización forzada autorizada.'
            : 'Se creó un nuevo intento autorizado.',
    };
    if (action === 'DISCARD' || action === 'ACCEPT_ERP') {
        const children = all.filter(candidate => candidate.dependsOn === current.id).map(candidate => ({
            ...candidate, dependsOn: undefined, status: 'PENDING' as const, syncStatus: 'PENDING' as const,
            syncError: undefined, nextAttemptAt: 0, message: 'Cambio desbloqueado tras resolver el conflicto anterior.',
        }));
        await persistConflictResolution([resolved, ...children]);
        return null;
    }
    const id = uuid();
    const followUp: CatalogEdit = {
        ...current,
        id,
        mutation: {
            ...current.mutation,
            id,
            actorId,
            before: action === 'FORCE' ? current.conflictCurrent! : current.mutation.before,
            conflictAction: action,
            resolvesMutationId: current.id,
        },
        status: 'PENDING', syncStatus: 'PENDING', syncError: undefined, message: undefined,
        conflictCurrent: undefined, resolution: undefined, resolvedBy: undefined, resolvedAt: undefined,
        attempts: 0, nextAttemptAt: 0, createdAt: resolvedAt, dependsOn: undefined,
    };
    const children = all.filter(candidate => candidate.dependsOn === current.id).map(candidate => ({
        ...candidate, dependsOn: id, status: 'PENDING' as const, syncStatus: 'PENDING' as const,
        syncError: undefined, nextAttemptAt: 0, message: 'Cambio desbloqueado y enlazado a la resolución anterior.',
    }));
    await persistConflictResolution([resolved, followUp, ...children]);
    void catalogEditQueue.process().catch(error => console.warn('Resolución guardada; envío pendiente:', error));
    return followUp;
}
export const catalogEditQueue = new CatalogEditQueue({
    read: readCatalogEdits, save: edit => db.saveDocument('catalogEdits', edit),
    matchesScope: catalogScopeMatches, now: Date.now,
    send: async edit => {
        let outboundEdit = edit;
        let currentTaxes: BusinessConfig['taxes'] | undefined;
        if (edit.mutation.domain === 'item_taxes' && edit.mutation.field === 'tax_ids') {
            const storedConfig = await db.get('config');
            const currentConfig = (Array.isArray(storedConfig) ? storedConfig[0] : storedConfig) as BusinessConfig | undefined;
            currentTaxes = currentConfig?.taxes;
            const repaired = canonicalizeTaxMutationValues(
                Array.isArray(edit.mutation.before) ? edit.mutation.before : [],
                Array.isArray(edit.mutation.after) ? edit.mutation.after : [],
                currentTaxes,
            );
            if (repaired.repaired) {
                outboundEdit = {
                    ...edit,
                    mutation: { ...edit.mutation, before: repaired.before, after: repaired.after },
                };
            }
        }
        let result = await apiSyncAdapter.sendCatalogEdit(outboundEdit);
        const staleTaxRebase = (
            result.status === 'CONFLICT'
            && result.code === 'VALUE_CHANGED'
            && edit.mutation.domain === 'item_taxes'
            && edit.mutation.field === 'tax_ids'
        ) ? buildStaleTaxConflictRebase(result.current, outboundEdit.mutation.after, currentTaxes) : null;
        if (staleTaxRebase) {
            const recoveryId = uuid();
            const recovered = await apiSyncAdapter.sendCatalogEdit({
                ...outboundEdit,
                id: recoveryId,
                mutation: {
                    ...outboundEdit.mutation,
                    id: recoveryId,
                    before: staleTaxRebase.before,
                    after: staleTaxRebase.after,
                    conflictAction: 'RETRY',
                    resolvesMutationId: edit.id,
                },
            });
            result = { ...recovered, id: edit.id };
        }
        if (result.status === 'APPLIED' && edit.mutation.domain === 'item_lifecycle' && edit.mutation.field === 'create'
            && edit.mutation.after && typeof edit.mutation.after === 'object' && !Array.isArray(edit.mutation.after)) {
            const { markNumberedMasterSynced } = await import('./MasterNumberRangeService');
            await markNumberedMasterSynced({ id: edit.mutation.recordId, ...edit.mutation.after });
        }
        return result;
    },
});
export function currentCatalogScope(): CatalogScope | null {
    const profile = loadSyncProfile();
    if (!catalogEditsEnabled() || profile.cloudChannel !== 'ERP_ACTIVE') return null;
    const credentials = readTerminalCredentialsSync();
    const scope: CatalogScope = {
        terminalId: profile.erpTerminalId || '',
        tenantId: credentials.erpTenantId || credentials.tenantId || profile.erpTenantId || profile.cloudTenantId || '',
        companyId: credentials.companyId || localStorage.getItem('clic_erp_sync_company_id') || '',
        deviceId: credentials.deviceId || localStorage.getItem('CLIC_POS_DEVICE_ID') || '',
        baseUrl: profile.erpBaseUrl || profile.cloudBaseUrl || '',
    };
    if (Object.values(scope).some(value => !value) || !catalogScopeMatches(scope)) {
        throw new Error('No se pudo guardar el cambio: la vinculación ERP está incompleta.');
    }
    return scope;
}
