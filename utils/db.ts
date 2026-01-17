
import { 
  BusinessConfig, Product, User, Customer, Transaction, 
  Warehouse, StockTransfer, CashMovement, InventoryLedgerEntry, LedgerConcept 
} from '../types';
import { 
  MOCK_USERS, RETAIL_PRODUCTS, FOOD_PRODUCTS, 
  MOCK_CUSTOMERS, INITIAL_TARIFFS, getInitialConfig 
} from '../constants';

const DB_KEY = 'clic_pos_db_v1';

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
    }
    return baseConfig;
  })(),
  users: MOCK_USERS,
  customers: MOCK_CUSTOMERS,
  warehouses: DEFAULT_WAREHOUSES,
  products: RETAIL_PRODUCTS.map(p => ({
    ...p,
    cost: p.cost || p.price * 0.6, // Asegurar que tengan un costo inicial
    stockBalances: p.name.includes('Tomate') 
      ? { "wh_central": 100, "wh_norte": 0 } 
      : p.name.includes('Zapatillas') 
      ? { "wh_central": 5, "wh_norte": 50 } 
      : { "wh_central": Math.floor(p.stock || 0), "wh_norte": 0 }
  })),
  transactions: [] as Transaction[],
  cashMovements: [] as CashMovement[],
  transfers: [] as StockTransfer[],
  inventoryLedger: [] as InventoryLedgerEntry[] // Nueva colección de Kardex
};

// --- DB MANAGER ---

export const db = {
  init: () => {
    const existing = localStorage.getItem(DB_KEY);
    if (!existing) {
      localStorage.setItem(DB_KEY, JSON.stringify(SEED_DATA));
      return SEED_DATA;
    }
    try {
      const data = JSON.parse(existing);
      if (!data.inventoryLedger) data.inventoryLedger = [];
      return data;
    } catch (e) {
      localStorage.setItem(DB_KEY, JSON.stringify(SEED_DATA));
      return SEED_DATA;
    }
  },

  reset: () => {
    localStorage.removeItem(DB_KEY);
    window.location.reload();
  },

  get: (collection: keyof typeof SEED_DATA) => {
    const data = JSON.parse(localStorage.getItem(DB_KEY) || '{}');
    return data[collection] || SEED_DATA[collection];
  },

  save: (collection: keyof typeof SEED_DATA, payload: any) => {
    const data = JSON.parse(localStorage.getItem(DB_KEY) || '{}');
    data[collection] = payload;
    localStorage.setItem(DB_KEY, JSON.stringify(data));
  },

  // --- CORE KARDEX LOGIC ---
  
  /**
   * Registra un movimiento y recalcula el costo promedio ponderado si es una entrada.
   */
  recordInventoryMovement: (
    warehouseId: string, 
    productId: string, 
    concept: LedgerConcept, 
    documentRef: string,
    qty: number, // Positivo para entradas, Negativo para salidas
    movementCost?: number // Requerido para compras/ajustes entrada
  ) => {
    const data = JSON.parse(localStorage.getItem(DB_KEY) || '{}');
    const product = data.products.find((p: Product) => p.id === productId);
    if (!product) return;

    const currentStock = product.stockBalances?.[warehouseId] || 0;
    const currentAvgCost = product.cost || 0;
    
    let newAvgCost = currentAvgCost;
    
    // Algoritmo CPP: Solo recalculamos en entradas de valor (Compras/Ajustes)
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

    // Actualizar producto
    product.cost = newAvgCost;
    if (!product.stockBalances) product.stockBalances = {};
    product.stockBalances[warehouseId] = newBalanceQty;
    product.stock = Object.values(product.stockBalances).reduce((a: any, b: any) => a + b, 0);

    // Guardar
    data.inventoryLedger = [entry, ...(data.inventoryLedger || [])];
    localStorage.setItem(DB_KEY, JSON.stringify(data));
    return entry;
  }
};
