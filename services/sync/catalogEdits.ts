import { v4 as uuid } from 'uuid';
import { db } from '../../utils/db';
import { apiSyncAdapter } from './ApiSyncAdapter';
import { readTerminalCredentialsSync } from './TerminalCredentialStore';
import { loadSyncProfile } from './SyncProfile';
import { CatalogEditQueue, type CatalogEdit, type CatalogScope, type CatalogMutation } from './CatalogEditQueue';
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
export const catalogEditQueue = new CatalogEditQueue({
    read: readCatalogEdits, save: edit => db.saveDocument('catalogEdits', edit),
    matchesScope: catalogScopeMatches, now: Date.now,
    send: edit => apiSyncAdapter.sendCatalogEdit(edit),
});
export async function queueCatalogEdit(scope: CatalogScope, mutation: Omit<CatalogMutation, 'id'>, label: string) {
    if (!catalogScopeMatches(scope)) throw new Error('La vinculación cambió. Vuelve a consultar el catálogo del ERP.');
    if (!mutation.actorId) throw new Error('Inicia sesión para enviar cambios.');
    if (mutation.before === mutation.after) throw new Error('El valor no ha cambiado.');
    const pending = (await readCatalogEdits()).some(edit => edit.status === 'PENDING'
        && edit.scope.terminalId === scope.terminalId && edit.scope.tenantId === scope.tenantId
        && edit.mutation.recordId === mutation.recordId && edit.mutation.field === mutation.field);
    if (pending) throw new Error('Este dato ya tiene un cambio pendiente. Espera la confirmación del ERP.');
    const id = uuid();
    const edit: CatalogEdit = { id, scope, mutation: { ...mutation, id }, label,
        status: 'PENDING', attempts: 0, nextAttemptAt: 0, createdAt: new Date().toISOString() };
    await db.saveDocument('catalogEdits', edit);
    void catalogEditQueue.process().catch(error => console.warn('Catalog edit queue remains pending:', error));
}
