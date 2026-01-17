
import { 
  BusinessConfig, Product, User, Customer, Transaction, 
  Warehouse, StockTransfer, CashMovement, InventoryLedgerEntry, LedgerConcept,
  // Add missing types for SEED_DATA
  RoleDefinition, ParkedTicket, PurchaseOrder, Supplier
} from '../types';
import { 
  MOCK_USERS, RETAIL_PRODUCTS, FOOD_PRODUCTS, 
  MOCK_CUSTOMERS, INITIAL_TARIFFS, getInitialConfig,
  // Add missing constant for SEED_DATA
  DEFAULT_ROLES
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
  // Add roles to SEED_DATA
  roles: DEFAULT_ROLES,
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
  // Add parkedTickets to SEED_DATA
  parkedTickets: [] as ParkedTicket[],
  // Add purchaseOrders to SEED_DATA
  purchaseOrders: [] as PurchaseOrder[],
  // Add suppliers to SEED_DATA
  suppliers: [
    { id: 'sup1', name: 'Distribuidora Global', contactName: 'Juan Distribuidor', phone: '809-555-1111', email: 'ventas@global.com' },
    { id: 'sup2', name: 'Frescos del Campo', contactName: 'Maria Campo', phone: '809-555-2222', email: 'maria@frescos.com' }
  ] as Supplier[],
  inventoryLedger: [] as InventoryLedgerEntry[] // Nueva colección de Kardex
};

// --- DB MANAGER ---

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

    // Ensure all required collections exist (backward compatibility for old local storage)
    let modified = false;
    if (!data.inventoryLedger) { data.inventoryLedger = []; modified = true; }
    if (!data.roles) { data.roles = SEED_DATA.roles; modified = true; }
    if (!data.parkedTickets) { data.parkedTickets = []; modified = true; }
    if (!data.purchaseOrders) { data.purchaseOrders = []; modified = true; }
    if (!data.suppliers) { data.suppliers = SEED_DATA.suppliers; modified = true; }

    // ENFORCE INITIAL MOVEMENT if missing for products with stock
    data.products.forEach((p: Product) => {
        const hasLedger = data.inventoryLedger.some((e: InventoryLedgerEntry) => e.productId === p.id);
        if (!hasLedger && p.stockBalances) {
            Object.entries(p.stockBalances).forEach(([whId, qty]) => {
                if (qty > 0) {
                    const entry: InventoryLedgerEntry = {
                        id: `INIT_${p.id}_${whId}_${Date.now()}`,
                        createdAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
                        warehouseId: whId,
                        productId: p.id,
                        concept: 'INICIAL',
                        documentRef: 'Apertura de Sistema',
                        qtyIn: qty,
                        qtyOut: 0,
                        unitCost: p.cost || 0,
                        balanceQty: qty,
                        balanceAvgCost: p.cost || 0
                    };
                    data.inventoryLedger.push(entry);
                    modified = true;
                }
            });
        }
    });

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
    const productIndex = data.products.findIndex((p: Product) => p.id === productId);
    if (productIndex === -1) return;

    const product = data.products[productIndex];
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

    // Actualizar producto en la estructura de datos local de la DB
    product.cost = newAvgCost;
    if (!product.stockBalances) product.stockBalances = {};
    product.stockBalances[warehouseId] = newBalanceQty;
    product.stock = Object.values(product.stockBalances).reduce((a: any, b: any) => a + b, 0);

    // Guardar ledger e integrar cambios al producto
    data.inventoryLedger = [entry, ...(data.inventoryLedger || [])];
    localStorage.setItem(DB_KEY, JSON.stringify(data));
    return entry;
  }
};
