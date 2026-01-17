
import { 
  BusinessConfig, Product, User, Customer, Transaction, 
  Warehouse, StockTransfer, CashMovement 
} from '../types';
import { 
  MOCK_USERS, RETAIL_PRODUCTS, FOOD_PRODUCTS, 
  MOCK_CUSTOMERS, INITIAL_TARIFFS, getInitialConfig 
} from '../constants';

const DB_KEY = 'clic_pos_db_v1';

// --- SEED DATA (El escenario de prueba complejo) ---
// Definimos los almacenes por defecto para usarlos en el seed y en la reparación
const DEFAULT_WAREHOUSES: Warehouse[] = [
    { 
      id: "wh_central", 
      code: "CEN", 
      name: "Bodega Central", 
      type: "PHYSICAL", 
      address: "Calle Industria #45", 
      allowPosSale: true, 
      allowNegativeStock: false, 
      isMain: true, 
      storeId: "S1" 
    },
    { 
      id: "wh_norte", 
      code: "NTE", 
      name: "Piso de Venta Norte", 
      type: "PHYSICAL", 
      address: "Plaza Norte, Local 10", 
      allowPosSale: true, 
      allowNegativeStock: false, 
      isMain: false, 
      storeId: "S2" 
    },
    { 
      id: "wh_mermas", 
      code: "MER", 
      name: "Mermas & Dañados", 
      type: "VIRTUAL", 
      address: "N/A", 
      allowPosSale: false, 
      allowNegativeStock: false, 
      isMain: false, 
      storeId: "S1"
    }
];

const SEED_DATA = {
  config: (() => {
    const baseConfig = getInitialConfig('Supermercado' as any);
    // Asegurar que la terminal por defecto vea todos los almacenes del seed
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
  products: RETAIL_PRODUCTS.map(p => {
    // Enriquecer productos con stock diferenciado para la prueba
    if (p.name.includes('Tomate')) {
       return {
         ...p,
         activeInWarehouses: ["wh_central"], // Solo en central
         stockBalances: { "wh_central": 100, "wh_norte": 0 }
       };
    }
    if (p.name.includes('Zapatillas')) {
       return {
         ...p,
         activeInWarehouses: ["wh_central", "wh_norte"],
         stockBalances: { "wh_central": 5, "wh_norte": 50 } // Stock mayor en norte
       };
    }
    return {
       ...p,
       // Default stock distribution for others
       stockBalances: { "wh_central": Math.floor(p.stock || 0), "wh_norte": 0 }
    };
  }),
  transactions: [] as Transaction[],
  cashMovements: [] as CashMovement[],
  transfers: [] as StockTransfer[]
};

// --- DB MANAGER ---

export const db = {
  init: () => {
    const existing = localStorage.getItem(DB_KEY);
    if (!existing) {
      console.log("🌱 Sembrando base de datos local...");
      localStorage.setItem(DB_KEY, JSON.stringify(SEED_DATA));
      return SEED_DATA;
    }
    try {
      const data = JSON.parse(existing);
      let hasChanges = false;

      // 1. REPARACIÓN ROBUSTA DE ALMACENES: Verificar por ID, no solo longitud
      const existingIds = new Set((data.warehouses || []).map((w: Warehouse) => w.id));
      const missingWarehouses = DEFAULT_WAREHOUSES.filter(dw => !existingIds.has(dw.id));

      if (missingWarehouses.length > 0) {
         console.log("🛠️ Reparando almacenes faltantes:", missingWarehouses.map(w => w.name));
         data.warehouses = [...(data.warehouses || []), ...missingWarehouses];
         hasChanges = true;
      }

      // 2. REPARACIÓN DE CONFIGURACIÓN DE TERMINAL: Asegurar visibilidad
      if (data.config && data.config.terminals) {
         data.config.terminals.forEach((term: any) => {
             // Asegurar estructura
             if (!term.config.inventoryScope) {
                 term.config.inventoryScope = {
                     defaultSalesWarehouseId: "wh_central",
                     visibleWarehouseIds: []
                 };
                 hasChanges = true;
             }

             const visibleIds = new Set(term.config.inventoryScope.visibleWarehouseIds || []);
             const missingVisible = DEFAULT_WAREHOUSES.filter(dw => !visibleIds.has(dw.id));
             
             if (missingVisible.length > 0) {
                 console.log(`🛠️ Actualizando visibilidad terminal ${term.id}`);
                 term.config.inventoryScope.visibleWarehouseIds = [
                     ...(term.config.inventoryScope.visibleWarehouseIds || []),
                     ...missingVisible.map(w => w.id)
                 ];
                 hasChanges = true;
             }
         });
      }

      if (hasChanges) {
         localStorage.setItem(DB_KEY, JSON.stringify(data));
         console.log("✅ Base de datos actualizada y reparada.");
      }

      return data;
    } catch (e) {
      console.error("Database corrupta, reiniciando...");
      localStorage.setItem(DB_KEY, JSON.stringify(SEED_DATA));
      return SEED_DATA;
    }
  },

  reset: () => {
    localStorage.removeItem(DB_KEY);
    window.location.reload(); // Forzar recarga para re-sembrar
  },

  get: (collection: keyof typeof SEED_DATA) => {
    const data = JSON.parse(localStorage.getItem(DB_KEY) || '{}');
    return data[collection] || SEED_DATA[collection];
  },

  save: (collection: keyof typeof SEED_DATA, payload: any) => {
    const data = JSON.parse(localStorage.getItem(DB_KEY) || '{}');
    data[collection] = payload;
    localStorage.setItem(DB_KEY, JSON.stringify(data));
  }
};
