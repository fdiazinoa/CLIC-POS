import { v4 as uuid } from 'uuid';
import { dbAdapter } from '../db';
import { LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED } from './LargeMasterSyncV3Authority';
import { readLargeMasterSyncV3BoundIdentity } from './LargeMasterSyncV3BoundTransport';
import { largeMasterSyncV3DownloadOrigin } from './LargeMasterSyncV3DownloadOrigin';
import { v3BindingKey } from './LargeMasterSyncV3OperationalSession';
import { LargeMasterSyncV3Error, type LargeMasterSyncV3Store, type LargeMasterSyncV3RuntimeVersion,
  type V3ProductionCatalogRequest, type V3ProductionCatalogPage, type V3ProductionArticle } from './LargeMasterSyncV3Types';
import type { CatalogEdit } from './CatalogEditQueue';
import { catalogEditQueue, currentCatalogScope, catalogScopeMatches, readCatalogEdits } from './catalogEdits';
import { assertCurrentPosCatalogEditAuthorized } from './catalogEditAuthorization';
import { readTerminalCredentialsSync } from './TerminalCredentialStore';
import { apiSyncAdapter } from './ApiSyncAdapter';

export type ProductionReadDependencies = { enabled: boolean; store?: LargeMasterSyncV3Store;
  identity: typeof readLargeMasterSyncV3BoundIdentity; origin: () => string; context?: () => string };
const defaults = (): ProductionReadDependencies => ({ enabled: LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED,
  store: dbAdapter.masterSyncV3Store, identity: readLargeMasterSyncV3BoundIdentity, origin: largeMasterSyncV3DownloadOrigin, context: () => JSON.stringify([readTerminalCredentialsSync().companyId,
    globalThis.localStorage?.getItem('clic_erp_sync_company_id')]) });

/** No sales warehouse, tariff, inventory anchor, network or legacy master dependency. */
export class ProductionCatalogV3 {
  private constructor(private deps: ProductionReadDependencies, readonly version: LargeMasterSyncV3RuntimeVersion,
    readonly binding: string, private token: string, private origin: string, private context: string) {}
  static async open(deps = defaults(), getContext?: () => string) {
    if (getContext) deps = {...deps,context:getContext};
    if (!deps.enabled || !deps.store?.readProductionCatalogPage || !deps.store.getOperationalOwner)
      throw new LargeMasterSyncV3Error('SYNC_V3_PRODUCTION_ADMIN_UNAVAILABLE');
    const identity = deps.identity(), origin = deps.origin(), binding = v3BindingKey(identity, origin), context = deps.context?.() || '';
    const version = await deps.store.getActiveRuntimeVersion();
    if (!version || (version.contractVersion || 1) < 2) throw new LargeMasterSyncV3Error('SYNC_V3_CATALOG_NOT_READY');
    const reader = new ProductionCatalogV3(deps, version, binding, identity.syncToken, origin, context);
    await reader.assertCurrent(); return reader;
  }
  async assertCurrent() {
    const assertIdentity = () => {
      const current = this.deps.identity();
      if ((this.deps.context?.() || '') !== this.context || current.syncToken !== this.token || this.deps.origin() !== this.origin
        || v3BindingKey(current, this.origin) !== this.binding) throw new LargeMasterSyncV3Error('SYNC_V3_CATALOG_CONTEXT_CHANGED');
    };
    assertIdentity();
    const [version, owner] = await Promise.all([this.deps.store!.getActiveRuntimeVersion(),this.deps.store!.getOperationalOwner!()]);
    if (version?.syncId !== this.version.syncId || version.syncVersion !== this.version.syncVersion
      || owner?.binding !== this.binding || owner.syncId !== this.version.syncId || owner.syncVersion !== this.version.syncVersion)
      throw new LargeMasterSyncV3Error('SYNC_V3_CATALOG_VERSION_CHANGED');
    assertIdentity();
  }
  async page(request: V3ProductionCatalogRequest): Promise<V3ProductionCatalogPage> {
    await this.assertCurrent(); const page = await this.deps.store!.readProductionCatalogPage!(this.version,request);
    await this.assertCurrent(); return page;
  }
}
export const isProductionRoutingEdit = (edit: CatalogEdit) => edit.mutation.domain === 'item_operations'
  && edit.mutation.field === 'production_area_id';
export function routingSnapshotConfirms(edit: CatalogEdit, reader: Pick<ProductionCatalogV3,'binding'|'version'>, row: V3ProductionArticle) {
  const source = edit.routingSnapshot;
  return edit.status === 'APPLIED' && !edit.resolution && source?.binding === reader.binding
    && source.syncId !== reader.version.syncId && row.id === edit.mutation.recordId
    && row.productionAreaId === edit.mutation.after;
}

let writes: Promise<unknown> = Promise.resolve();
/** Freeze a bounded displayed page. Durable intents only, never Product or native master writes. */
export function enqueueProductionRouting(reader: ProductionCatalogV3, rows: readonly V3ProductionArticle[],
  target: string | null, actorId: string): Promise<void> {
  const work = async () => {
    if (!actorId.trim() || rows.length > 100 || new Set(rows.map(row=>row.id)).size !== rows.length)
      throw new Error('Selección de artículos inválida.');
    await reader.assertCurrent(); await assertCurrentPosCatalogEditAuthorized();
    const scope = currentCatalogScope();
    if (!scope || !await apiSyncAdapter.productionRoutingCapability(true)) throw new Error('El ERP aún no admite asignar centros desde POS. Actualiza el ERP o realiza la asignación allí y sincroniza.');
    if (!dbAdapter.saveDocumentsAtomically) throw new Error('Guardado atómico no disponible.');
    const previous = (await readCatalogEdits()).filter(edit=>isProductionRoutingEdit(edit) && catalogScopeMatches(edit.scope));
    const changed = rows.filter(row=>row.productionAreaId !== target);
    if (changed.some(row=>previous.some(edit=>edit.mutation.recordId===row.id && !edit.resolution
      && (edit.status !== 'APPLIED' || !edit.snapshotConfirmedAt)))) throw new Error('Hay cambios pendientes o conflictos para estos artículos. Revísalos en el monitor de sincronización.');
    const edits: CatalogEdit[] = changed.map((row,index)=>{
      const id=uuid(); return {id,scope,label:row.name,terminalId:scope.terminalId,
        mutation:{id,recordId:row.id,domain:'item_operations',field:'production_area_id',before:row.productionAreaId,after:target,actorId},
        status:'PENDING',syncStatus:'PENDING',attempts:0,nextAttemptAt:0,createdAt:new Date(Date.now()+index).toISOString(),
        routingSnapshot:{binding:reader.binding,syncId:reader.version.syncId}};
    });
    await reader.assertCurrent();
    if (!catalogScopeMatches(scope)) throw new Error('La vinculación cambió.');
    await dbAdapter.saveDocumentsAtomically(edits.map(document=>({collectionName:'catalogEdits',document,requireAbsent:true,v3CurrentCatalog:{...reader.version,binding:reader.binding}})),false);
    window.dispatchEvent(new CustomEvent('productionRoutingQueueUpdated'));
    void catalogEditQueue.process().catch(error=>console.warn('Asignación guardada; envío pendiente:',error));
  };
  const result = writes.then(work,work); writes=result.catch(()=>undefined); return result;
}

/** One queue read per displayed page, with canonical post-ACK generation/value confirmation. */
export async function productionRoutingStates(reader: ProductionCatalogV3, rows: readonly V3ProductionArticle[]) {
  const ids = new Set(rows.map(row=>row.id));
  const edits = (await readCatalogEdits()).filter(edit=>isProductionRoutingEdit(edit) && ids.has(edit.mutation.recordId)
    && catalogScopeMatches(edit.scope) && !edit.resolution);
  await reader.assertCurrent();
  const confirmations = edits.filter(edit=>!edit.snapshotConfirmedAt && rows.some(row=>routingSnapshotConfirms(edit,reader,row)));
  if (confirmations.length) {
    if (!dbAdapter.saveDocumentsAtomically) throw new Error('Guardado atómico no disponible.');
    await dbAdapter.saveDocumentsAtomically(confirmations.map(edit=>({collectionName:'catalogEdits',expectedDocument:JSON.stringify(edit),v3CurrentCatalog:{...reader.version,binding:reader.binding},document:{...edit,snapshotConfirmedAt:new Date().toISOString()}})),false);
  }
  await reader.assertCurrent();
  return Object.fromEntries(edits.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).map(edit=>[edit.mutation.recordId,
    confirmations.includes(edit) || edit.snapshotConfirmedAt ? 'Confirmado por catálogo ERP'
    : edit.status==='APPLIED' ? 'Aplicado en ERP; esperando catálogo actualizado'
    : edit.status==='PENDING' ? 'Pendiente de envío al ERP'
    : `${edit.status}: ${edit.message || edit.syncError || ''}`]));
}
