import { readOperationalCatalogBindingProof } from './OperationalTerminalConfig';
import { readLargeMasterSyncV3BoundIdentity } from './LargeMasterSyncV3BoundTransport';
import type { BusinessConfig, CartItem, Product, Transaction } from '../../types';
import type { V3OperationalCategory } from './LargeMasterSyncV3Categories';
import type { LargeMasterSyncV3OperationalCatalog } from './LargeMasterSyncV3OperationalCatalog';
import { getLargeMasterSyncV3OperationalSession, type LargeMasterSyncV3OperationalSession } from './LargeMasterSyncV3OperationalSession';

export interface V3KioskContext { config: BusinessConfig; terminalId: string }
export interface V3KioskPage {
  products: Product[];
  nextCursor: string | null;
  diagnostics: string[];
}

/** One immutable sale context shared by catalog and checkout; never hydrates App's legacy catalog. */
export class LargeMasterSyncV3KioskCatalog {
  private active = true;
  private readonly contextKey: string;
  private constructor(
    readonly config: BusinessConfig,
    readonly categories: V3OperationalCategory[],
    readonly tariffId: string,
    readonly warehouseId: string,
    private readonly source: LargeMasterSyncV3OperationalCatalog,
    private readonly session: LargeMasterSyncV3OperationalSession,
    private readonly context: V3KioskContext,
    private readonly getContext: () => V3KioskContext,
    private readonly assertIdentity: () => void,
  ) { this.contextKey = JSON.stringify(context); }

  static async open(getContext: () => V3KioskContext,
    openSession: () => Promise<LargeMasterSyncV3OperationalSession> = getLargeMasterSyncV3OperationalSession,
    readIdentity = readLargeMasterSyncV3BoundIdentity,
    readBindingProof = readOperationalCatalogBindingProof): Promise<LargeMasterSyncV3KioskCatalog> {
    const context = getContext();
    const terminal = context.config.terminals.find(row => row.id === context.terminalId);
    const identity = readIdentity();
    const proof = readBindingProof();
    const binding = terminal?.config.erpBinding;
    if (!terminal || !proof || terminal.config.currentDeviceId !== identity.deviceId
      || (terminal.config.erpTerminalId || terminal.id) !== identity.terminalId
      || proof.terminalId !== identity.terminalId || proof.deviceId !== identity.deviceId || proof.tenantId !== identity.tenantId
      || binding?.tenantId !== identity.tenantId || binding.companyId !== proof.companyId
      || binding.terminalId && binding.terminalId !== identity.terminalId || binding?.deviceId && binding.deviceId !== identity.deviceId)
      throw Error('SYNC_V3_KIOSK_TERMINAL_IDENTITY_REQUIRED');
    const identityKey = JSON.stringify([identity, proof]);
    const assertIdentity = () => {
      if (JSON.stringify([readIdentity(), readBindingProof()]) !== identityKey) throw Error('SYNC_V3_KIOSK_BINDING_CHANGED');
    };
    const tariffId = terminal?.config.pricing?.defaultTariffId;
    const warehouseId = terminal?.config.inventoryScope?.defaultSalesWarehouseId;
    if (!terminal || !tariffId || !warehouseId) throw Error('SYNC_V3_CONFIGURED_TARIFF_WAREHOUSE_REQUIRED');
    const allowed = terminal.config.pricing?.allowedTariffIds || [];
    if (!allowed.includes(tariffId)) throw Error('SYNC_V3_TARIFF_UNAVAILABLE');
    if (!terminal.config.inventoryScope?.visibleWarehouseIds?.includes(warehouseId)) throw Error('SYNC_V3_WAREHOUSE_UNAVAILABLE');
    const session = await openSession();
    const [config, source] = await Promise.all([session.projectConfig(context.config), session.catalog(tariffId, warehouseId)]);
    const allCategories = await source.categories();
    const normalize = (value: string) => value.trim().toLowerCase();
    const declared = new Set((terminal.config.catalog?.allowedCategories || []).map(normalize));
    const categoryAliases = new Set<string>(declared);
    for (const row of context.config.posCategories || []) {
      const aliases = [row.id, row.name, row.code].filter((value): value is string => typeof value === 'string').map(normalize);
      if (aliases.some(value => declared.has(value))) aliases.forEach(value => categoryAliases.add(value));
    }
    const categories = declared.size ? allCategories.filter(row => categoryAliases.has(normalize(row.key)) || categoryAliases.has(normalize(row.label))) : allCategories;
    const result = new LargeMasterSyncV3KioskCatalog(config, categories, tariffId, warehouseId, source, session, context, getContext, assertIdentity);
    await result.assertCurrent();
    return result;
  }

  dispose(): void { this.active = false; }

  async assertCurrent(): Promise<void> {
    const check = () => {
      const current = this.getContext();
      this.assertIdentity();
      if (!this.active || current.config !== this.context.config || JSON.stringify(current) !== this.contextKey)
        throw Error('SYNC_V3_KIOSK_CONTEXT_CHANGED');
    };
    check();
    await this.session.assertCurrent();
    check();
  }

  async page(query: string, category: string, afterId: string | null): Promise<V3KioskPage> {
    await this.assertCurrent();
    const selected = category === 'Todos' ? this.categories : this.categories.filter(row => row.label === category);
    if (category !== 'Todos' && !selected.length) throw Error('SYNC_V3_CATEGORY_UNAVAILABLE');
    const result = await this.source.page({ query, afterId, limit: 30, ...((category !== 'Todos' || this.context.config.terminals.find(row => row.id === this.context.terminalId)?.config.catalog?.allowedCategories?.length) ? { operationalCategoryKeys: selected.map(row => row.key) } : {}) });
    const products = await this.session.withStocks(result.items.map(item => item.product), this.warehouseId);
    await this.assertCurrent();
    return { products, nextCursor: result.nextCursor,
      diagnostics: result.diagnostics.map(row => `${row.sku || row.articleId}: ${row.reason}`) };
  }

  async validate(lines: CartItem[]): Promise<void> {
    await this.assertCurrent();
    await this.session.validate(this.config, lines, this.tariffId, this.warehouseId);
    await this.assertCurrent();
  }
}

/** In-memory attempt identity survives view changes and retries in the same checkout. */
export class V3KioskPaymentAttempt {
  private key?: string;
  private running?: Promise<Transaction>;
  private draft?: Transaction;
  private completed?: Transaction;

  get retryDraft(): Transaction | undefined { return this.draft; }
  resetCompleted(): void {
    if (this.pending) return;
    this.key = undefined; this.draft = undefined; this.completed = undefined;
  }
  get pending(): boolean { return Boolean(this.running || this.draft && !this.completed); }

  async run(key: string, operation: () => Promise<Transaction>): Promise<Transaction> {
    if (this.key && this.key !== key && this.pending) throw Error('El pago anterior requiere reintento con el mismo pedido.');
    if (this.running) return this.running;
    if (this.completed) {
      if (this.key !== key) throw Error('Este pedido ya está confirmado. Finaliza antes de iniciar otro pago.');
      return this.completed;
    }
    if (this.key !== key) { this.draft = undefined; this.completed = undefined; }
    this.key = key;
    const running = operation().then(transaction => { this.completed = transaction; return transaction; });
    this.running = running;
    try { return await running; } finally { this.running = undefined; }
  }

  async transaction(create: () => Promise<Transaction>): Promise<Transaction> {
    if (!this.draft) this.draft = await create();
    return this.draft;
  }
}
