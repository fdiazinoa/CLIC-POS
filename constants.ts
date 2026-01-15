
import { RoleDefinition, User, Customer, Product, BusinessConfig, SubVertical, DocumentSeries, Tariff, TaxDefinition } from './types';

export const DEFAULT_DOCUMENT_SERIES: DocumentSeries[] = [
  { id: 'TICKET', name: 'Ticket de Venta', description: 'Comprobante estándar para clientes finales.', prefix: 'TCK', nextNumber: 1, padding: 6, icon: 'Receipt', color: 'blue' },
  { id: 'INVOICE', name: 'Factura Fiscal', description: 'Documento con valor fiscal (B01).', prefix: 'B01', nextNumber: 1, padding: 8, icon: 'FileText', color: 'indigo' },
  { id: 'REFUND', name: 'Devolución / Abono', description: 'Notas de crédito por devoluciones.', prefix: 'NC', nextNumber: 1, padding: 6, icon: 'RotateCcw', color: 'orange' },
  { id: 'TRANSFER', name: 'Nota de Traspaso', description: 'Movimiento de inventario entre almacenes.', prefix: 'TR', nextNumber: 1, padding: 6, icon: 'ArrowRightLeft', color: 'purple' },
];

export const INITIAL_TAXES: TaxDefinition[] = [
  { id: 'tax-18', name: 'ITBIS 18%', rate: 0.18, type: 'VAT' },
  { id: 'tax-16', name: 'ITBIS 16%', rate: 0.16, type: 'VAT' },
  { id: 'tax-propina', name: 'Propina Legal 10%', rate: 0.10, type: 'SERVICE_CHARGE' },
  { id: 'tax-exempt', name: 'Exento 0%', rate: 0, type: 'EXEMPT' },
];

export const INITIAL_TARIFFS: Tariff[] = [
  { 
    id: 'trf-gen', 
    name: 'General (PVP)', 
    active: true, 
    currency: 'DOP', 
    taxIncluded: true, 
    strategy: { type: 'MANUAL', rounding: 'NONE' }, 
    scope: { storeIds: ['ALL'], priority: 0 }, 
    schedule: { daysOfWeek: [0,1,2,3,4,5,6], timeStart: '00:00', timeEnd: '23:59' }, 
    items: {} 
  },
  { 
    id: 'trf-vip', 
    name: 'VIP / Cliente Oro', 
    active: true, 
    currency: 'DOP', 
    taxIncluded: true, 
    strategy: { type: 'MANUAL', rounding: 'NONE' }, 
    scope: { storeIds: ['ALL'], priority: 5 }, 
    schedule: { daysOfWeek: [0,1,2,3,4,5,6], timeStart: '00:00', timeEnd: '23:59' }, 
    items: {} 
  }
];

export const DEFAULT_TERMINAL_CONFIG = {
  security: {
    deviceBindingToken: 'dev_token_init',
    requirePinForVoid: true,
    requirePinForDiscount: true,
    autoLogoutMinutes: 15
  },
  pricing: {
    allowedTariffIds: ['trf-gen', 'trf-vip'],
    defaultTariffId: 'trf-gen'
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
      maxCashInDrawer: 20000,
      askGuestsOnTicketOpen: false,
      autoPrintZReport: true
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
  documentSeries: DEFAULT_DOCUMENT_SERIES,
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
  // --- PRODUCTOS PESADOS ---
  { 
    id: 'p-pesado-1', 
    name: 'Tomates Orgánicos (Peso)', 
    price: 3.50, 
    category: 'Verduras', 
    stock: 150, 
    cost: 1.20, 
    barcode: 'SC001', 
    type: 'SERVICE', 
    images: ['https://images.unsplash.com/photo-1592924357228-91a4daadcfea?q=80&w=200&auto=format&fit=crop'], 
    image: 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?q=80&w=200&auto=format&fit=crop',
    attributes: [], 
    variants: [], 
    tariffs: [{ tariffId: 'trf-gen', price: 3.50 }],
    appliedTaxIds: ['tax-exempt']
  },
  { 
    id: 'p-pesado-2', 
    name: 'Pollo Entero (Peso)', 
    price: 5.99, 
    category: 'Carnicería', 
    stock: 80, 
    cost: 3.50, 
    barcode: 'SC002', 
    type: 'SERVICE', 
    images: ['https://images.unsplash.com/photo-1587593810167-a84920ea0781?q=80&w=200&auto=format&fit=crop'], 
    image: 'https://images.unsplash.com/photo-1587593810167-a84920ea0781?q=80&w=200&auto=format&fit=crop',
    attributes: [], 
    variants: [], 
    tariffs: [{ tariffId: 'trf-gen', price: 5.99 }],
    appliedTaxIds: ['tax-18']
  },
  // --- PRODUCTOS CON VARIANTE ---
  { 
    id: 'p-var-1', 
    name: 'Zapatillas Runner 5.0', 
    price: 85.00, 
    category: 'Calzado', 
    stock: 100, 
    cost: 40.00, 
    barcode: 'RUN-001', 
    type: 'PRODUCT', 
    images: ['https://images.unsplash.com/photo-1542291026-7eec264c27ff?q=80&w=200&auto=format&fit=crop'], 
    image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?q=80&w=200&auto=format&fit=crop',
    attributes: [
      { id: 'attr_size', name: 'Talla', options: ['38', '39', '40', '41', '42'], optionCodes: ['38', '39', '40', '41', '42'] },
      { id: 'attr_color', name: 'Color', options: ['Rojo', 'Azul', 'Negro'], optionCodes: ['RJ', 'AZ', 'NG'] }
    ], 
    variants: [], 
    tariffs: [{ tariffId: 'trf-gen', price: 85.00 }],
    appliedTaxIds: ['tax-18']
  },
  { id: 'p1', name: 'Camiseta Algodón Premium', price: 25.00, category: 'Ropa', stock: 45, minStock: 10, cost: 12.00, barcode: '74210001', images: [], attributes: [], variants: [], tariffs: [{ tariffId: 'trf-gen', price: 25.00 }, { tariffId: 'trf-vip', price: 20.00 }], appliedTaxIds: ['tax-18'] },
];

export const FOOD_PRODUCTS: Product[] = [
  { id: 'f1', name: 'Hamburguesa Especial', price: 12.50, category: 'Comida', stock: 99, cost: 4.50, images: [], attributes: [], variants: [], tariffs: [{ tariffId: 'trf-gen', price: 12.50 }, { tariffId: 'trf-vip', price: 10.00 }], appliedTaxIds: ['tax-18', 'tax-propina'] },
  { id: 'f2', name: 'Pizza Pepperoni Mediana', price: 15.00, category: 'Comida', stock: 99, cost: 6.00, images: [], attributes: [], variants: [], tariffs: [{ tariffId: 'trf-gen', price: 15.00 }], appliedTaxIds: ['tax-18', 'tax-propina'] },
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
    taxes: INITIAL_TAXES,
    themeColor: 'blue',
    features: { stockTracking: true },
    companyInfo: { name: 'CLIC POS DEMO', rnc: '131-12345-1', phone: '809-555-POS1', address: 'Av. Principal #1, Santo Domingo' },
    currencies: [{ code: 'DOP', name: 'Peso Dominicano', symbol: 'RD$', rate: 1, isEnabled: true, isBase: true }],
    paymentMethods: [
      { id: 'cash', name: 'Efectivo', type: 'CASH', isEnabled: true, icon: 'Banknote', color: 'bg-green-500', opensDrawer: true, requiresSignature: false, integration: 'NONE' },
      { id: 'card', name: 'Tarjeta', type: 'CARD', isEnabled: true, icon: 'CreditCard', color: 'bg-blue-500', opensDrawer: false, requiresSignature: false, integration: 'NONE' }
    ],
    tariffs: INITIAL_TARIFFS,
    terminals: [{ id: 't1', config: DEFAULT_TERMINAL_CONFIG }]
  };
};
