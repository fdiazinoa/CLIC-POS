import type { BusinessConfig, CartItem, Product, ProductVariant, TaxDefinition, V3SaleAuthorityStamp } from '../../types';
import { dbAdapter } from '../db';
import { LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED } from './LargeMasterSyncV3Authority';
import { LARGE_MASTER_SYNC_V3_CANARY, assertLargeMasterSyncV3CanaryEmulator, validateLargeMasterSyncV3CanaryUrl } from './LargeMasterSyncV3Canary';
import { readLargeMasterSyncV3BoundIdentity, type LargeMasterSyncV3BoundIdentity } from './LargeMasterSyncV3BoundTransport';
import { prepareLargeMasterSyncV3Candidate, type LargeMasterSyncV3CandidateReady } from './LargeMasterSyncV3Candidate';
import { LargeMasterSyncV3Runtime } from './LargeMasterSyncV3Runtime';
import { LargeMasterSyncV3OperationalCatalog } from './LargeMasterSyncV3OperationalCatalog';
import { buildLargeMasterSyncV3CheckoutFiscalInput } from './LargeMasterSyncV3CheckoutAuthority';
import { LargeMasterSyncV3Error, type LargeMasterSyncV3Store } from './LargeMasterSyncV3Types';
import { requiresV3SaleAvailability, type V3FinancialIntent } from './LargeMasterSyncV3RefundAuthority';
import type { DurableDocumentMutation } from '../db/DatabaseAdapter';
import { validateV3PinnedLineSource } from './LargeMasterSyncV3LineSource';

export const v3BindingKey = (identity: LargeMasterSyncV3BoundIdentity, v3BaseUrl: string): string =>
  JSON.stringify([identity.tenantId, identity.terminalId, identity.deviceId,
    identity.erpSyncBaseUrl, validateLargeMasterSyncV3CanaryUrl(v3BaseUrl)]);

export const v3InventoryBaselineKey = (binding: string, stamp: V3SaleAuthorityStamp): string =>
  JSON.stringify([binding, stamp.syncId, stamp.syncVersion, stamp.inventoryVersion, stamp.inventoryCursor]);

export type V3CodeMatch = { product: Product; quantity: number; price: number; modifiers: string[];
  selectedVariant?: ProductVariant; variantInfo?: string };

/** One bound, immutable baseline. ACK never removes local stock movements. */
export class LargeMasterSyncV3OperationalSession {
  private constructor(
    readonly ready: LargeMasterSyncV3CandidateReady,
    readonly binding: string,
    private readonly store: LargeMasterSyncV3Store,
    private readonly v3BaseUrl: string,
    private readonly identity: LargeMasterSyncV3BoundIdentity,
  ) {}

  static async open(): Promise<LargeMasterSyncV3OperationalSession> {
    if (!LARGE_MASTER_SYNC_V3_CANDIDATE_ENABLED || LARGE_MASTER_SYNC_V3_CANARY) {
      throw new LargeMasterSyncV3Error('SYNC_V3_OPERATIONAL_BUILD_REQUIRED');
    }
    assertLargeMasterSyncV3CanaryEmulator();
    const v3BaseUrl = import.meta.env.VITE_LARGE_MASTER_SYNC_V3_BASE_URL;
    if (!v3BaseUrl) throw new LargeMasterSyncV3Error('SYNC_V3_BASE_URL_REQUIRED');
    const identity = readLargeMasterSyncV3BoundIdentity();
    const binding = v3BindingKey(identity, v3BaseUrl);
    await dbAdapter.connect();
    const store = dbAdapter.masterSyncV3Store;
    if (!store?.getOperationalOwner || !store.setOperationalOwner || !store.getLocalInventoryDelta) {
      throw new LargeMasterSyncV3Error('SYNC_V3_NATIVE_STORE_UNAVAILABLE');
    }
    let ready: LargeMasterSyncV3CandidateReady | null = null;
    const runtime = await LargeMasterSyncV3Runtime.open(store);
    const owner = await store.getOperationalOwner();
    if (owner && owner.binding !== binding) throw new LargeMasterSyncV3Error('SYNC_V3_BINDING_CHANGED');
    if (runtime && (runtime.version.contractVersion || 1) >= 2 && owner?.binding === binding
      && owner.syncId === runtime.version.syncId && owner.syncVersion === runtime.version.syncVersion) {
      const inventory = await runtime.getInventorySnapshotVersion();
      if (inventory) ready = { runtime, inventoryVersion: inventory.version, inventoryCursor: inventory.cursor };
    }
    if (!ready) {
      ready = await prepareLargeMasterSyncV3Candidate(store, v3BaseUrl);
      if (v3BindingKey(readLargeMasterSyncV3BoundIdentity(), v3BaseUrl) !== binding) {
        throw new LargeMasterSyncV3Error('SYNC_V3_BINDING_CHANGED');
      }
      await store.setOperationalOwner(ready.runtime.version, binding);
    }
    return new LargeMasterSyncV3OperationalSession(ready, binding, store, v3BaseUrl, identity);
  }

  async assertCurrent(): Promise<void> {
    assertLargeMasterSyncV3CanaryEmulator();
    const current = readLargeMasterSyncV3BoundIdentity();
    if (v3BindingKey(current, this.v3BaseUrl) !== this.binding || current.syncToken !== this.identity.syncToken) {
      throw new LargeMasterSyncV3Error('SYNC_V3_BINDING_CHANGED');
    }
    const active = await this.store.getActiveRuntimeVersion();
    const inventory = await this.ready.runtime.getInventorySnapshotVersion();
    if (active?.syncId !== this.ready.runtime.version.syncId
      || active.syncVersion !== this.ready.runtime.version.syncVersion
      || inventory?.version !== this.ready.inventoryVersion || inventory.cursor !== this.ready.inventoryCursor) {
      throw new LargeMasterSyncV3Error('SYNC_V3_RUNTIME_VERSION_CHANGED');
    }
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
        name: String(row.name), rate: row.rate, type: type as TaxDefinition['type'] };
    });
    return { ...config, taxes, taxRate: 0, tariffs: tariffs.map(row => {
      if (typeof row.taxIncluded !== 'boolean') throw new LargeMasterSyncV3Error('SYNC_V3_TARIFF_UNAVAILABLE');
      return { ...row, id: String(row.id), name: String(row.name), taxIncluded: row.taxIncluded };
    }) as BusinessConfig['tariffs'] };
  }

  async withStock(product: Product, warehouseId: string): Promise<Product> {
    const stamp = product.v3SaleAuthority;
    if (!stamp) throw new LargeMasterSyncV3Error('SYNC_V3_CART_LEGACY_LINE');
    const delta = await this.store.getLocalInventoryDelta!(v3InventoryBaselineKey(this.binding, stamp), product.id, warehouseId);
    return { ...product, v3SaleAuthority: { ...stamp, binding: this.binding, warehouseId }, stock: product.stock + delta,
      stockBalances: { ...product.stockBalances, [warehouseId]: (product.stockBalances?.[warehouseId] || 0) + delta } };
  }

  async withStocks(products: Product[], warehouseId: string): Promise<Product[]> {
    if (!products.length) return [];
    const stamp = products[0].v3SaleAuthority;
    if (!stamp || !this.store.getLocalInventoryDeltas) throw new LargeMasterSyncV3Error('SYNC_V3_NATIVE_STORE_UNAVAILABLE');
    const deltas = await this.store.getLocalInventoryDeltas(v3InventoryBaselineKey(this.binding, stamp), products.map(row => row.id), warehouseId);
    return products.map(product => ({ ...product,
      v3SaleAuthority: { ...product.v3SaleAuthority!, binding: this.binding, warehouseId },
      stock: product.stock + (deltas[product.id] || 0),
      stockBalances: { ...product.stockBalances, [warehouseId]: (product.stockBalances?.[warehouseId] || 0) + (deltas[product.id] || 0) } }));
  }

  async validate(config: BusinessConfig, lines: CartItem[], tariffId: string, warehouseId: string,
    intent: V3FinancialIntent = 'SALE', onValidatedSource?: (line: CartItem, source: Product) => void): Promise<void> {
    await this.assertCurrent();
    if (!lines.length) throw new LargeMasterSyncV3Error('SYNC_V3_CART_EMPTY');
    const authority = lines[0].v3SaleAuthority;
    if (!authority || authority.binding !== this.binding || authority.warehouseId !== warehouseId
      || authority.tariffId !== tariffId || authority.syncId !== this.ready.runtime.version.syncId
      || authority.syncVersion !== this.ready.runtime.version.syncVersion
      || authority.inventoryVersion !== this.ready.inventoryVersion || authority.inventoryCursor !== this.ready.inventoryCursor) {
      throw new LargeMasterSyncV3Error('SYNC_V3_CART_MIXED_VERSION');
    }
    buildLargeMasterSyncV3CheckoutFiscalInput(config, lines, authority, config.taxes || []);
    const catalog = await this.catalog(tariffId, warehouseId);
    const demand = new Map<string, number>();
    for (const line of lines) demand.set(line.id, (demand.get(line.id) || 0) + Math.max(0, line.quantity));
    for (const line of lines) {
      const source = await catalog.get(line.id);
      if (!source || source.product.appliedTaxIds?.join('|') !== line.appliedTaxIds?.join('|')) {
        throw new LargeMasterSyncV3Error('SYNC_V3_ARTICLE_UNAVAILABLE');
      }
      validateV3PinnedLineSource(line, source.product, source.authority);
      onValidatedSource?.(line, source.product);
      if (!source.product.activeInWarehouses?.includes(warehouseId)) throw new LargeMasterSyncV3Error('SYNC_V3_WAREHOUSE_UNAVAILABLE');
      const stock = await this.withStock(source.product, warehouseId);
      const terminal = config.terminals.find(row => row.config?.currentDeviceId === this.identity.deviceId);
      if (source.product.type !== 'SERVICE' && source.product.isInventoriable === true
        && requiresV3SaleAvailability(intent, source.product.operationalFlags?.trackInventory === true,
        source.product.operationalFlags?.allowNegativeStock === true,
        terminal?.config.workflow?.inventory?.allowNegativeStock === true)
        && (demand.get(line.id) || 0) > stock.stock) {
        throw new LargeMasterSyncV3Error('SYNC_V3_STOCK_INSUFFICIENT');
      }
    }
    await this.assertCurrent();
  }

  async stockRequirements(config: BusinessConfig, lines: CartItem[], warehouseId: string,
    intent: V3FinancialIntent): Promise<NonNullable<DurableDocumentMutation['v3StockRequirements']>> {
    if (intent === 'REFUND') return [];
    const catalog = await this.catalog(lines[0].v3SaleAuthority!.tariffId, warehouseId);
    const terminal = config.terminals.find(row => row.config?.currentDeviceId === this.identity.deviceId);
    const demands = new Map<string, number>();
    for (const line of lines) {
      if (line.quantity <= 0) throw new LargeMasterSyncV3Error('SYNC_V3_LINE_INVALID');
      const source = await catalog.get(line.id);
      if (!source) throw new LargeMasterSyncV3Error('SYNC_V3_ARTICLE_UNAVAILABLE');
      if (source.product.type !== 'SERVICE' && source.product.isInventoriable === true && requiresV3SaleAvailability(intent,
        source.product.operationalFlags?.trackInventory === true,
        source.product.operationalFlags?.allowNegativeStock === true,
        terminal?.config.workflow?.inventory?.allowNegativeStock === true)) {
        demands.set(line.id, (demands.get(line.id) || 0) + line.quantity);
      }
    }
    return [...demands].map(([productId, quantity]) => ({ productId, quantity, warehouseId,
      baseline: v3InventoryBaselineKey(this.binding, lines[0].v3SaleAuthority!) }));
  }
}

let opening: Promise<LargeMasterSyncV3OperationalSession> | undefined;
export const getLargeMasterSyncV3OperationalSession = (): Promise<LargeMasterSyncV3OperationalSession> => {
  if (!opening) opening = LargeMasterSyncV3OperationalSession.open().catch(error => { opening = undefined; throw error; });
  return opening;
};
