import {
  BusinessConfig, Product, User, Customer, Transaction,
  Warehouse, StockTransfer, CashMovement, InventoryLedgerEntry, LedgerConcept,
  RoleDefinition, ParkedTicket, PurchaseOrder, Supplier, Watchlist,
  NCFType, FiscalRangeDGII, FiscalAllocation, LocalFiscalBuffer, DocumentSeries,
  Campaign, Coupon, ZReport, Reception, ProductStock, InventoryTracking
} from '../types';
import {
  MOCK_USERS, RETAIL_PRODUCTS, FOOD_PRODUCTS,
  MOCK_CUSTOMERS, INITIAL_TARIFFS, getInitialConfig,
  DEFAULT_ROLES, DEFAULT_TERMINAL_CONFIG, DEFAULT_DOCUMENT_SERIES
} from '../constants';
import { dbAdapter } from '../services/db';
import { permissionService } from '../services/sync/PermissionService';

const DB_KEY = 'clic_pos_db_v1';
let initPromise: Promise<any> | null = null;
const INVENTORY_CLOSE_LOCK_MESSAGE = 'Acción denegada: El inventario a esta fecha ya ha sido cerrado y auditado.';

const getSnapshotLockDate = (snapshot: any): number => {
  const lockRef = snapshot?.lockDate || snapshot?.cutoffDate || snapshot?.closedAt || snapshot?.createdAt;
  return new Date(lockRef).getTime();
};

const assertInventoryMovementUnlocked = async (
  warehouseId: string,
  effectiveDate?: string
): Promise<void> => {
  const snapshots = await dbAdapter.getCollection<any>('inventorySnapshots') || [];
  const closedSnapshots = snapshots
    .filter((s: any) => s.status === 'CLOSED' && s.warehouseId === warehouseId)
    .sort((a: any, b: any) => getSnapshotLockDate(b) - getSnapshotLockDate(a));

  const activeLock = closedSnapshots[0];
  if (!activeLock) return;

  const lockDate = getSnapshotLockDate(activeLock);
  if (!Number.isFinite(lockDate)) return;

  const movementDate = effectiveDate ? new Date(effectiveDate).getTime() : Date.now();
  if (!Number.isFinite(movementDate)) {
    throw new Error('Fecha de movimiento inválida.');
  }

  if (movementDate <= lockDate) {
    throw new Error(INVENTORY_CLOSE_LOCK_MESSAGE);
  }
};

const toValidMovementIso = (effectiveDate?: string): string => {
  if (!effectiveDate) return new Date().toISOString();
  const parsed = new Date(effectiveDate);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Fecha de movimiento inválida.');
  }
  return parsed.toISOString();
};

// --- SEED DATA ---
const DEFAULT_WAREHOUSES: Warehouse[] = [
  { id: "wh_central", code: "CEN", name: "Bodega Central", type: "PHYSICAL", address: "Calle Industria #45", allowPosSale: true, allowNegativeStock: false, isMain: true, storeId: "S1" },
  { id: "wh_norte", code: "NTE", name: "Piso de Venta Norte", type: "PHYSICAL", address: "Plaza Norte, Local 10", allowPosSale: true, allowNegativeStock: false, isMain: false, storeId: "S2" },
];

const SEED_DATA = {
  config: (() => {
    const baseConfig = getInitialConfig('Supermercado' as any);
    if (baseConfig.terminals[0]) {
      baseConfig.terminals[0].config.inventoryScope = {
        defaultSalesWarehouseId: "wh_central",
        visibleWarehouseIds: DEFAULT_WAREHOUSES.map(w => w.id)
      };
    }
    return baseConfig;
  })(),
  users: MOCK_USERS,
  roles: DEFAULT_ROLES,
  customers: MOCK_CUSTOMERS,
  warehouses: DEFAULT_WAREHOUSES,
  products: RETAIL_PRODUCTS.map(p => ({
    ...p,
    createdAt: new Date().toISOString(),
    stockBalances: { "wh_central": 100, "wh_norte": 0 }
  })),
  transactions: [] as Transaction[],
  transactionHistory: [] as Transaction[],
  cashMovements: [] as CashMovement[],
  transfers: [] as StockTransfer[],
  parkedTickets: [] as ParkedTicket[],
  purchaseOrders: [] as PurchaseOrder[],
  suppliers: [] as Supplier[],
  inventoryLedger: RETAIL_PRODUCTS.map(p => ({
    id: `LEG-INIT-${p.id}-wh_central`,
    createdAt: new Date().toISOString(),
    date: new Date().toISOString(),
    warehouseId: 'wh_central',
    productId: p.id,
    concept: 'CARGA_INICIAL' as LedgerConcept,
    documentRef: 'SEED',
    qtyIn: 100,
    qtyOut: 0,
    price: p.price,
    cost: p.cost,
    unitCost: p.cost,
    balanceQty: 100,
    avgCost: p.cost,
    balanceAvgCost: p.cost,
    terminalId: 't1',
    status: 'COMPLETED'
  })) as InventoryLedgerEntry[],
  watchlists: [] as Watchlist[],
  internalSequences: DEFAULT_DOCUMENT_SERIES as DocumentSeries[],
  fiscalRanges: [
    { id: 'fr1', type: 'B01', prefix: 'B01', startNumber: 1, endNumber: 10000, currentGlobal: 0, expiryDate: '2026-12-31', isActive: true },
    { id: 'fr2', type: 'B02', prefix: 'B02', startNumber: 1, endNumber: 50000, currentGlobal: 0, expiryDate: '2026-12-31', isActive: true },
    { id: 'fr3', type: 'B04', prefix: 'B04', startNumber: 1, endNumber: 10000, currentGlobal: 0, expiryDate: '2026-12-31', isActive: true },
    { id: 'fr4', type: 'B14', prefix: 'B14', startNumber: 1, endNumber: 10000, currentGlobal: 0, expiryDate: '2026-12-31', isActive: true },
    { id: 'fr5', type: 'B15', prefix: 'B15', startNumber: 1, endNumber: 10000, currentGlobal: 0, expiryDate: '2026-12-31', isActive: true }
  ] as FiscalRangeDGII[],
  fiscalAllocations: [] as FiscalAllocation[],
  localFiscalBuffer: [] as LocalFiscalBuffer[],
  campaigns: [
    {
      id: 'camp_summer_2024',
      name: 'Verano 2024 Instagram',
      description: 'Campaña de redes sociales',
      benefitType: 'PERCENT',
      benefitValue: 20,
      startDate: '2024-01-01T00:00:00Z',
      endDate: '2026-12-31T23:59:59Z',
      totalGenerated: 5,
      createdAt: new Date().toISOString()
    }
  ] as Campaign[],
  coupons: [
    { id: 'cpn_1', campaignId: 'camp_summer_2024', code: 'VERANO-2024', status: 'GENERATED', createdAt: new Date().toISOString() },
    { id: 'cpn_2', campaignId: 'camp_summer_2024', code: 'INSTA-PROMO', status: 'GENERATED', createdAt: new Date().toISOString() },
    { id: 'cpn_3', campaignId: 'camp_summer_2024', code: 'VIP-CLIENT', status: 'GENERATED', createdAt: new Date().toISOString() }
  ] as Coupon[],
  zReports: [] as ZReport[],
  receptions: [] as Reception[],
  productStocks: RETAIL_PRODUCTS.map(p => ({
    id: `${p.id}_wh_central`,
    productId: p.id,
    warehouseId: 'wh_central',
    quantity: 100,
    updatedAt: new Date().toISOString()
  })) as ProductStock[],
  supplierProductPrices: [] as any[],
  inventoryTracking: [] as InventoryTracking[],
  inventorySnapshots: [] as any[],
  inventoryAuditLogs: [] as any[],
  inventoryCounts: [] as any[],
  rooms: [] as any[],
  tables: [] as any[]
};

export const db = {
  init: async (terminalId?: string) => {
    if (initPromise) {
      console.log('♻️ Reusing existing DB Init');
      return initPromise;
    }

    const _initRunner = async () => {
      console.log('🏁 _initRunner started');
      try {
        console.log('🔌 Connecting to DB Adapter...');
        await dbAdapter.connect();
        console.log('✅ DB Adapter connected');

        // Check if seeded
        console.log('🔍 Checking config collection...');
        const existingConfig = await dbAdapter.getCollection('config');
        console.log('✅ Config check complete, exists:', !!existingConfig);
        const isSlave = permissionService.isSlaveTerminal();
        console.log('🤖 isSlave:', isSlave);

        // Migration Logic: Ensure all collections exist even if config exists
        // SKIP SEEDING ON SLAVES: Slaves must wait for Master snapshot
        if (!isSlave) {
          // --- CONFIG PATCHING (Always run if config exists) ---
          if (existingConfig && (Array.isArray(existingConfig) ? existingConfig.length > 0 : Object.keys(existingConfig).length > 0)) {
            const currentConfig = (Array.isArray(existingConfig) ? existingConfig[0] : existingConfig) as any as BusinessConfig;
            let wasPatched = false;
            const seedConfig = SEED_DATA.config;

            if (currentConfig.terminals) {
              currentConfig.terminals.forEach(t => {
                // Patch 0: Special fix for t1 role (Price Checker -> STANDARD_POS)
                if (t.id === 't1' && (t.config.deviceRole?.role !== 'STANDARD_POS')) {
                  console.warn('🩹 Patching terminal t1: Force role to STANDARD_POS');
                  const seedVal = seedConfig.terminals.find(st => st.id === 't1');
                  if (seedVal?.config.deviceRole) {
                    t.config.deviceRole = JSON.parse(JSON.stringify(seedVal.config.deviceRole));
                    wasPatched = true;
                  }
                }

                // Patch 1: Missing Customer Display
                if (!t.config.hardware.customerDisplay) {
                  const seedVal = seedConfig.terminals.find(st => st.id === t.id) || seedConfig.terminals[0];
                  if (seedVal?.config.hardware.customerDisplay) {
                    t.config.hardware.customerDisplay = JSON.parse(JSON.stringify(seedVal.config.hardware.customerDisplay));
                    wasPatched = true;
                  }
                }
              });
            }

            if (wasPatched) {
              console.log('🩹 Config patched with new defaults');
              await dbAdapter.saveCollection('config', currentConfig as any);
            }
          }

          // --- SEEDING MISSING COLLECTIONS ---
          for (const [key, value] of Object.entries(SEED_DATA)) {
            try {
              const existingCollection = await dbAdapter.getCollection(key);

              // If collection is missing or empty (except config which we already handled), seed it
              if (!existingCollection || (Array.isArray(existingCollection) && existingCollection.length === 0 && key !== 'config')) {
                console.log(`🌱 Seeding missing collection: ${key}`);
                await dbAdapter.saveCollection(key, value as any);
              }
            } catch (error) {
              console.warn(`⚠️ Failed to seed collection ${key}:`, error);
            }
          }
        } else {
          console.log('ℹ️ Slave terminal detected: Skipping auto-seeding. Waiting for Master sync.');
        }

        if (!existingConfig || Object.keys(existingConfig).length === 0) {
          return isSlave ? {} : SEED_DATA;
        }

        // Load all data to return consistent structure (Legacy support)
        // Use Promise.allSettled to ensure one failure doesn't break everything
        console.log('📦 Loading all collections...');
        const keys = Object.keys(SEED_DATA);
        const results = await Promise.allSettled(keys.map(key =>
          dbAdapter.getCollection(key, (terminalId && key === 'rooms') ? { terminal_id: terminalId } : undefined)
        ));
        console.log('✅ All collections loaded (settled)');

        const data: any = {};
        results.forEach((result, index) => {
          const key = keys[index];
          if (result.status === 'fulfilled') {
            data[key] = result.value;
          } else {
            console.error(`❌ Failed to load ${key}:`, result.reason);
            data[key] = []; // Fallback to empty array
          }
        });

        console.log('📤 _initRunner returning data');
        return data;
      } catch (e) {
        initPromise = null;
        throw e;
      }
    };

    initPromise = _initRunner();
    return initPromise;
  },

  reset: async () => {
    localStorage.removeItem(DB_KEY);
    window.location.reload();
  },

  selectiveReset: async (categories: any[], terminalId?: string, isSlave?: boolean) => {
    console.log('🗑️ Selective Reset:', categories.map(c => c.name), { terminalId, isSlave });

    // Map category IDs to DB collections/operations
    for (const category of categories) {
      // If it's a slave, we only delete data specific to this terminal.
      // Global data like products, tariffs, suppliers, customers should NOT be deleted on a slave reset
      if (isSlave && ['products', 'tariffs', 'suppliers', 'customers'].includes(category.id)) {
        console.log(`ℹ️ Skipping global category ${category.id} on slave reset`);
        continue;
      }

      switch (category.id) {
        case 'products':
          await dbAdapter.saveCollection('products', []);
          console.log('✅ Products cleared');
          break;

        case 'tariffs':
          const config = await dbAdapter.getCollection('config') as any as BusinessConfig;
          if (config) {
            config.tariffs = [];
            await dbAdapter.saveCollection('config', config as any);
          }
          console.log('✅ Tariffs cleared');
          break;

        case 'suppliers':
          await dbAdapter.saveCollection('suppliers', []);
          console.log('✅ Suppliers cleared');
          break;

        case 'customers':
          await dbAdapter.saveCollection('customers', []);
          console.log('✅ Customers cleared');
          break;

        case 'stock':
          // Clear stock balances from all products
          const products = await dbAdapter.getCollection('products') || [];
          const updatedProducts = products.map((p: any) => ({
            ...p,
            stock: 0,
            stockBalances: {},
            updatedAt: new Date().toISOString()
          }));
          await dbAdapter.saveCollection('products', updatedProducts);
          console.log('✅ Stock cleared');
          break;

        case 'transactions':
          if (isSlave && terminalId) {
            const allTx = await dbAdapter.getCollection('transactions') || [];
            const remainingTx = allTx.filter((t: any) => t.terminalId !== terminalId);
            await dbAdapter.saveCollection('transactions', remainingTx);
            console.log(`✅ Transactions for terminal ${terminalId} cleared`);
          } else {
            await dbAdapter.saveCollection('transactions', []);
            console.log('✅ Transactions cleared');
          }
          break;

        case 'credit_notes':
          // Filter out refunded transactions
          const txns = await dbAdapter.getCollection('transactions') || [];
          const filtered = txns.filter((t: any) => !t.refunded);
          await dbAdapter.saveCollection('transactions', filtered);
          console.log('✅ Credit notes cleared');
          break;

        case 'purchase_orders':
          await dbAdapter.saveCollection('purchaseOrders', []);
          console.log('✅ Purchase orders cleared');
          break;

        case 'purchase_reception':
          // 1. Mark all POs as pending
          const pos = await dbAdapter.getCollection('purchaseOrders') || [];
          const resetPos = pos.map((o: any) => ({
            ...o,
            status: 'PENDING',
            items: o.items.map((i: any) => ({ ...i, quantityReceived: 0 }))
          }));
          await dbAdapter.saveCollection('purchaseOrders', resetPos);

          // 2. Clear Receptions history
          if (isSlave && terminalId) {
            const allRec = await dbAdapter.getCollection('receptions') || [];
            const remainingRec = allRec.filter((r: any) => r.terminalId !== terminalId);
            await dbAdapter.saveCollection('receptions', remainingRec);
            console.log(`✅ Receptions for terminal ${terminalId} cleared`);
          } else {
            await dbAdapter.saveCollection('receptions', []);
            console.log('✅ Receptions cleared');
          }
          console.log('✅ Purchase receptions and history cleared');
          break;

        case 'inventory_ledger':
          if (isSlave && terminalId) {
            const allLedger = await dbAdapter.getCollection('inventoryLedger') || [];
            const remainingLedger = allLedger.filter((l: any) => l.terminalId !== terminalId);
            await dbAdapter.saveCollection('inventoryLedger', remainingLedger);
            console.log(`✅ Inventory ledger for terminal ${terminalId} cleared`);
          } else {
            await dbAdapter.saveCollection('inventoryLedger', []);
            console.log('✅ Inventory ledger cleared');
          }
          break;

        case 'inventory_tracking':
          await dbAdapter.saveCollection('inventoryTracking', []);
          console.log('✅ Inventory tracking cleared');
          break;

        case 'accounts_receivable':
          await dbAdapter.saveCollection('accountsReceivable', []);
          console.log('✅ Accounts receivable cleared');
          break;

        case 'z_reports':
          if (isSlave && terminalId) {
            const allZ = await dbAdapter.getCollection('zReports') || [];
            const remainingZ = allZ.filter((z: any) => z.terminalId !== terminalId);
            await dbAdapter.saveCollection('zReports', remainingZ);
            console.log(`✅ Z Reports for terminal ${terminalId} cleared`);
          } else {
            await dbAdapter.saveCollection('zReports', []);
            console.log('✅ Z Reports cleared');
          }
          break;

        case 'cash_movements':
          if (isSlave && terminalId) {
            const allCash = await dbAdapter.getCollection('cashMovements') || [];
            const remainingCash = allCash.filter((c: any) => c.terminalId !== terminalId);
            await dbAdapter.saveCollection('cashMovements', remainingCash);
            console.log(`✅ Cash movements for terminal ${terminalId} cleared`);
          } else {
            await dbAdapter.saveCollection('cashMovements', []);
            console.log('✅ Cash movements cleared');
          }
          break;


        case 'supplier_product_prices':
          await dbAdapter.saveCollection('supplierProductPrices', []);
          console.log('✅ Supplier product prices cleared');
          break;

        default:
          console.warn(`⚠️ Unknown category: ${category.id}`);
      }
    }

    // After selective reset, if it's a slave, we also reset document sequences to maintain integrity
    if (isSlave && terminalId) {
      console.log('🔄 Resetting sequences and fiscal buffers for slave terminal');

      // 1. Reset Internal Sequences (Tickets, Refunds, Transfers)
      await dbAdapter.saveCollection('internalSequences', DEFAULT_DOCUMENT_SERIES);

      // 2. Clear Local Fiscal Buffer (NCFs)
      await dbAdapter.saveCollection('localFiscalBuffer', []);

      // 3. Clear Fiscal Allocations for this terminal
      const allocations = await dbAdapter.getCollection<FiscalAllocation>('fiscalAllocations') || [];
      const remainingAllocations = allocations.filter(a => a.terminalId !== terminalId);
      await dbAdapter.saveCollection('fiscalAllocations', remainingAllocations);

      // 4. Reset Sync Center Counters on Master Server
      try {
        const { apiSyncAdapter } = await import('../services/sync/ApiSyncAdapter');
        await apiSyncAdapter.resetTerminalData(terminalId);
        console.log('✅ Sync center counters reset on Master');
      } catch (error) {
        console.warn('⚠️ Could not reset sync center counters on Master (offline or server unreachable)', error);
      }

      console.log('✅ Sequences and fiscal buffers reset');
    } else if (!isSlave) {
      // If it's Master, we also want to clear all operational data on the server
      try {
        const { apiSyncAdapter } = await import('../services/sync/ApiSyncAdapter');
        await apiSyncAdapter.resetTerminalData('ALL');
        console.log('✅ Global sync center counters reset on Master server');
      } catch (error) {
        console.warn('⚠️ Could not reset global sync center counters on Master server', error);
      }
    }

    console.log('✅ Selective reset complete');
  },

  get: async (collection: keyof typeof SEED_DATA, queryParams?: Record<string, string>) => {
    return await dbAdapter.getCollection(collection as string, queryParams);
  },

  save: async (collection: keyof typeof SEED_DATA, payload: any) => {
    // This is tricky because legacy 'save' replaced the whole collection or object
    await dbAdapter.saveCollection(collection as string, payload);
  },

  saveDocument: async (collection: keyof typeof SEED_DATA, doc: any) => {
    await dbAdapter.saveDocument(collection as string, doc);
  },

  saveDocuments: async (collection: keyof typeof SEED_DATA, docs: any[]) => {
    for (const doc of docs) {
      await dbAdapter.saveDocument(collection as string, doc);
    }
  },

  deleteDocument: async (collection: keyof typeof SEED_DATA, id: string) => {
    await dbAdapter.deleteDocument(collection as string, id);
  },

  getDocument: async (collection: keyof typeof SEED_DATA, id: string) => {
    return await dbAdapter.getDocument(collection as string, id);
  },

  canRequestMoreNCF: async (type: NCFType): Promise<boolean> => {
    const ranges = await dbAdapter.getCollection<FiscalRangeDGII>('fiscalRanges');
    const range = ranges?.find((r: FiscalRangeDGII) => r.type === type && r.isActive);
    if (!range) return false;
    return range.currentGlobal < range.endNumber;
  },

  requestFiscalBatch: async (terminalId: string, type: NCFType, batchSize: number): Promise<LocalFiscalBuffer | null> => {
    const ranges = await dbAdapter.getCollection<FiscalRangeDGII>('fiscalRanges');
    const range = ranges?.find((r: FiscalRangeDGII) => r.type === type && r.isActive);
    if (!range || range.currentGlobal >= range.endNumber) return null;

    const start = range.currentGlobal + 1;
    const end = Math.min(range.endNumber, start + batchSize - 1);
    range.currentGlobal = end;

    const localBuffer: LocalFiscalBuffer = { id: type, type, prefix: range.prefix, currentNumber: start, endNumber: end, expiryDate: range.expiryDate };

    // Save updated ranges
    await dbAdapter.saveCollection('fiscalRanges', ranges);

    // Update local buffers
    const buffers = await dbAdapter.getCollection<LocalFiscalBuffer>('localFiscalBuffer') || [];
    const newBuffers = buffers.filter((b: any) => b.type !== type).concat(localBuffer);
    await dbAdapter.saveCollection('localFiscalBuffer', newBuffers);

    return localBuffer;
  },

  getNextNCF: async (type: NCFType, terminalId: string, customBatchSize?: number): Promise<string | null> => {
    let buffers = await dbAdapter.getCollection<LocalFiscalBuffer>('localFiscalBuffer') || [];
    let buffer = (buffers || []).find((b: LocalFiscalBuffer) => b.type === type);

    if (!buffer || buffer.currentNumber > buffer.endNumber) {
      buffer = await db.requestFiscalBatch(terminalId, type, customBatchSize || 100) as LocalFiscalBuffer;
      if (!buffer) return null;
      // Refresh buffers after request
      buffers = await dbAdapter.getCollection<LocalFiscalBuffer>('localFiscalBuffer') || [];
      buffer = (buffers || []).find((b: LocalFiscalBuffer) => b.type === type) as LocalFiscalBuffer;
    }

    // Fetch existing transactions to check for NCF duplicity
    const transactions = await dbAdapter.getCollection<Transaction>('transactions') || [];

    if (!buffer) {
      console.error(`❌ getNextNCF: Buffer for type ${type} is still undefined after request!`);
      return null;
    }

    let ncf = `${buffer.prefix}${buffer.currentNumber.toString().padStart(8, '0')}`;
    let isDuplicate = transactions.some(t => t.ncf === ncf);

    // If duplicate, skip and try next number in buffer
    while (isDuplicate && buffer.currentNumber <= buffer.endNumber) {
      console.warn(`⚠️ Duplicate NCF detected: ${ncf}. Skipping to next number.`);
      buffer.currentNumber += 1;

      if (buffer.currentNumber > buffer.endNumber) {
        // Buffer exhausted while skipping duplicates, need a new batch
        buffer = await db.requestFiscalBatch(terminalId, type, customBatchSize || 100) as LocalFiscalBuffer;
        if (!buffer) return null;
        // Refresh buffers
        buffers = await dbAdapter.getCollection<LocalFiscalBuffer>('localFiscalBuffer') || [];
        buffer = (buffers || []).find((b: LocalFiscalBuffer) => b.type === type) as LocalFiscalBuffer;
      }

      ncf = `${buffer.prefix}${buffer.currentNumber.toString().padStart(8, '0')}`;
      isDuplicate = transactions.some(t => t.ncf === ncf);
    }

    if (buffer.currentNumber > buffer.endNumber) return null;

    buffer.currentNumber += 1;
    await dbAdapter.saveCollection('localFiscalBuffer', buffers);
    return ncf;
  },

  getNextSequenceNumber: async (sequenceId: string): Promise<string | null> => {
    const sequences = await dbAdapter.getCollection<DocumentSeries>('internalSequences') || [];
    const seq = (sequences || []).find((s: DocumentSeries) => s.id === sequenceId);

    if (!seq) return null;

    const nextId = `${seq.prefix}${seq.nextNumber.toString().padStart(seq.padding, '0')}`;
    seq.nextNumber += 1;

    await dbAdapter.saveCollection('internalSequences', sequences);
    return nextId;
  },

  recordInventoryMovement: async (
    warehouseId: string,
    productId: string,
    concept: LedgerConcept,
    documentRef: string,
    qty: number,
    movementCost?: number,
    terminalId?: string,
    variantId?: string,
    variantName?: string,
    trackingId?: string,
    trackingCode?: string,
    effectiveDate?: string
  ): Promise<InventoryLedgerEntry | undefined> => {
    await assertInventoryMovementUnlocked(warehouseId, effectiveDate);

    const movementTimestamp = toValidMovementIso(effectiveDate);

    // 1. Create Ledger Entry (Temporary balance, will be recalculated)
    const qtyIn = qty > 0 ? qty : 0;
    const qtyOut = qty < 0 ? Math.abs(qty) : 0;

    const newEntry: InventoryLedgerEntry = {
      id: `LEG-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      productId: productId,
      warehouseId: warehouseId,
      concept: concept,
      documentRef: documentRef,
      createdAt: movementTimestamp,
      qtyIn: qtyIn,
      qtyOut: qtyOut,
      unitCost: movementCost || 0,
      balanceQty: 0, // Will be recalculated
      balanceAvgCost: 0, // Will be recalculated
      terminalId: terminalId || 'LOCAL',
      variantId,
      variantName,
      trackingId,
      trackingCode,
      syncStatus: 'PENDING'
    };

    const ledger = await dbAdapter.getCollection<InventoryLedgerEntry>('inventoryLedger') || [];
    const newLedger = [...ledger, newEntry];
    await dbAdapter.saveCollection('inventoryLedger', newLedger);

    // 2. Recalculate everything for this product/warehouse
    await db.recalculateProductStock(productId, warehouseId);

    // 3. Trigger background sync (using dynamic import to avoid circular dependency)
    import('../services/sync/BackgroundSyncManager').then(m => {
      m.backgroundSyncManager.triggerSync().catch(console.error);
    });

    return newEntry;
  },

  recordInventoryMovements: async (movements: {
    warehouseId: string,
    productId: string,
    concept: LedgerConcept,
    documentRef: string,
    qty: number,
    movementCost?: number,
    terminalId?: string,
    variantId?: string,
    variantName?: string,
    trackingId?: string,
    trackingCode?: string,
    effectiveDate?: string
  }[]): Promise<InventoryLedgerEntry[]> => {
    const newEntries: InventoryLedgerEntry[] = [];

    for (const move of movements) {
      await assertInventoryMovementUnlocked(move.warehouseId, move.effectiveDate);

      const movementTimestamp = toValidMovementIso(move.effectiveDate);
      const qtyIn = move.qty > 0 ? move.qty : 0;
      const qtyOut = move.qty < 0 ? Math.abs(move.qty) : 0;

      const newEntry: InventoryLedgerEntry = {
        id: `LEG-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        productId: move.productId,
        warehouseId: move.warehouseId,
        concept: move.concept,
        documentRef: move.documentRef,
        createdAt: movementTimestamp,
        qtyIn: qtyIn,
        qtyOut: qtyOut,
        unitCost: move.movementCost || 0,
        balanceQty: 0,
        balanceAvgCost: 0,
        terminalId: move.terminalId || 'LOCAL',
        variantId: move.variantId,
        variantName: move.variantName,
        trackingId: move.trackingId,
        trackingCode: move.trackingCode,
        syncStatus: 'PENDING'
      };

      // OPTIMIZATION: Save each entry individually to avoid rewriting the whole ledger
      await dbAdapter.saveDocument('inventoryLedger', newEntry);
      newEntries.push(newEntry);
    }

    // Recalculate all affected products
    const uniqueProductWarehousePairs = Array.from(new Set(movements.map(m => `${m.productId}|${m.warehouseId}`)));
    for (const pair of uniqueProductWarehousePairs) {
      const [productId, warehouseId] = pair.split('|');
      await db.recalculateProductStock(productId, warehouseId);
    }

    // Trigger background sync
    import('../services/sync/BackgroundSyncManager').then(m => {
      m.backgroundSyncManager.triggerSync().catch(console.error);
    });

    return newEntries;
  },

  recalculateProductStock: async (productId: string, warehouseId: string) => {
    if (permissionService.isSlaveTerminal()) {
      console.log(`ℹ️ Skipping stock recalculation for Product: ${productId} on Slave terminal. Preserving synced value.`);
      return;
    }
    console.log(`🔄 Recalculating stock for Product: ${productId}, Warehouse: ${warehouseId}`);

    // 1. Get all ledger entries
    const ledger = await dbAdapter.getCollection<InventoryLedgerEntry>('inventoryLedger');

    if (!ledger || !Array.isArray(ledger)) {
      console.error(`❌ Recalculate Error: Could not fetch 'inventoryLedger' collection for product ${productId}. Aborting to prevent data wipe!`);
      return;
    }

    console.log(`📊 Recalculate: ${ledger.length} total entries loaded from DB`);

    // 2. Filter entries for this product/warehouse
    const productEntries = ledger.filter(e => e.productId === productId && e.warehouseId === warehouseId);
    console.log(`🔍 Recalculate: ${productEntries.length} entries match Product: ${productId}, Warehouse: ${warehouseId}`);

    // If no entries found AND the product currently has stock, this is highly suspicious
    if (productEntries.length === 0) {
      console.warn(`⚠️ Recalculate: No ledger entries found for ${productId} @ ${warehouseId}. Resulting stock will be 0.`);
    }

    // 3. Stable Sort: Chronological + ID as tie-breaker
    productEntries.sort((a, b) => {
      const timeA = new Date(a.createdAt).getTime();
      const timeB = new Date(b.createdAt).getTime();
      if (timeA !== timeB) return timeA - timeB;
      return a.id.localeCompare(b.id);
    });

    // Recalculate balances
    let currentBalance = 0;
    let currentAvgCost = 0;

    // OPTIMIZATION: We only update the ledger entries in memory for this product/warehouse.
    // We DON'T save the whole ledger collection here because it's massive.
    // Instead, we update the product master directly at the end.

    for (const entry of productEntries) {
      currentBalance += (entry.qtyIn - entry.qtyOut);

      // Basic Avg Cost calculation
      if (entry.qtyIn > 0) {
        const totalValue = (currentBalance - entry.qtyIn) * currentAvgCost + (entry.qtyIn * entry.unitCost);
        currentAvgCost = currentBalance > 0 ? totalValue / currentBalance : entry.unitCost;
      }

      // PERSIST: Update the entry with calculated balance
      entry.balanceQty = currentBalance;
      entry.balanceAvgCost = currentAvgCost;

      // We save each entry individually. Since this is only for ONE product/warehouse,
      // the number of entries is usually small.
      await dbAdapter.saveDocument('inventoryLedger', entry);
    }

    // 7. Update Product Master
    const products = await dbAdapter.getCollection<Product>('products') || [];
    const product = (products || []).find(p => p.id === productId);
    if (product) {
      if (!product.stockBalances) product.stockBalances = {};
      product.stockBalances[warehouseId] = currentBalance;
      product.stock = Object.values(product.stockBalances).reduce((a, b) => a + (b as number), 0);
      product.cost = currentAvgCost;
      product.updatedAt = new Date().toISOString();

      console.log(`📝 Updating product ${product.id} (${product.name}): Stock=${product.stock}, Cost=${product.cost}, updatedAt=${product.updatedAt}`);

      // SUCCESS: Update only the product document
      await dbAdapter.saveDocument('products', product);
      console.log(`✅ Product ${productId} updated in database.`);

      // 8. Update Detailed Stocks Collection (productStocks)
      const stockId = `${productId}_${warehouseId}`;
      const productStock: ProductStock = {
        id: stockId,
        productId,
        warehouseId,
        quantity: currentBalance,
        updatedAt: new Date().toISOString()
      };
      await dbAdapter.saveDocument('productStocks', productStock);
      console.log(`✅ Detailed stock for ${productId} in ${warehouseId} updated: ${currentBalance}`);
    } else {
      console.error(`❌ Product ${productId} NOT FOUND!`);
    }

    console.log(`✅ Recalculation complete. Final balance: ${currentBalance}`);
  },

  getNextGlobalSequence: async (): Promise<number> => {
    const counter = await dbAdapter.getCollection('globalSequenceCounter') || 0;
    const next = (typeof counter === 'number' ? counter : 0) + 1;
    await dbAdapter.saveCollection('globalSequenceCounter', next as any);
    return next;
  },

  getNextSeriesNumber: async (seriesId: string): Promise<number> => {
    const sequences = await dbAdapter.getCollection<DocumentSeries>('internalSequences') || [];
    const series = (sequences || []).find((s: DocumentSeries) => s.id === seriesId);
    if (!series) throw new Error(`Series ${seriesId} not found`);

    const nextNumber = series.nextNumber;
    series.nextNumber += 1;
    await dbAdapter.saveCollection('internalSequences', sequences);
    return nextNumber;
  }
};
