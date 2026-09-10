import { db } from '../../utils/db';
import { apiSyncAdapter } from './ApiSyncAdapter';
import { readTerminalCredentialsSync } from './TerminalCredentialStore';
import { loadSyncProfile } from './SyncProfile';
import { CatalogEditQueue, type CatalogEdit, type CatalogScope } from './CatalogEditQueue';
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
