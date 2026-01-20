
import {
  BusinessConfig, Product, User, Customer, Transaction,
  Warehouse, StockTransfer, CashMovement, InventoryLedgerEntry, LedgerConcept,
  RoleDefinition, ParkedTicket, PurchaseOrder, Supplier, Watchlist,
  NCFType, FiscalRangeDGII, FiscalAllocation, LocalFiscalBuffer, DocumentSeries
} from '../types';
import {
  MOCK_USERS, RETAIL_PRODUCTS, FOOD_PRODUCTS,
  MOCK_CUSTOMERS, INITIAL_TARIFFS, getInitialConfig,
  DEFAULT_ROLES, DEFAULT_TERMINAL_CONFIG, DEFAULT_DOCUMENT_SERIES
} from '../constants';
import { dbAdapter } from '../services/db';

const DB_KEY = 'clic_pos_db_v1';

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
  cashMovements: [] as CashMovement[],
  transfers: [] as StockTransfer[],
  parkedTickets: [] as ParkedTicket[],
  purchaseOrders: [] as PurchaseOrder[],
  suppliers: [] as Supplier[],
  inventoryLedger: [] as InventoryLedgerEntry[],
  watchlists: [] as Watchlist[],
  internalSequences: DEFAULT_DOCUMENT_SERIES as DocumentSeries[],
  fiscalRanges: [
    { id: 'fr1', type: 'B01', prefix: 'B01', startNumber: 1, endNumber: 10000, currentGlobal: 0, expiryDate: '2026-12-31', isActive: true },
    { id: 'fr2', type: 'B02', prefix: 'B02', startNumber: 1, endNumber: 50000, currentGlobal: 0, expiryDate: '2026-12-31', isActive: true }
  ] as FiscalRangeDGII[],
  fiscalAllocations: [] as FiscalAllocation[],
  localFiscalBuffer: [] as LocalFiscalBuffer[]
};

export const db = {
  init: async () => {
    await dbAdapter.connect();

    // Check if seeded
    const existingConfig = await dbAdapter.getCollection('config');
    if (!existingConfig || Object.keys(existingConfig).length === 0) {
      // Seed all collections
      for (const [key, value] of Object.entries(SEED_DATA)) {
        if (key === 'config') {
          // Config is a single object, but our adapter expects collections usually. 
          // For LocalStorageAdapter we treat everything as key-value, but let's standardize.
          // Special case for config in this specific legacy db structure
          await dbAdapter.saveCollection(key, value as any);
        } else {
          await dbAdapter.saveCollection(key, value as any[]);
        }
      }
      return SEED_DATA;
    }

    // Load all data to return consistent structure (Legacy support)
    const data: any = {};
    for (const key of Object.keys(SEED_DATA)) {
      data[key] = await dbAdapter.getCollection(key);
    }
    return data;
  },

  reset: async () => {
    localStorage.removeItem(DB_KEY);
    window.location.reload();
  },

  get: async (collection: keyof typeof SEED_DATA) => {
    return await dbAdapter.getCollection(collection as string);
  },

  save: async (collection: keyof typeof SEED_DATA, payload: any) => {
    // This is tricky because legacy 'save' replaced the whole collection or object
    await dbAdapter.saveCollection(collection as string, payload);
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

    const localBuffer: LocalFiscalBuffer = { type, prefix: range.prefix, currentNumber: start, endNumber: end, expiryDate: range.expiryDate };

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
    let buffer = buffers.find((b: LocalFiscalBuffer) => b.type === type);

    if (!buffer || buffer.currentNumber > buffer.endNumber) {
      buffer = await db.requestFiscalBatch(terminalId, type, customBatchSize || 100) as LocalFiscalBuffer;
      if (!buffer) return null;
      // Refresh buffers after request
      buffers = await dbAdapter.getCollection<LocalFiscalBuffer>('localFiscalBuffer') || [];
      buffer = buffers.find((b: LocalFiscalBuffer) => b.type === type) as LocalFiscalBuffer;
    }

    const ncf = `${buffer.prefix}${buffer.currentNumber.toString().padStart(8, '0')}`;
    buffer.currentNumber += 1;

    await dbAdapter.saveCollection('localFiscalBuffer', buffers);
    return ncf;
  },

  getNextSequenceNumber: async (sequenceId: string): Promise<string | null> => {
    const sequences = await dbAdapter.getCollection<DocumentSeries>('internalSequences') || [];
    const seq = sequences.find((s: DocumentSeries) => s.id === sequenceId);

    if (!seq) return null;

    const nextId = `${seq.prefix}${seq.nextNumber.toString().padStart(seq.padding, '0')}`;
    seq.nextNumber += 1;

    await dbAdapter.saveCollection('internalSequences', sequences);
    return nextId;
  },

  recordInventoryMovement: async (warehouseId: string, productId: string, concept: LedgerConcept, documentRef: string, qty: number, movementCost?: number) => {
    const products = await dbAdapter.getCollection<Product>('products');
    const product = products.find((p: Product) => p.id === productId);
    if (!product) return;

    // 1. Update Product Stock
    if (!product.stockBalances) product.stockBalances = {};
    const previousStock = product.stockBalances[warehouseId] || 0;
    const newStock = previousStock + qty;

    product.stockBalances[warehouseId] = newStock;
    product.stock = Object.values(product.stockBalances).reduce((a: any, b: any) => a + (b as number), 0);

    await dbAdapter.saveCollection('products', products);

    // 2. Create Ledger Entry
    const ledger = await dbAdapter.getCollection<InventoryLedgerEntry>('inventoryLedger') || [];

    const qtyIn = qty > 0 ? qty : 0;
    const qtyOut = qty < 0 ? Math.abs(qty) : 0;

    const newEntry: InventoryLedgerEntry = {
      id: `LEG-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      productId: productId,
      warehouseId: warehouseId,
      concept: concept,
      documentRef: documentRef,
      createdAt: new Date().toISOString(),
      qtyIn: qtyIn,
      qtyOut: qtyOut,
      unitCost: movementCost || product.cost || 0,
      balanceQty: newStock,
      balanceAvgCost: product.cost || 0 // Assuming avg cost is same as current cost for now
    };

    console.log("📝 Recording Inventory Movement:", newEntry);
    const newLedger = [...ledger, newEntry];
    await dbAdapter.saveCollection('inventoryLedger', newLedger);
    console.log("✅ Inventory Ledger Saved. Total entries:", newLedger.length);
  }
};

