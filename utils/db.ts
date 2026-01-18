
import { 
  BusinessConfig, Product, User, Customer, Transaction, 
  Warehouse, StockTransfer, CashMovement, InventoryLedgerEntry, LedgerConcept,
  RoleDefinition, ParkedTicket, PurchaseOrder, Supplier, Watchlist,
  NCFType, FiscalRangeDGII, FiscalAllocation, LocalFiscalBuffer
} from '../types';
import { 
  MOCK_USERS, RETAIL_PRODUCTS, FOOD_PRODUCTS, 
  MOCK_CUSTOMERS, INITIAL_TARIFFS, getInitialConfig,
  DEFAULT_ROLES
} from '../constants';

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
  fiscalRanges: [
    { id: 'fr1', type: 'B01', prefix: 'B01', startNumber: 1, endNumber: 10000, currentGlobal: 0, expiryDate: '2026-12-31', isActive: true },
    { id: 'fr2', type: 'B02', prefix: 'B02', startNumber: 1, endNumber: 50000, currentGlobal: 0, expiryDate: '2026-12-31', isActive: true }
  ] as FiscalRangeDGII[],
  fiscalAllocations: [] as FiscalAllocation[],
  localFiscalBuffer: [] as LocalFiscalBuffer[]
};

export const db = {
  init: () => {
    let data;
    const existing = localStorage.getItem(DB_KEY);
    if (!existing) {
      data = JSON.parse(JSON.stringify(SEED_DATA));
    } else {
      try {
        data = JSON.parse(existing);
      } catch (e) {
        data = JSON.parse(JSON.stringify(SEED_DATA));
      }
    }

    let modified = false;

    if (!data.config) data.config = JSON.parse(JSON.stringify(SEED_DATA.config));
    if (!data.config.availablePrinters) { data.config.availablePrinters = []; modified = true; }
    
    if (data.config.terminals && Array.isArray(data.config.terminals)) {
      data.config.terminals.forEach((t: any) => {
        if (!t.config.hardware) {
          t.config.hardware = { printerAssignments: {}, scales: [] };
          modified = true;
        }
        // Ensure customer display structure
        if (!t.config.hardware.customerDisplay) {
          t.config.hardware.customerDisplay = {
            isEnabled: false,
            welcomeMessage: '¡Bienvenido!',
            showItemImages: true,
            showQrPayment: true,
            layout: 'SPLIT',
            connectionType: 'VIRTUAL',
            ads: []
          };
          modified = true;
        }
        if (!t.config.hardware.customerDisplay.ads) {
          t.config.hardware.customerDisplay.ads = [];
          modified = true;
        }
      });
    }

    if (!existing || modified) {
      localStorage.setItem(DB_KEY, JSON.stringify(data));
    }
    return data;
  },

  reset: () => {
    localStorage.removeItem(DB_KEY);
    window.location.reload();
  },

  get: (collection: keyof typeof SEED_DATA) => {
    const data = JSON.parse(localStorage.getItem(DB_KEY) || '{}');
    return data[collection] || (SEED_DATA as any)[collection];
  },

  save: (collection: keyof typeof SEED_DATA, payload: any) => {
    const data = JSON.parse(localStorage.getItem(DB_KEY) || '{}');
    data[collection] = payload;
    localStorage.setItem(DB_KEY, JSON.stringify(data));
  },

  canRequestMoreNCF: (type: NCFType): boolean => {
    const data = JSON.parse(localStorage.getItem(DB_KEY) || '{}');
    const range = data.fiscalRanges?.find((r: FiscalRangeDGII) => r.type === type && r.isActive);
    if (!range) return false;
    return range.currentGlobal < range.endNumber;
  },

  requestFiscalBatch: (terminalId: string, type: NCFType, batchSize: number): LocalFiscalBuffer | null => {
    const data = JSON.parse(localStorage.getItem(DB_KEY) || '{}');
    const range = data.fiscalRanges?.find((r: FiscalRangeDGII) => r.type === type && r.isActive);
    if (!range || range.currentGlobal >= range.endNumber) return null;

    const start = range.currentGlobal + 1;
    const end = Math.min(range.endNumber, start + batchSize - 1);
    range.currentGlobal = end;

    const localBuffer: LocalFiscalBuffer = { type, prefix: range.prefix, currentNumber: start, endNumber: end, expiryDate: range.expiryDate };
    data.localFiscalBuffer = (data.localFiscalBuffer || []).filter((b: any) => b.type !== type).concat(localBuffer);

    localStorage.setItem(DB_KEY, JSON.stringify(data));
    return localBuffer;
  },

  getNextNCF: (type: NCFType, terminalId: string, customBatchSize?: number): string | null => {
    const data = JSON.parse(localStorage.getItem(DB_KEY) || '{}');
    let buffer = data.localFiscalBuffer?.find((b: LocalFiscalBuffer) => b.type === type);
    if (!buffer || buffer.currentNumber > buffer.endNumber) {
      buffer = db.requestFiscalBatch(terminalId, type, customBatchSize || 100);
      if (!buffer) return null; 
    }
    const ncf = `${buffer.prefix}${buffer.currentNumber.toString().padStart(8, '0')}`;
    buffer.currentNumber += 1;
    localStorage.setItem(DB_KEY, JSON.stringify(data));
    return ncf;
  },

  recordInventoryMovement: (warehouseId: string, productId: string, concept: LedgerConcept, documentRef: string, qty: number, movementCost?: number) => {
    const data = JSON.parse(localStorage.getItem(DB_KEY) || '{}');
    const product = data.products.find((p: Product) => p.id === productId);
    if (!product) return;
    if (!product.stockBalances) product.stockBalances = {};
    product.stockBalances[warehouseId] = (product.stockBalances[warehouseId] || 0) + qty;
    product.stock = Object.values(product.stockBalances).reduce((a: any, b: any) => a + (b as number), 0);
    localStorage.setItem(DB_KEY, JSON.stringify(data));
  }
};
