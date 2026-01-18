
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

const DEFAULT_ALERTS = {
  maxDormancyDays: 30,
  minVelocity: 0.5,
  minSellThrough: 15,
  criticalWeeksOfSupply: 1,
  overstockWeeksOfSupply: 12
};

// --- SEED DATA ---
const DEFAULT_WAREHOUSES: Warehouse[] = [
    { id: "wh_central", code: "CEN", name: "Bodega Central", type: "PHYSICAL", address: "Calle Industria #45", allowPosSale: true, allowNegativeStock: false, isMain: true, storeId: "S1" },
    { id: "wh_norte", code: "NTE", name: "Piso de Venta Norte", type: "PHYSICAL", address: "Plaza Norte, Local 10", allowPosSale: true, allowNegativeStock: false, isMain: false, storeId: "S2" },
    { id: "wh_mermas", code: "MER", name: "Mermas & Dañados", type: "VIRTUAL", address: "N/A", allowPosSale: false, allowNegativeStock: false, isMain: false, storeId: "S1" }
];

const SEED_DATA = {
  config: (() => {
    const baseConfig = getInitialConfig('Supermercado' as any);
    if (baseConfig.terminals[0]) {
       baseConfig.terminals[0].config.inventoryScope = {
          defaultSalesWarehouseId: "wh_central",
          visibleWarehouseIds: DEFAULT_WAREHOUSES.map(w => w.id)
       };
       // Initial multi-NCF config
       baseConfig.terminals[0].config.fiscal = {
          batchSize: 100,
          lowBatchThreshold: 20,
          typeConfigs: {
             'B01': { batchSize: 50, lowBatchThreshold: 20 },
             'B02': { batchSize: 500, lowBatchThreshold: 10 }
          }
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
    createdAt: new Date(Date.now() - (Math.random() * 90 * 24 * 60 * 60 * 1000)).toISOString(),
    cost: p.cost || p.price * 0.6,
    stockBalances: p.name.includes('Tomate') 
      ? { "wh_central": 100, "wh_norte": 0 } 
      : p.name.includes('Zapatillas') 
      ? { "wh_central": 5, "wh_norte": 50 } 
      : { "wh_central": Math.floor(p.stock || 0), "wh_norte": 0 }
  })),
  transactions: [] as Transaction[],
  cashMovements: [] as CashMovement[],
  transfers: [] as StockTransfer[],
  parkedTickets: [] as ParkedTicket[],
  purchaseOrders: [] as PurchaseOrder[],
  suppliers: [
    { id: 'sup1', name: 'Distribuidora Global', contactName: 'Juan Distribuidor', phone: '809-555-1111', email: 'ventas@global.com' },
    { id: 'sup2', name: 'Frescos del Campo', contactName: 'Maria Campo', phone: '809-555-2222', email: 'maria@frescos.com' }
  ] as Supplier[],
  inventoryLedger: [] as InventoryLedgerEntry[],
  watchlists: [] as Watchlist[],
  // --- FISCAL COLLECTIONS ---
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
    if (!data.inventoryLedger) { data.inventoryLedger = []; modified = true; }
    if (!data.fiscalRanges) { data.fiscalRanges = SEED_DATA.fiscalRanges; modified = true; }
    if (!data.fiscalAllocations) { data.fiscalAllocations = []; modified = true; }
    if (!data.localFiscalBuffer) { data.localFiscalBuffer = []; modified = true; }

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

  // --- CORE FISCAL LOGIC: BATCH ALLOCATION ---
  
  /**
   * Verifica si es posible pedir más NCFs del pool global.
   */
  canRequestMoreNCF: (type: NCFType): boolean => {
    const data = JSON.parse(localStorage.getItem(DB_KEY) || '{}');
    const range = data.fiscalRanges.find((r: FiscalRangeDGII) => r.type === type && r.isActive);
    if (!range) return false;
    if (new Date(range.expiryDate) < new Date()) return false;
    return range.currentGlobal < range.endNumber;
  },

  /**
   * Solicita un nuevo lote de NCFs al servidor central.
   */
  requestFiscalBatch: (terminalId: string, type: NCFType, batchSize: number): LocalFiscalBuffer | null => {
    const data = JSON.parse(localStorage.getItem(DB_KEY) || '{}');
    const range = data.fiscalRanges.find((r: FiscalRangeDGII) => r.type === type && r.isActive);

    if (!range) return null;

    if (new Date(range.expiryDate) < new Date()) {
      console.error("Rango fiscal vencido.");
      return null;
    }

    // El primer número disponible es el último entregado + 1
    const start = range.currentGlobal + 1;
    const end = Math.min(range.endNumber, start + batchSize - 1);

    if (start > range.endNumber) {
      console.error("Rango fiscal agotado totalmente en el servidor.");
      return null;
    }

    const allocation: FiscalAllocation = {
      id: `AL-${Date.now()}`,
      terminalId,
      type,
      rangeStart: start,
      rangeEnd: end,
      assignedAt: new Date().toISOString(),
      status: 'ACTIVE'
    };

    // Actualizar servidor (Data central): Descontamos estrictamente del pool
    range.currentGlobal = end;
    data.fiscalAllocations.push(allocation);

    const localBuffer: LocalFiscalBuffer = {
      type,
      prefix: range.prefix,
      currentNumber: start,
      endNumber: end,
      expiryDate: range.expiryDate
    };

    const existingBufferIdx = data.localFiscalBuffer.findIndex((b: LocalFiscalBuffer) => b.type === type);
    if (existingBufferIdx >= 0) {
      data.localFiscalBuffer[existingBufferIdx] = localBuffer;
    } else {
      data.localFiscalBuffer.push(localBuffer);
    }

    localStorage.setItem(DB_KEY, JSON.stringify(data));
    return localBuffer;
  },

  /**
   * Consume el siguiente NCF disponible en el buffer local.
   */
  getNextNCF: (type: NCFType, terminalId: string, customBatchSize?: number): string | null => {
    const data = JSON.parse(localStorage.getItem(DB_KEY) || '{}');
    let buffer = data.localFiscalBuffer.find((b: LocalFiscalBuffer) => b.type === type);

    const terminalConfig = data.config.terminals.find((t: any) => t.id === terminalId);
    const size = customBatchSize || terminalConfig?.config.fiscal?.typeConfigs?.[type]?.batchSize || terminalConfig?.config.fiscal?.batchSize || 100;

    if (!buffer || buffer.currentNumber > buffer.endNumber) {
      buffer = db.requestFiscalBatch(terminalId, type, size);
      if (!buffer) return null; 
    }

    const ncf = `${buffer.prefix}${buffer.currentNumber.toString().padStart(8, '0')}`;
    buffer.currentNumber += 1;
    
    localStorage.setItem(DB_KEY, JSON.stringify(data));
    return ncf;
  },

  recordInventoryMovement: (
    warehouseId: string, 
    productId: string, 
    concept: LedgerConcept, 
    documentRef: string,
    qty: number,
    movementCost?: number
  ) => {
    const data = JSON.parse(localStorage.getItem(DB_KEY) || '{}');
    const productIndex = data.products.findIndex((p: Product) => p.id === productId);
    if (productIndex === -1) return;

    const product = data.products[productIndex];
    const currentStock = product.stockBalances?.[warehouseId] || 0;
    const currentAvgCost = product.cost || 0;
    
    let newAvgCost = currentAvgCost;
    if (qty > 0 && movementCost !== undefined) {
      if (currentStock <= 0) {
        newAvgCost = movementCost;
      } else {
        const totalValueBefore = currentStock * currentAvgCost;
        const incomingValue = qty * movementCost;
        newAvgCost = (totalValueBefore + incomingValue) / (currentStock + qty);
      }
    }

    const newBalanceQty = currentStock + qty;
    const entry: InventoryLedgerEntry = {
      id: `LEDGER_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      createdAt: new Date().toISOString(),
      warehouseId,
      productId,
      concept,
      documentRef,
      qtyIn: qty > 0 ? qty : 0,
      qtyOut: qty < 0 ? Math.abs(qty) : 0,
      unitCost: qty > 0 ? (movementCost || currentAvgCost) : currentAvgCost,
      balanceQty: newBalanceQty,
      balanceAvgCost: newAvgCost
    };

    product.cost = newAvgCost;
    if (!product.stockBalances) product.stockBalances = {};
    product.stockBalances[warehouseId] = newBalanceQty;
    product.stock = Object.values(product.stockBalances).reduce((a: any, b: any) => a + b, 0);

    data.inventoryLedger = [entry, ...(data.inventoryLedger || [])];
    localStorage.setItem(DB_KEY, JSON.stringify(data));
    return entry;
  }
};
