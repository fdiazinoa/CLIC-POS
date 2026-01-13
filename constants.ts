
import { RoleDefinition, User, Customer, Product, BusinessConfig, SubVertical } from './types';

export const DEFAULT_TERMINAL_CONFIG = {
  security: {
    deviceBindingToken: 'dev_token_init',
    requirePinForVoid: true,
    requirePinForDiscount: true,
    autoLogoutMinutes: 15
  },
  workflow: {
    inventory: {
      realTimeValidation: true,
      allowNegativeStock: false,
      reserveStockOnCart: true,
      showStockOnTiles: true,
      showProductImagesInReceipt: false
    },
    session: {
      blindClose: true,
      allowSalesWithOpenZ: false,
      maxCashInDrawer: 20000
    },
    offline: {
      mode: 'OPTIMISTIC' as const,
      maxOfflineTransactionLimit: 500
    }
  },
  financial: {
    roundingMethod: 'ROUND_HALF_UP' as const,
    taxInclusivePrices: true,
    printTaxBreakdown: true,
    returnChangeInBaseCurrency: true,
    acceptedCurrencies: ['USD', 'EUR']
  },
  hardware: {
    cashDrawerTrigger: 'PRINTER' as const
  },
  ux: {
    theme: 'LIGHT' as const,
    gridDensity: 'COMFORTABLE' as const,
    showProductImages: true,
    quickKeysLayout: 'A' as const
  }
};

export const MOCK_USERS: User[] = [
  { id: 'u1', name: 'Admin Master', pin: '1234', role: 'ADMIN', photo: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Admin' },
  { id: 'u2', name: 'Cajero Principal', pin: '0000', role: 'CASHIER', photo: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Cashier' }
];

export const DEFAULT_ROLES: RoleDefinition[] = [
  { id: 'ADMIN', name: 'Administrador', permissions: ['ALL'], isSystem: true },
  { id: 'CASHIER', name: 'Cajero', permissions: ['SALE', 'OPEN_DRAWER'], isSystem: false }
];

export const MOCK_CUSTOMERS: Customer[] = [
  { id: 'c1', name: 'Juan Pérez', phone: '809-555-0123', email: 'juan.perez@email.com', tier: 'GOLD', loyaltyPoints: 1250, currentDebt: 0 },
  { id: 'c2', name: 'María García', phone: '829-555-0456', email: 'm.garcia@email.com', tier: 'SILVER', loyaltyPoints: 450, currentDebt: 150.00 },
  { id: 'c3', name: 'Cliente de Contado', phone: '', email: '', tier: 'BRONZE', loyaltyPoints: 0, currentDebt: 0 }
];

export const RETAIL_PRODUCTS: Product[] = [
  { id: 'p1', name: 'Camiseta Algodón Premium', price: 25.00, category: 'Ropa', stock: 45, minStock: 10, cost: 12.00, barcode: '74210001', images: [], attributes: [], variants: [], tariffs: [] },
  { id: 'p2', name: 'Jeans Slim Fit Blue', price: 45.00, category: 'Ropa', stock: 12, minStock: 5, cost: 20.00, barcode: '74210002', images: [], attributes: [], variants: [], tariffs: [] },
  { id: 'p3', name: 'Tenis Deportivos Runner', price: 85.00, category: 'Calzado', stock: 8, minStock: 10, cost: 40.00, barcode: '74210003', images: [], attributes: [], variants: [], tariffs: [] },
  { id: 'p4', name: 'Gorra Urban Style', price: 15.00, category: 'Accesorios', stock: 60, minStock: 15, cost: 5.00, barcode: '74210004', images: [], attributes: [], variants: [], tariffs: [] },
  { id: 'p5', name: 'Reloj Digital Sport', price: 30.00, category: 'Accesorios', stock: 4, minStock: 5, cost: 12.00, barcode: '74210005', images: [], attributes: [], variants: [], tariffs: [] },
  { id: 'p6', name: 'Sudadera con Capucha', price: 35.00, category: 'Ropa', stock: 20, minStock: 8, cost: 15.00, barcode: '74210006', images: [], attributes: [], variants: [], tariffs: [] },
  // NUEVO: Artículo con Balanza
  { 
    id: 'p7', 
    name: 'Pollo Fresco (Peso)', 
    price: 3.50, 
    category: 'Carnicería', 
    stock: 200, 
    minStock: 20, 
    cost: 1.80, 
    barcode: 'SC001', 
    type: 'SERVICE', // Activa balanza por tipo servicio + nombre 'peso'
    images: ['https://images.unsplash.com/photo-1587593810167-a84920ea0781?q=80&w=200&auto=format&fit=crop'], 
    attributes: [], 
    variants: [], 
    tariffs: [] 
  },
  // NUEVO: Artículo con Talla y Color
  { 
    id: 'p8', 
    name: 'Camisa Oxford Premium', 
    price: 35.00, 
    category: 'Ropa', 
    stock: 100, 
    minStock: 10, 
    cost: 15.00, 
    barcode: 'VAR001', 
    type: 'PRODUCT', 
    images: ['https://images.unsplash.com/photo-1596755094514-f87e34085b2c?q=80&w=200&auto=format&fit=crop'], 
    attributes: [
      { id: 'attr_size', name: 'Talla', options: ['S', 'M', 'L', 'XL'], optionCodes: ['S', 'M', 'L', 'XL'] },
      { id: 'attr_color', name: 'Color', options: ['Blanco', 'Azul', 'Gris'], optionCodes: ['BL', 'AZ', 'GR'] }
    ], 
    variants: [], 
    tariffs: [] 
  }
];

export const FOOD_PRODUCTS: Product[] = [
  { id: 'f1', name: 'Hamburguesa Especial', price: 12.50, category: 'Comida', stock: 99, cost: 4.50, images: [], attributes: [], variants: [], tariffs: [] },
  { id: 'f2', name: 'Pizza Pepperoni Mediana', price: 15.00, category: 'Comida', stock: 99, cost: 6.00, images: [], attributes: [], variants: [], tariffs: [] },
  { id: 'f3', name: 'Refresco 500ml', price: 2.50, category: 'Bebidas', stock: 150, cost: 0.80, images: [], attributes: [], variants: [], tariffs: [] },
  { id: 'f4', name: 'Cerveza Nacional 12oz', price: 4.00, category: 'Bebidas', stock: 80, cost: 1.50, images: [], attributes: [], variants: [], tariffs: [] },
  { id: 'f5', name: 'Ensalada Caesar', price: 9.00, category: 'Comida', stock: 30, cost: 3.00, images: [], attributes: [], variants: [], tariffs: [] },
  { id: 'f6', name: 'Papas Fritas XL', price: 4.50, category: 'Comida', stock: 100, cost: 1.00, images: [], attributes: [], variants: [], tariffs: [] }
];

export const AVAILABLE_PERMISSIONS = [
  { key: 'SALE', label: 'Realizar Ventas', description: 'Acceso a pantalla de cobro', category: 'SALES' },
  { key: 'OPEN_DRAWER', label: 'Abrir Cajón', description: 'Sin venta', category: 'CASH' },
  { key: 'VOID_TICKET', label: 'Anular Ticket', description: 'Cancelar venta completa', category: 'SALES' },
  { key: 'ALL', label: 'Acceso Total', description: 'Admin', category: 'SYSTEM' }
];

export const getInitialConfig = (subVertical: SubVertical): BusinessConfig => {
  const isFood = [SubVertical.RESTAURANT, SubVertical.FAST_FOOD, SubVertical.BAR].includes(subVertical);
  return {
    vertical: isFood ? 'RESTAURANT' : 'RETAIL',
    subVertical,
    currencySymbol: '$',
    taxRate: 0.18,
    themeColor: 'blue',
    features: { stockTracking: true },
    companyInfo: { name: 'CLIC POS DEMO', rnc: '131-12345-1', phone: '809-555-POS1', address: 'Av. Principal #1, Santo Domingo' },
    currencies: [{ code: 'DOP', name: 'Peso Dominicano', symbol: 'RD$', rate: 1, isEnabled: true, isBase: true }],
    paymentMethods: [
      { id: 'cash', name: 'Efectivo', type: 'CASH', isEnabled: true, icon: 'Banknote', color: 'bg-green-500', opensDrawer: true, requiresSignature: false, integration: 'NONE' },
      { id: 'card', name: 'Tarjeta', type: 'CARD', isEnabled: true, icon: 'CreditCard', color: 'bg-blue-500', opensDrawer: false, requiresSignature: false, integration: 'NONE' }
    ],
    terminals: [{ id: 't1', config: DEFAULT_TERMINAL_CONFIG }]
  };
};
