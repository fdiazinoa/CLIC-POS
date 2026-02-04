
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- CONFIGURACIÓN DEL ESCENARIO DE PRUEBA ---

const COMPANIES = [
  {
    name: "CLIC POS Corp",
    rnc: "101-55555-9",
    phone: "809-555-0001",
    address: "Av. Winston Churchill, Torre Empresarial"
  }
];

const WAREHOUSES = [
  {
    id: "wh_central",
    code: "CEN",
    name: "Bodega Central",
    type: "PHYSICAL",
    address: "Calle Industria #45",
    allowPosSale: true,
    allowNegativeStock: false,
    isMain: true,
    storeId: "S1" // Tienda Centro
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
    storeId: "S2" // Tienda Norte
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

// Configuración de Terminales para probar reglas de bloqueo
const TERMINALS = [
  {
    id: "T1",
    config: {
      // T1: Configuración Correcta (Vende desde Bodega Central)
      inventoryScope: {
        defaultSalesWarehouseId: "wh_central",
        visibleWarehouseIds: ["wh_central", "wh_mermas"]
      },
      security: { requirePinForVoid: true, requirePinForDiscount: true, autoLogoutMinutes: 15 },
      pricing: { allowedTariffIds: ["trf-gen"], defaultTariffId: "trf-gen" },
      workflow: {
        inventory: { realTimeValidation: true, allowNegativeStock: false, showStockOnTiles: true },
        session: { blindClose: true, maxCashInDrawer: 50000 }
      },
      hardware: { cashDrawerTrigger: "PRINTER" }
    }
  },
  {
    id: "T2",
    config: {
      // T2: Configuración ERRÓNEA (Sin almacén asignado -> Debe mostrar pantalla de bloqueo)
      inventoryScope: {
        defaultSalesWarehouseId: null,
        visibleWarehouseIds: []
      },
      security: { requirePinForVoid: false },
      pricing: { allowedTariffIds: ["trf-gen"], defaultTariffId: "trf-gen" },
      workflow: { inventory: { realTimeValidation: true } }
    }
  }
];

const PRODUCTS = [
  {
    id: "prod_tomate",
    name: "Tomate Barceló (Fresco)",
    price: 35.00,
    cost: 15.00,
    category: "Verduras",
    type: "SERVICE", // Pesado
    barcode: "VER-001",
    trackStock: true,
    // Escenario de Integridad: Activo solo en Central, con stock.
    activeInWarehouses: ["wh_central"],
    stockBalances: {
      "wh_central": 100, // Stock físico real
      "wh_norte": 0,      // No debería aparecer en T2 (si tuviera config)
      "wh_mermas": 0
    },
    variants: [],
    tariffs: [{ tariffId: "trf-gen", price: 35.00 }],
    image: "https://images.unsplash.com/photo-1592924357228-91a4daadcfea?q=80&w=200&auto=format&fit=crop"
  },
  {
    id: "p-var-1",
    name: "Zapatillas Runner 5.0",
    price: 85.00,
    cost: 40.00,
    category: "Calzado",
    type: "PRODUCT",
    barcode: "RUN-001",
    trackStock: true,
    activeInWarehouses: ["wh_central", "wh_norte"],
    stockBalances: { "wh_central": 10, "wh_norte": 0 },
    warehouseSettings: {
      "wh_central": { min: 20, max: 50 }
    },
    attributes: [
      { id: "attr_size", name: "Talla", options: ["38", "39", "40", "41", "42"], optionCodes: ["38", "39", "40", "41", "42"] },
      { id: "attr_color", name: "Color", options: ["Rojo", "Azul", "Negro"], optionCodes: ["RJ", "AZ", "NG"] }
    ],
    variants: [
      { sku: 'RUN-01-38-RJ', barcode: ['RUN0138RJ'], attributeValues: { 'Talla': '38', 'Color': 'Rojo' }, price: 85.00 },
      { sku: 'RUN-01-39-RJ', barcode: ['RUN0139RJ'], attributeValues: { 'Talla': '39', 'Color': 'Rojo' }, price: 85.00 },
      { sku: 'RUN-01-40-RJ', barcode: ['RUN0140RJ'], attributeValues: { 'Talla': '40', 'Color': 'Rojo' }, price: 85.00 },
      { sku: 'RUN-01-41-RJ', barcode: ['RUN0141RJ'], attributeValues: { 'Talla': '41', 'Color': 'Rojo' }, price: 85.00 },
      { sku: 'RUN-01-42-RJ', barcode: ['RUN0142RJ'], attributeValues: { 'Talla': '42', 'Color': 'Rojo' }, price: 85.00 },
      { sku: 'RUN-01-38-AZ', barcode: ['RUN0138AZ'], attributeValues: { 'Talla': '38', 'Color': 'Azul' }, price: 85.00 },
      { sku: 'RUN-01-39-AZ', barcode: ['RUN0139AZ'], attributeValues: { 'Talla': '39', 'Color': 'Azul' }, price: 85.00 },
      { sku: 'RUN-01-40-AZ', barcode: ['RUN0140AZ'], attributeValues: { 'Talla': '40', 'Color': 'Azul' }, price: 85.00 },
      { sku: 'RUN-01-41-AZ', barcode: ['RUN0141AZ'], attributeValues: { 'Talla': '41', 'Color': 'Azul' }, price: 85.00 },
      { sku: 'RUN-01-42-AZ', barcode: ['RUN0142AZ'], attributeValues: { 'Talla': '42', 'Color': 'Azul' }, price: 85.00 },
      { sku: 'RUN-01-38-NG', barcode: ['RUN0138NG'], attributeValues: { 'Talla': '38', 'Color': 'Negro' }, price: 85.00 },
      { sku: 'RUN-01-39-NG', barcode: ['RUN0139NG'], attributeValues: { 'Talla': '39', 'Color': 'Negro' }, price: 85.00 },
      { sku: 'RUN-01-40-NG', barcode: ['RUN0140NG'], attributeValues: { 'Talla': '40', 'Color': 'Negro' }, price: 85.00 },
      { sku: 'RUN-01-41-NG', barcode: ['RUN0141NG'], attributeValues: { 'Talla': '41', 'Color': 'Negro' }, price: 85.00 },
      { sku: 'RUN-01-42-NG', barcode: ['RUN0142NG'], attributeValues: { 'Talla': '42', 'Color': 'Negro' }, price: 85.00 }
    ],
    tariffs: [{ tariffId: "trf-gen", price: 85.00 }],
    image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?q=80&w=200&auto=format&fit=crop"
  }
];

const USERS = [
  { id: "u1", name: "Admin Master", pin: "1234", role: "ADMIN" },
  { id: "u2", name: "Cajero Centro", pin: "0000", role: "CASHIER" },
  { id: "u3", name: "Gerente Norte", pin: "9999", role: "MANAGER" }
];

const TARIFFS = [
  {
    id: 'trf-gen',
    name: 'General (PVP)',
    active: true,
    currency: 'DOP',
    taxIncluded: true,
    strategy: { type: 'MANUAL', rounding: 'NONE' },
    scope: { storeIds: ['ALL'], priority: 0 },
    schedule: { daysOfWeek: [0, 1, 2, 3, 4, 5, 6], timeStart: '00:00', timeEnd: '23:59' },
    items: {}
  }
];

// --- GENERACIÓN DEL ARCHIVO DB.JSON ---

const db = {
  config: {
    vertical: "RETAIL",
    subVertical: "Supermercado",
    currencySymbol: "RD$",
    taxRate: 0.18,
    companyInfo: COMPANIES[0],
    terminals: TERMINALS,
    tariffs: TARIFFS,
    taxes: [
      { id: 'tax-18', name: 'ITBIS 18%', rate: 0.18, type: 'VAT' },
      { id: 'tax-exempt', name: 'Exento 0%', rate: 0, type: 'EXEMPT' }
    ],
    currencies: [
      { code: 'DOP', name: 'Peso Dominicano', symbol: 'RD$', rate: 1, isEnabled: true, isBase: true }
    ],
    paymentMethods: [
      { id: 'cash', name: 'Efectivo', type: 'CASH', isEnabled: true, icon: 'Banknote', color: 'bg-green-500', opensDrawer: true, requiresSignature: false, integration: 'NONE' },
      { id: 'card', name: 'Tarjeta', type: 'CARD', isEnabled: true, icon: 'CreditCard', color: 'bg-blue-500', opensDrawer: false, requiresSignature: false, integration: 'NONE' }
    ]
  },
  products: PRODUCTS,
  warehouses: WAREHOUSES,
  users: USERS,
  customers: [],
  transactions: [],
  transfers: [],
  parkedTickets: [],
  receptions: [],
  productStocks: [],
  cashMovements: [],
  purchaseOrders: [],
  suppliers: [],
  internalSequences: [],
  inventoryLedger: []
};

const outputPath = path.join(__dirname, 'db.json');

try {
  fs.writeFileSync(outputPath, JSON.stringify(db, null, 2));
  console.log('✅ Base de datos sembrada correctamente en server/db.json');
  console.log('📦 Escenario de prueba: Multi-Almacén con Integridad Referencial listo.');
  console.log('👉 Ejecuta "npm run start:dev" para iniciar.');
} catch (err) {
  console.error('❌ Error escribiendo db.json:', err);
}
