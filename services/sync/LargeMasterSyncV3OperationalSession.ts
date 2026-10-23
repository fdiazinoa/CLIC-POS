import {readOfflineV3OperationalAuthority,type V3LocalOperationalIdentity,type V3OfflineOperationalAuthority} from './OfflineV3OperationalIdentity';
import {readOperationalCatalogBindingProof} from './OperationalTerminalConfig';
import {resolveSyncTarget} from './SyncProfile';
import {assertInventoryPresentationEligible} from '../inventoryPresentations/eligibility';
import Decimal from 'decimal.js';
import {createPresentationRuntime,presentationAuthority,validatePresentationCart} from '../inventoryPresentations/runtime';
import {presentationInventoryQuantity} from '../inventoryPresentations/selection';
import { assertV3ReservationSource, assertV3ReservationLines, validateV3ReservationPricing } from './LargeMasterSyncV3ReservationAuthority';
import {requiresProductStockAvailability} from '../../utils/productStockPolicy';
import { v3TaxSemantics } from './LargeMasterSyncV3StockAuthority';
import { db } from '../../utils/db';
import { readV3RetainedCheckout, assertV3RetainedLine, type V3RetainedContext, type V3RetainedReference } from './LargeMasterSyncV3RetainedCheckout';
import { v3StockSource, sameV3StockAuthority, v3RetainedLineFingerprint } from './LargeMasterSyncV3StockAuthority';
import { assertLargeMasterSyncV3NativeAndroid } from './LargeMasterSyncV3Platform';
import type { BusinessConfig, CartItem, Product, ProductVariant, TaxDefinition, V3SaleAuthorityStamp, Transaction } from '../../types';
import { dbAdapter } from '../db';
import { LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED } from './LargeMasterSyncV3Authority';
import { LARGE_MASTER_SYNC_V3_CANARY, validateLargeMasterSyncV3CanaryUrl } from './LargeMasterSyncV3Canary';
import { readOperationalTerminalBinding } from './OperationalTerminalConfig';
import { readLargeMasterSyncV3BoundIdentity, type LargeMasterSyncV3BoundIdentity } from './LargeMasterSyncV3BoundTransport';
import { prepareLargeMasterSyncV3Candidate, prepareLargeMasterSyncV3CatalogOnly, prepareLargeMasterSyncV3UnusedBaseline, type LargeMasterSyncV3CandidateReady } from './LargeMasterSyncV3Candidate';
import { LargeMasterSyncV3Runtime } from './LargeMasterSyncV3Runtime';
import { LargeMasterSyncV3OperationalCatalog } from './LargeMasterSyncV3OperationalCatalog';
import { buildLargeMasterSyncV3CheckoutFiscalInput } from './LargeMasterSyncV3CheckoutAuthority';
import { LargeMasterSyncV3Error, type LargeMasterSyncV3Store, type LargeMasterSyncV3IdentityReadContext } from './LargeMasterSyncV3Types';
import { requiresV3SaleAvailability, type V3FinancialIntent } from './LargeMasterSyncV3RefundAuthority';
import type { DurableDocumentMutation } from '../db/DatabaseAdapter';
import { validateV3PinnedLineSource } from './LargeMasterSyncV3LineSource';
import { largeMasterSyncV3DownloadOrigin } from './LargeMasterSyncV3DownloadOrigin';
import { createLargeMasterSyncV3SessionCoordinator } from './LargeMasterSyncV3SetupCompletion';
import type { LargeMasterSyncV3Metric } from './LargeMasterSyncV3Client';

export const v3BindingKey = (identity: Omit<LargeMasterSyncV3BoundIdentity,'syncToken'>, v3BaseUrl: string): string =>
  JSON.stringify([identity.tenantId, identity.terminalId, identity.deviceId,
    identity.erpSyncBaseUrl, validateLargeMasterSyncV3CanaryUrl(v3BaseUrl)]);

export const v3InventoryBaselineKey = (binding: string, stamp: V3SaleAuthorityStamp): string =>
  JSON.stringify([binding, v3StockSource(stamp).syncId, v3StockSource(stamp).syncVersion, stamp.inventoryVersion, stamp.inventoryCursor]);

export type V3CodeMatch = { product: Product; quantity: number; price: number; modifiers: string[];
  selectedVariant?: ProductVariant; variantInfo?: string };

/** One bound, immutable baseline. ACK never removes local stock movements. */
export class LargeMasterSyncV3OperationalSession {
  private constructor(
    readonly ready: LargeMasterSyncV3CandidateReady,
    readonly binding: string,
    private readonly store: LargeMasterSyncV3Store,
    private readonly v3BaseUrl: string,
    private readonly identity: V3LocalOperationalIdentity,
    private offlineAuthority?:V3OfflineOperationalAuthority,
    private readonly expectedConfigScope?:string,
    private readonly setupCredentialGuard?:string,
  ) {}

  static async open(refresh = false, metric?: (metric: LargeMasterSyncV3Metric) => void): Promise<LargeMasterSyncV3OperationalSession> {
    const observe = (event: LargeMasterSyncV3Metric) => { try { metric?.(event); } catch { /* Observer only. */ } };
    if (!LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED || LARGE_MASTER_SYNC_V3_CANARY) {
      throw new LargeMasterSyncV3Error('SYNC_V3_OPERATIONAL_BUILD_REQUIRED');
    }
    assertLargeMasterSyncV3NativeAndroid();
    const v3BaseUrl = largeMasterSyncV3DownloadOrigin();
    let identity:V3LocalOperationalIdentity,offlineAuthority:V3OfflineOperationalAuthority|undefined;
    try{identity=readLargeMasterSyncV3BoundIdentity();}catch(error){try{offlineAuthority=await readOfflineV3OperationalAuthority();identity=offlineAuthority.identity;}catch{throw error;}}
    const binding = v3BindingKey(identity, v3BaseUrl);
    const credentialGuard = readOperationalTerminalBinding();
    await dbAdapter.connect();
    const configScope = (config: BusinessConfig) => {
      const terminal=config?.terminals?.find(row => row.config?.currentDeviceId === identity.deviceId
        && (row.config.erpTerminalId || row.id) === identity.terminalId);
      return JSON.stringify([terminal?.config.erpBinding?.companyId,terminal?.config.inventoryScope,
        terminal?.config.pricing,terminal?.config.fiscal]);
    };
    const expectedScope=configScope(await db.get('config') as unknown as BusinessConfig);
    const assertIdentity = async (owned?: LargeMasterSyncV3IdentityReadContext) => {
      const currentScope=configScope(owned ? await owned.readConfig() : await db.get('config') as unknown as BusinessConfig);
      if(largeMasterSyncV3DownloadOrigin()!==v3BaseUrl||currentScope!==expectedScope)throw new LargeMasterSyncV3Error('SYNC_V3_BINDING_CHANGED');
      try{if(JSON.stringify(readLargeMasterSyncV3BoundIdentity())!==JSON.stringify(identity)||readOperationalTerminalBinding()!==credentialGuard)throw new LargeMasterSyncV3Error('SYNC_V3_BINDING_CHANGED');}
      catch(error){
        // Download/activation owns its SQL connection and retains live transport authority.
        if(owned)throw error;
        let local:V3OfflineOperationalAuthority;try{local=await readOfflineV3OperationalAuthority();}catch{throw error;}
        if(v3BindingKey(local.identity,v3BaseUrl)!==binding)throw new LargeMasterSyncV3Error('SYNC_V3_BINDING_CHANGED');
        offlineAuthority=local;
      }
    };
    await assertIdentity();
    const store = dbAdapter.masterSyncV3Store;
    if (!store?.getOperationalOwner || !store.setOperationalOwner || !store.getLocalInventoryDelta) {
      throw new LargeMasterSyncV3Error('SYNC_V3_NATIVE_STORE_UNAVAILABLE');
    }
    let ready: LargeMasterSyncV3CandidateReady | null = null;
    const runtime = await LargeMasterSyncV3Runtime.open(store);
    const owner = await store.getOperationalOwner();
    if (owner && owner.binding !== binding) throw new LargeMasterSyncV3Error('SYNC_V3_BINDING_CHANGED');
    if (!refresh && runtime && (runtime.version.contractVersion || 1) >= 2 && owner?.binding === binding
      && owner.syncId === runtime.version.syncId && owner.syncVersion === runtime.version.syncVersion) {
      const inventory = await runtime.getInventorySnapshotVersion();
      if (inventory) {
        const anchor = await store.getInventoryAuthority?.();
        ready = { runtime, inventoryVersion: inventory.version, inventoryCursor: inventory.cursor,
          ...(anchor && (anchor.syncId !== runtime.version.syncId || anchor.syncVersion !== runtime.version.syncVersion)
            ? { inventorySyncId: anchor.syncId, inventorySyncVersion: anchor.syncVersion } : {}) };
      }
    }
    if(!ready&&offlineAuthority)throw new LargeMasterSyncV3Error('SYNC_V3_OFFLINE_CACHED_RUNTIME_REQUIRED');
    if (!ready) {
      const anchor = await store.getInventoryAuthority?.();
      const catalogOnly = Boolean(refresh && runtime && owner?.binding === binding && anchor);
      if (catalogOnly) {
        try { ready = await prepareLargeMasterSyncV3CatalogOnly(store, v3BaseUrl, binding, observe, undefined, assertIdentity); }
        catch (error) {
          if (!(error instanceof LargeMasterSyncV3Error) || error.code !== 'SYNC_V3_CATALOG_SEMANTICS_CHANGED') throw error;
          ready = await prepareLargeMasterSyncV3UnusedBaseline(store, v3BaseUrl,
            { expectedCatalog: runtime!.version, inventory: anchor!, binding, assertIdentity }, observe);
        }
      } else ready = await prepareLargeMasterSyncV3Candidate(store, v3BaseUrl, observe);
      await assertIdentity();
      observe({ event: 'setup_phase', phase: 'owner' });
      if (!catalogOnly) await store.setOperationalOwner(ready.runtime.version, binding);
    } else {
      observe({ event: 'setup_phase', phase: 'cached' });
    }
    return new LargeMasterSyncV3OperationalSession(ready, binding, store, v3BaseUrl, identity,offlineAuthority,expectedScope,credentialGuard);
  }

  async assertCurrent(): Promise<void> {
    assertLargeMasterSyncV3NativeAndroid();
    try{
      const current=readLargeMasterSyncV3BoundIdentity();
      if(v3BindingKey(current,this.v3BaseUrl)!==this.binding||current.syncToken!==this.identity.syncToken)throw new LargeMasterSyncV3Error('SYNC_V3_BINDING_CHANGED');
      this.offlineAuthority=undefined;
    }catch(error){
      let local:V3OfflineOperationalAuthority;try{local=await readOfflineV3OperationalAuthority();}catch{throw error;}
      if(v3BindingKey(local.identity,largeMasterSyncV3DownloadOrigin())!==this.binding)throw new LargeMasterSyncV3Error('SYNC_V3_BINDING_CHANGED');
      this.offlineAuthority=local;
    }
    if(this.expectedConfigScope!==undefined){
    const config=await db.get('config') as unknown as BusinessConfig;
    const terminal=config?.terminals?.find(row=>row.config?.currentDeviceId===this.identity.deviceId&&(row.config.erpTerminalId||row.id)===this.identity.terminalId);
    if(this.expectedConfigScope!==undefined&&JSON.stringify([terminal?.config.erpBinding?.companyId,terminal?.config.inventoryScope,terminal?.config.pricing,terminal?.config.fiscal])!==this.expectedConfigScope)throw new LargeMasterSyncV3Error('SYNC_V3_BINDING_CHANGED');
    }
    const active = await this.store.getActiveRuntimeVersion();
    const inventory = await this.ready.runtime.getInventorySnapshotVersion();
    const owner = await this.store.getOperationalOwner!();
    if (active?.syncId !== this.ready.runtime.version.syncId
      || active.syncVersion !== this.ready.runtime.version.syncVersion
      || inventory?.version !== this.ready.inventoryVersion || inventory.cursor !== this.ready.inventoryCursor
      || owner?.binding !== this.binding || owner.syncId !== active.syncId || owner.syncVersion !== active.syncVersion) {
      throw new LargeMasterSyncV3Error('SYNC_V3_RUNTIME_VERSION_CHANGED');
    }
  }

  /** Pairing-only synchronous guard. Raw credentials/profile include the captured company/tenant/device/token.
   * Never call async identity recovery or a DB getter while the native CAS owns its writer lane. */
  assertSetupIdentity(): void {
    assertLargeMasterSyncV3NativeAndroid();
    if (this.setupCredentialGuard === undefined
      || readOperationalTerminalBinding() !== this.setupCredentialGuard
      || largeMasterSyncV3DownloadOrigin() !== this.v3BaseUrl) {
      throw new LargeMasterSyncV3Error('SYNC_V3_BINDING_CHANGED');
    }
  }

  assertFinancialOfflineAuthority(transaction:Transaction):void {
    if(!this.offlineAuthority)return;
    if(!transaction.fiscalOfflineLeaseId||!transaction.fiscalWorkflowCheckoutId||transaction.documentType!=='TICKET'
      ||!transaction.items.length||transaction.items.some(line=>line.quantity<=0||line.articleFormat)
      ||transaction.payments.some(payment=>payment.method!=='CASH'))throw new LargeMasterSyncV3Error('SYNC_V3_OFFLINE_FINANCIAL_AUTHORITY_REQUIRED');
    const recovery=this.offlineAuthority.recovery;if(!recovery)return;
    let cart:any;try{cart=JSON.parse(recovery.cartIdentity);}catch{throw new LargeMasterSyncV3Error('SYNC_V3_OFFLINE_FINANCIAL_AUTHORITY_REQUIRED');}
    if(transaction.id!==recovery.transactionId||transaction.fiscalWorkflowCheckoutId!==recovery.checkoutId||transaction.fiscalOfflineLeaseId!==recovery.leaseId
      ||(cart.customerId||null)!==(transaction.customerId||null)||cart.fiscalType!==transaction.ncfType
      ||JSON.stringify(cart.fiscalSaleContext)!==JSON.stringify(transaction.fiscalSaleContext)
      ||!Array.isArray(cart.items)||cart.items.length!==transaction.items.length||transaction.items.some(line=>{
        const originals=cart.items.filter((old:CartItem)=>old.id===line.id&&old.cartId===line.cartId);
        return originals.length!==1||originals[0].quantity!==line.quantity||v3RetainedLineFingerprint(originals[0])!==v3RetainedLineFingerprint(line);
      })||transaction.payments.length!==recovery.paymentIds.length||transaction.payments.some(payment=>!recovery.paymentIds.includes(payment.id)))throw new LargeMasterSyncV3Error('SYNC_V3_OFFLINE_FINANCIAL_AUTHORITY_REQUIRED');
  }

  async catalog(tariffId: string, warehouseId: string) {
    await this.assertCurrent();
    return LargeMasterSyncV3OperationalCatalog.open(this.ready, tariffId, warehouseId);
  }

  async projectConfig(config: BusinessConfig): Promise<BusinessConfig> {
    const [tariffs, sourceTaxes] = await Promise.all([
      this.ready.runtime.getOperationalTariffs(), this.ready.runtime.getOperationalTaxes(),
    ]);
    const taxes: TaxDefinition[] = sourceTaxes.map(row => {
      const type = row.type === 'SALES' ? 'VAT' : row.type;
      if (!['VAT', 'SERVICE_CHARGE', 'EXEMPT'].includes(String(type)) || typeof row.rate !== 'number'
        || !Number.isFinite(row.rate) || row.rate < 0 || row.rate > 1) {
        throw new LargeMasterSyncV3Error('SYNC_V3_TAX_INVALID');
      }
      return { id: String(row.id), code: typeof row.code === 'string' ? row.code : undefined,
        name: String(row.name), rate: row.rate, active: row.active !== false, type: type as TaxDefinition['type'] };
    });
    return { ...config, taxes, taxRate: 0, tariffs: tariffs.map(row => {
      if (typeof row.taxIncluded !== 'boolean') throw new LargeMasterSyncV3Error('SYNC_V3_TARIFF_UNAVAILABLE');
      return { ...row, id: String(row.id), name: String(row.name), taxIncluded: row.taxIncluded };
    }) as BusinessConfig['tariffs'] };
  }

  async withStock(product: Product, warehouseId: string): Promise<Product> {
    const stamp = product.v3SaleAuthority;
    if (!stamp) throw new LargeMasterSyncV3Error('SYNC_V3_CART_LEGACY_LINE');
    if(product.type==='SERVICE'||product.isInventoriable!==true||!requiresProductStockAvailability(product))return {...product,v3SaleAuthority:{...stamp,binding:this.binding,warehouseId}};
    const baseline=v3InventoryBaselineKey(this.binding,stamp);
    if(!this.store.getOperationalStockProjection&&!Number.isFinite(product.stock))throw new LargeMasterSyncV3Error('SYNC_V3_INVENTORY_NOT_READY');
    const projection=this.store.getOperationalStockProjection ? await this.store.getOperationalStockProjection(baseline,[product.id],warehouseId)
      : {mode:'LEGACY_DELTA' as const,quantities:{[product.id]:await this.store.getLocalInventoryDelta!(baseline,product.id,warehouseId)}};
    if(projection.mode==='RECONCILED_AVAILABLE'&&!Object.prototype.hasOwnProperty.call(projection.quantities,product.id))throw new LargeMasterSyncV3Error('SYNC_V3_INVENTORY_NOT_READY');
    const value=projection.quantities[product.id] ?? 0;
    if(!Number.isFinite(value)||projection.mode==='LEGACY_DELTA'&&!Number.isFinite(product.stock))throw new LargeMasterSyncV3Error('SYNC_V3_INVENTORY_NOT_READY');
    return { ...product, v3SaleAuthority: { ...stamp, binding: this.binding, warehouseId },
      stock:projection.mode==='RECONCILED_AVAILABLE'?value:product.stock+value,
      stockBalances:{...product.stockBalances,[warehouseId]:projection.mode==='RECONCILED_AVAILABLE'?value:(product.stockBalances?.[warehouseId] || 0)+value} };
  }

  async withStocks(products: Product[], warehouseId: string): Promise<Product[]> {
    if (!products.length) return [];
    const stamp = products[0].v3SaleAuthority;
    if (!stamp) throw new LargeMasterSyncV3Error('SYNC_V3_NATIVE_STORE_UNAVAILABLE');
    const checked=products.filter(p=>p.type!=='SERVICE'&&p.isInventoriable===true&&requiresProductStockAvailability(p));
    if(checked.length&&!this.store.getOperationalStockProjection&&(!this.store.getLocalInventoryDeltas||checked.some(p=>!Number.isFinite(p.stock))))throw new LargeMasterSyncV3Error('SYNC_V3_INVENTORY_NOT_READY');
    const baseline=v3InventoryBaselineKey(this.binding,stamp);
    const projection=checked.length ? this.store.getOperationalStockProjection
      ? await this.store.getOperationalStockProjection(baseline,checked.map(p=>p.id),warehouseId)
      : {mode:'LEGACY_DELTA' as const,quantities:await this.store.getLocalInventoryDeltas!(baseline,checked.map(p=>p.id),warehouseId)}
      : {mode:'LEGACY_DELTA' as const,quantities:{}};
    if(projection.mode==='RECONCILED_AVAILABLE'&&checked.some(p=>!Object.prototype.hasOwnProperty.call(projection.quantities,p.id)))throw new LargeMasterSyncV3Error('SYNC_V3_INVENTORY_NOT_READY');
    if(Object.values(projection.quantities).some(d=>!Number.isFinite(d))||projection.mode==='LEGACY_DELTA'&&checked.some(p=>!Number.isFinite(p.stock)))throw new LargeMasterSyncV3Error('SYNC_V3_INVENTORY_NOT_READY');
    return products.map(product => {
      const value=projection.quantities[product.id] ?? 0;
      const absolute=projection.mode==='RECONCILED_AVAILABLE'&&Object.prototype.hasOwnProperty.call(projection.quantities,product.id);
      return {...product,v3SaleAuthority:{...product.v3SaleAuthority!,binding:this.binding,warehouseId},
        stock:absolute?value:product.stock+value,
        stockBalances:{...product.stockBalances,[warehouseId]:absolute?value:(product.stockBalances?.[warehouseId] || 0)+value}};
    });
  }

  async validate(config: BusinessConfig, lines: CartItem[], tariffId: string, warehouseId: string,
    intent: V3FinancialIntent = 'SALE', onValidatedSource?: (line: CartItem, source: Product) => void, reference?: V3RetainedReference, fiscalDeliveryOnly = false): Promise<V3RetainedContext | undefined> {
    await this.assertCurrent();
    if (!lines.length) throw new LargeMasterSyncV3Error('SYNC_V3_CART_EMPTY');
    let presentationProof:Awaited<ReturnType<LargeMasterSyncV3OperationalSession['presentationProof']>>;
    if(!fiscalDeliveryOnly&&lines.some(line=>line.inventoryPresentation!==undefined)){if(intent==='REFUND')throw Error('INVENTORY_PRESENTATION_SOURCE_REQUIRED_NOT_YET_SUPPORTED');presentationProof=await this.presentationProof(config,lines);}
    const authority = lines[0].v3SaleAuthority;
    if (!authority || authority.binding !== this.binding || authority.warehouseId !== warehouseId
      || authority.tariffId !== tariffId || authority.inventoryVersion !== this.ready.inventoryVersion
      || authority.inventoryCursor !== this.ready.inventoryCursor) throw new LargeMasterSyncV3Error('SYNC_V3_CART_MIXED_VERSION');
    const retained = await readV3RetainedCheckout(reference, intent === 'REFUND');
    if (retained?.reservation) { assertV3ReservationSource(retained.reservation,this.binding,warehouseId); assertV3ReservationLines(retained.reservation,lines); validateV3ReservationPricing(retained.reservation,config); }
    const anchor = await this.store.getInventoryAuthority?.() || { syncId: this.ready.inventorySyncId || this.ready.runtime.version.syncId,
      syncVersion: this.ready.inventorySyncVersion ?? this.ready.runtime.version.syncVersion,
      version: this.ready.inventoryVersion, cursor: this.ready.inventoryCursor };
    const currentCatalog = await this.catalog(tariffId, warehouseId);
    const sourceCatalogs = new Map<string, LargeMasterSyncV3OperationalCatalog>();
    let currentTaxes: Promise<Record<string, unknown>[]> | undefined;
    const sourceTaxes = new Map<string, Promise<Record<string, unknown>[]>>();
    const sourceFor = async (line: CartItem) => {
      const stamp = line.v3SaleAuthority;
      if (!stamp || stamp.binding !== this.binding || stamp.warehouseId !== warehouseId || stamp.tariffId !== tariffId
        || stamp.taxIncluded !== authority.taxIncluded || !sameV3StockAuthority(stamp, anchor)) {
        throw new LargeMasterSyncV3Error('SYNC_V3_CART_MIXED_VERSION');
      }
      if (stamp.syncId === this.ready.runtime.version.syncId && stamp.syncVersion === this.ready.runtime.version.syncVersion) {
        return currentCatalog.get(line.id);
      }
      assertV3RetainedLine(line, retained);
      // Delivery of an already committed invoice is distinct from a new sale/refund checkout.
      if (!fiscalDeliveryOnly) {
        const epoch = JSON.stringify([stamp.syncId,stamp.syncVersion]);
        if (!sourceTaxes.has(epoch)) sourceTaxes.set(epoch,this.store.getOperationalTaxes({ syncId: stamp.syncId, syncVersion: stamp.syncVersion, contractVersion: 2 }));
        const oldTaxes = await sourceTaxes.get(epoch)!;
        const newTaxes = await (currentTaxes ??= this.ready.runtime.getOperationalTaxes());
        for (const id of line.appliedTaxIds || []) {
          const old = oldTaxes.filter(row => row.id === id), current = newTaxes.filter(row => row.id === id);
          if (old.length !== 1 || current.length !== 1 || v3TaxSemantics(old[0]) !== v3TaxSemantics(current[0])) {
            throw new LargeMasterSyncV3Error('SYNC_V3_RETAINED_TAX_CLASSIFICATION_CHANGED');
          }
        }
      }
      const receipt = await this.store.getCatalogReceipt?.({ syncId: stamp.syncId, syncVersion: stamp.syncVersion }, this.binding);
      if (!receipt || !sameV3StockAuthority(stamp, receipt)) throw new LargeMasterSyncV3Error('SYNC_V3_RETAINED_OWNER_REQUIRED');
      const key = JSON.stringify([stamp.syncId, stamp.syncVersion]);
      if (!sourceCatalogs.has(key)) sourceCatalogs.set(key, await LargeMasterSyncV3OperationalCatalog.open({
        runtime: LargeMasterSyncV3Runtime.retained(this.store, { syncId: stamp.syncId, syncVersion: stamp.syncVersion, contractVersion: 2 }),
        inventoryVersion: anchor.version, inventoryCursor: anchor.cursor,
        inventorySyncId: anchor.syncId, inventorySyncVersion: anchor.syncVersion }, tariffId, warehouseId));
      return sourceCatalogs.get(key)!.get(line.id);
    };
    // Only an independently read retained account permits mixed source generations.
    const fiscalLines = retained ? lines.map(line => ({ ...line, v3SaleAuthority: authority })) : lines;
    buildLargeMasterSyncV3CheckoutFiscalInput(config, fiscalLines, authority, config.taxes || []);
    const demand = new Map<string, number>(),presentationItems=new Set(lines.filter(line=>line.inventoryPresentation!==undefined).map(line=>line.id));
    for (const line of lines) demand.set(line.id,presentationItems.has(line.id)?new Decimal(demand.get(line.id)||0).plus(Math.max(0,presentationInventoryQuantity(line))).toNumber():(demand.get(line.id)||0)+Math.max(0,line.quantity));
    for (const line of lines) {
      const stamp = line.v3SaleAuthority;
      const currentGeneration = stamp?.syncId === this.ready.runtime.version.syncId
        && stamp.syncVersion === this.ready.runtime.version.syncVersion;
      const source = await sourceFor(line);
      const current = currentGeneration ? source : await currentCatalog.get(line.id);
      if (intent === 'SALE' && !current) throw new LargeMasterSyncV3Error('SYNC_V3_ARTICLE_UNAVAILABLE');
      if (!source || source.product.appliedTaxIds?.join('|') !== line.appliedTaxIds?.join('|')) {
        throw new LargeMasterSyncV3Error('SYNC_V3_ARTICLE_UNAVAILABLE');
      }
      if(line.inventoryPresentation&&presentationProof){
        assertInventoryPresentationEligible(source.product);
        const master=JSON.parse(presentationProof.masters[line.inventoryPresentation.masterRevision]||'null');
        const base=master?.basePrices?.find((row:any)=>row.tariffId===tariffId);
        if(!base||!new Decimal(base.price).eq(source.product.price)||base.taxIncluded!==source.authority.taxIncluded)throw Error('INVENTORY_PRESENTATION_CATALOG_PRICE_CHANGED');
      }
      validateV3PinnedLineSource(line, source.product, source.authority);
      onValidatedSource?.(line, source.product);
      if (!source.product.activeInWarehouses?.includes(warehouseId)) throw new LargeMasterSyncV3Error('SYNC_V3_WAREHOUSE_UNAVAILABLE');
      if (source.product.type !== 'SERVICE' && source.product.isInventoriable === true
        && requiresV3SaleAvailability(intent, source.product.operationalFlags?.trackInventory === true,
        source.product.operationalFlags?.allowNegativeStock === true)) {
        const stock=await this.withStock(source.product,warehouseId);
        if((demand.get(line.id) || 0)>stock.stock)throw new LargeMasterSyncV3Error('SYNC_V3_STOCK_INSUFFICIENT');
      }
    }
    await this.assertCurrent();
    return retained;
  }

  async presentationProof(config:BusinessConfig,lines:CartItem[]){
    if(!lines.some(line=>line.inventoryPresentation!==undefined))return;
    const terminal=config.terminals.find(row=>row.config.currentDeviceId===this.identity.deviceId&&(row.config.erpTerminalId||row.id)===this.identity.terminalId);
    if(!terminal)throw Error('INVENTORY_PRESENTATION_SCOPE_CHANGED');
    return validatePresentationCart(createPresentationRuntime(()=>presentationAuthority(config,terminal.id)),lines);
  }

  async stockRequirements(config: BusinessConfig, lines: CartItem[], warehouseId: string,
    intent: V3FinancialIntent): Promise<NonNullable<DurableDocumentMutation['v3StockRequirements']>> {
    if (intent === 'REFUND') return [];
    const catalog = await this.catalog(lines[0].v3SaleAuthority!.tariffId, warehouseId);
    const demands = new Map<string, number>();
    const baseItems=new Set(lines.filter(line=>line.inventoryPresentation).map(line=>line.id));
    for (const line of lines) {
      if (line.quantity <= 0) throw new LargeMasterSyncV3Error('SYNC_V3_LINE_INVALID');
      const source = await catalog.get(line.id);
      if (!source) throw new LargeMasterSyncV3Error('SYNC_V3_ARTICLE_UNAVAILABLE');
      if (source.product.type !== 'SERVICE' && source.product.isInventoriable === true && requiresV3SaleAvailability(intent,
        source.product.operationalFlags?.trackInventory === true,
        source.product.operationalFlags?.allowNegativeStock === true)) {
        demands.set(line.id,baseItems.has(line.id)?new Decimal(demands.get(line.id)||0).plus(presentationInventoryQuantity(line)).toNumber():(demands.get(line.id)||0)+line.quantity);
      }
    }
    return [...demands].map(([productId, quantity]) => ({ productId, quantity, warehouseId,...(baseItems.has(productId)?{quantityScale:4 as const}:{}),
      baseline: v3InventoryBaselineKey(this.binding, lines[0].v3SaleAuthority!) }));
  }
}

export const getLargeMasterSyncV3OperationalSession = createLargeMasterSyncV3SessionCoordinator(
  (refresh, metric) => LargeMasterSyncV3OperationalSession.open(refresh, metric),
  () => {try{const identity=readLargeMasterSyncV3BoundIdentity();return JSON.stringify([v3BindingKey(identity,largeMasterSyncV3DownloadOrigin()),identity.syncToken]);}
    catch{return JSON.stringify(['offline-observation',readOperationalCatalogBindingProof(),resolveSyncTarget().baseUrl,largeMasterSyncV3DownloadOrigin()]);}},
);
