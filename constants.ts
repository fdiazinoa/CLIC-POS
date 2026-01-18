
import { RoleDefinition, User, Customer, Product, BusinessConfig, SubVertical, DocumentSeries, Tariff, TaxDefinition } from './types';

export const DEFAULT_DOCUMENT_SERIES: DocumentSeries[] = [
  { id: 'TICKET', name: 'Ticket de Venta', description: 'Comprobante estándar para todas las ventas.', prefix: 'TCK', nextNumber: 1, padding: 6, icon: 'Receipt', color: 'blue' },
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
  deviceBindingToken: 'dev_token_init',
  fiscal: {
    batchSize: 100,
    lowBatchThreshold: 20,
    typeConfigs: {
      'B01': { batchSize: 50, lowBatchThreshold: 10 },
      'B02': { batchSize: 200, lowBatchThreshold: 20 }
    }
  },
  security: {
    deviceBindingToken: 'dev_token_init',
    requirePinForVoid: true,
    requirePinForDiscount: true,
    requireManagerForRefunds: true,
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
      autoPrintZReport: true,
      zReportEmails: ''
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
    cashDrawerTrigger: 'PRINTER' as const,
    printerAssignments: {},
    scales: []
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

const generateProducts = () => {
  const categories = [
    { name: 'Verduras', type: 'SERVICE', unit: '/kg' },
    { name: 'Frutas', type: 'SERVICE', unit: '/kg' },
    { name: 'Carnicería', type: 'SERVICE', unit: '/lb' },
    { name: 'Lácteos', type: 'PRODUCT', unit: '' },
    { name: 'Bebidas', type: 'PRODUCT', unit: '' },
    { name: 'Alacena', type: 'PRODUCT', unit: '' },
    { name: 'Snacks', type: 'PRODUCT', unit: '' },
    { name: 'Panadería', type: 'PRODUCT', unit: '' },
    { name: 'Limpieza', type: 'PRODUCT', unit: '' },
    { name: 'Cuidado Personal', type: 'PRODUCT', unit: '' },
  ];

  const items = [
    { n: 'Zanahoria Fresca', c: 'Verduras', p: 25.00 }, { n: 'Cebolla Roja', c: 'Verduras', p: 45.00 },
    { n: 'Papa Granola', c: 'Verduras', p: 30.00 }, { n: 'Tomate Barceló', c: 'Verduras', p: 35.00 },
    { n: 'Pimiento Morrón', c: 'Verduras', p: 60.00 }, { n: 'Ajo Importado', c: 'Verduras', p: 120.00 },
    { n: 'Brócoli', c: 'Verduras', p: 55.00 }, { n: 'Lechuga Repollada', c: 'Verduras', p: 40.00 },
    { n: 'Pepino', c: 'Verduras', p: 20.00 }, { n: 'Cilantro Ancho', c: 'Verduras', p: 10.00 },
    { n: 'Manzana Roja', c: 'Frutas', p: 40.00 }, { n: 'Guineo Maduro', c: 'Frutas', p: 15.00 },
    { n: 'Uva Globo', c: 'Frutas', p: 180.00 }, { n: 'Fresa Paquete', c: 'Frutas', p: 150.00 },
    { n: 'Melón Cantaloupe', c: 'Frutas', p: 85.00 }, { n: 'Sandía', c: 'Frutas', p: 25.00 },
    { n: 'Piña Dulce', c: 'Frutas', p: 70.00 }, { n: 'Mango Mingolo', c: 'Frutas', p: 20.00 },
    { n: 'Limón Persa', c: 'Frutas', p: 12.00 }, { n: 'Chinola', c: 'Frutas', p: 15.00 },
    { n: 'Pollo Entero', c: 'Carnicería', p: 75.00 }, { n: 'Carne Molida Res', c: 'Carnicería', p: 145.00 },
    { n: 'Chuleta Ahumada', c: 'Carnicería', p: 160.00 }, { n: 'Bistec de Res', c: 'Carnicería', p: 220.00 },
    { n: 'Pechuga Pollo', c: 'Carnicería', p: 135.00 }, { n: 'Costilla Cerdo', c: 'Carnicería', p: 180.00 },
    { n: 'Salchicha Italiana', c: 'Carnicería', p: 210.00 }, { n: 'Filete Pescado', c: 'Carnicería', p: 195.00 },
    { n: 'Camarones', c: 'Carnicería', p: 450.00 }, { n: 'Longaniza', c: 'Carnicería', p: 110.00 },
    { n: 'Leche Entera 1L', c: 'Lácteos', p: 75.00 }, { n: 'Queso Gouda', c: 'Lácteos', p: 350.00 },
    { n: 'Yogurt Fresa', c: 'Lácteos', p: 45.00 }, { n: 'Mantequilla Barra', c: 'Lácteos', p: 95.00 },
    { n: 'Crema de Leche', c: 'Lácteos', p: 120.00 }, { n: 'Queso Mozzarella', c: 'Lácteos', p: 280.00 },
    { n: 'Leche Evaporada', c: 'Lácteos', p: 55.00 }, { n: 'Queso Cheddar', c: 'Lácteos', p: 220.00 },
    { n: 'Helado Vainilla', c: 'Lácteos', p: 350.00 }, { n: 'Leche Condensada', c: 'Lácteos', p: 85.00 },
    { n: 'Coca Cola 2L', c: 'Bebidas', p: 80.00 }, { n: 'Agua 500ml', c: 'Bebidas', p: 15.00 },
    { n: 'Jugo Naranja 1L', c: 'Bebidas', p: 110.00 }, { n: 'Cerveza Presidente', c: 'Bebidas', p: 150.00 },
    { n: 'Sprite 2L', c: 'Bebidas', p: 80.00 }, { n: 'Malta Morena', c: 'Bebidas', p: 45.00 },
    { n: 'Gatorade Azul', c: 'Bebidas', p: 65.00 }, { n: 'Vino Tinto Mesa', c: 'Bebidas', p: 450.00 },
    { n: 'Ron Dorado', c: 'Bebidas', p: 600.00 }, { n: 'Agua con Gas', c: 'Bebidas', p: 35.00 },
    { n: 'Arroz Premium 5lb', c: 'Alacena', p: 220.00 }, { n: 'Aceite Soja 1L', c: 'Alacena', p: 180.00 },
    { n: 'Pasta Espagueti', c: 'Alacena', p: 45.00 }, { n: 'Salsa Tomate', c: 'Alacena', p: 30.00 },
    { n: 'Habichuelas Lata', c: 'Alacena', p: 55.00 }, { n: 'Azúcar Crema 2lb', c: 'Alacena', p: 60.00 },
    { n: 'Sal Molida', c: 'Alacena', p: 15.00 }, { n: 'Harina Trigo', c: 'Alacena', p: 40.00 },
    { n: 'Atún en Agua', c: 'Alacena', p: 75.00 }, { n: 'Café Molido 1lb', c: 'Alacena', p: 280.00 },
    { n: 'Papas Lay\'s', c: 'Snacks', p: 60.00 }, { n: 'Galletas Chocolate', c: 'Snacks', p: 45.00 },
    { n: 'Chocolate Barra', c: 'Snacks', p: 35.00 }, { n: 'Maní Salado', c: 'Snacks', p: 25.00 },
    { n: 'Doritos Queso', c: 'Snacks', p: 65.00 }, { n: 'Gomitas Osito', c: 'Snacks', p: 30.00 },
    { n: 'Galletas Soda', c: 'Snacks', p: 20.00 }, { n: 'Barra Cereal', c: 'Snacks', p: 40.00 },
    { n: 'Palomitas Micro', c: 'Snacks', p: 50.00 }, { n: 'Chicle Menta', c: 'Snacks', p: 10.00 },
    { n: 'Pan Sobao', c: 'Panadería', p: 10.00 }, { n: 'Baguette', c: 'Panadería', p: 45.00 },
    { n: 'Pan Viga Blanco', c: 'Panadería', p: 110.00 }, { n: 'Donas Glaseadas', c: 'Panadería', p: 60.00 },
    { n: 'Croissant', c: 'Panadería', p: 75.00 }, { n: 'Pastelito Pollo', c: 'Panadería', p: 35.00 },
    { n: 'Bizcocho Libra', c: 'Panadería', p: 450.00 }, { n: 'Pan de Maíz', c: 'Panadería', p: 50.00 },
    { n: 'Galletas Avena', c: 'Panadería', p: 15.00 }, { n: 'Tostadas', c: 'Panadería', p: 85.00 },
    { n: 'Detergente Polvo', c: 'Limpieza', p: 120.00 }, { n: 'Cloro 1L', c: 'Limpieza', p: 45.00 },
    { n: 'Jabón Lavaplatos', c: 'Limpieza', p: 85.00 }, { n: 'Suavizante Ropa', c: 'Limpieza', p: 110.00 },
    { n: 'Desinfectante', c: 'Limpieza', p: 95.00 }, { n: 'Escoba Plástica', c: 'Limpieza', p: 150.00 },
    { n: 'Bolsas Basura', c: 'Limpieza', p: 70.00 }, { n: 'Esponja Fregar', c: 'Limpieza', p: 25.00 },
    { n: 'Limpiavidrios', c: 'Limpieza', p: 130.00 }, { n: 'Papel Toalla', c: 'Limpieza', p: 90.00 },
    { n: 'Shampoo 400ml', c: 'Cuidado Personal', p: 220.00 }, { n: 'Jabón Baño', c: 'Cuidado Personal', p: 45.00 },
    { n: 'Pasta Dental', c: 'Cuidado Personal', p: 115.00 }, { n: 'Desodorante', c: 'Cuidado Personal', p: 140.00 },
    { n: 'Papel Higiénico 4u', c: 'Cuidado Personal', p: 85.00 }, { n: 'Cepillo Dental', c: 'Cuidado Personal', p: 75.00 },
    { n: 'Acondicionador', c: 'Cuidado Personal', p: 220.00 }, { n: 'Crema Cuerpo', c: 'Cuidado Personal', p: 190.00 },
    { n: 'Alcohol Gel', c: 'Cuidado Personal', p: 60.00 }, { n: 'Toallas Húmedas', c: 'Cuidado Personal', p: 110.00 },
  ];

  return items.map((item, idx) => {
    const cat = categories.find(c => c.name === item.c);
    const type = (cat?.type as any) || 'PRODUCT';
    const isWeighable = type === 'SERVICE';
    
    return {
      id: `prod-${idx + 100}`,
      name: item.n,
      price: item.p,
      category: item.c,
      stock: Math.floor(Math.random() * 150),
      cost: item.p * 0.6,
      barcode: `74000${idx + 100}`,
      type: type,
      images: [],
      attributes: [],
      variants: [],
      tariffs: [{ tariffId: 'trf-gen', price: item.p }],
      appliedTaxIds: isWeighable ? ['tax-exempt'] : ['tax-18'],
      image: `https://source.unsplash.com/200x200/?${encodeURIComponent(item.c === 'Cuidado Personal' ? 'soap' : item.c === 'Alacena' ? 'pantry' : item.n)}`
    } as Product;
  });
};

export const RETAIL_PRODUCTS: Product[] = [
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
  ...generateProducts()
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
    terminals: [{ id: 't1', config: DEFAULT_TERMINAL_CONFIG }],
    availablePrinters: [],
    scales: [] 
  };
};
