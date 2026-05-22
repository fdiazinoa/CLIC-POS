import { Product } from '../types';

export type ProductSeedPackId =
  | 'NONE'
  | 'FAST_FOOD'
  | 'RESTAURANT_CASUAL'
  | 'RESTAURANT_PIZZA'
  | 'SUPERMARKET'
  | 'HARDWARE'
  | 'CAFETERIA';

type ProductSeedItem = {
  sku: string;
  name: string;
  category: string;
  price: number;
  cost?: number;
  stock?: number;
  minStock?: number;
  trackInventory?: boolean;
};

export type ProductSeedPack = {
  id: ProductSeedPackId;
  label: string;
  description: string;
  vertical: 'FOOD' | 'RETAIL';
  items: ProductSeedItem[];
};

export const PRODUCT_SEED_PACKS: ProductSeedPack[] = [
  {
    id: 'FAST_FOOD',
    label: 'FastFood',
    description: 'Combos, bebidas y platos rápidos para operación de mostrador.',
    vertical: 'FOOD',
    items: [
      { sku: 'FF-001', name: 'Hamburguesa Clasica', category: 'Combos', price: 225, cost: 95, trackInventory: false },
      { sku: 'FF-002', name: 'Cheeseburger', category: 'Combos', price: 275, cost: 120, trackInventory: false },
      { sku: 'FF-003', name: 'Combo Hamburguesa', category: 'Combos', price: 425, cost: 190, trackInventory: false },
      { sku: 'FF-004', name: 'Papas Fritas', category: 'Acompanantes', price: 125, cost: 45, trackInventory: false },
      { sku: 'FF-005', name: 'Hot Dog', category: 'Combos', price: 180, cost: 75, trackInventory: false },
      { sku: 'FF-006', name: 'Nuggets 6 Piezas', category: 'Acompanantes', price: 195, cost: 85, trackInventory: false },
      { sku: 'FF-007', name: 'Refresco Vaso', category: 'Bebidas', price: 85, cost: 28, stock: 60 },
      { sku: 'FF-008', name: 'Agua Botella', category: 'Bebidas', price: 60, cost: 25, stock: 48 },
    ],
  },
  {
    id: 'RESTAURANT_CASUAL',
    label: 'Restaurante casual',
    description: 'Entradas, fuertes, bebidas y postres para servicio a mesa.',
    vertical: 'FOOD',
    items: [
      { sku: 'RC-001', name: 'Churrasco', category: 'Platos fuertes', price: 895, cost: 420, trackInventory: false },
      { sku: 'RC-002', name: 'Pechuga a la Parrilla', category: 'Platos fuertes', price: 595, cost: 245, trackInventory: false },
      { sku: 'RC-003', name: 'Pasta Alfredo', category: 'Pastas', price: 495, cost: 190, trackInventory: false },
      { sku: 'RC-004', name: 'Ensalada Cesar', category: 'Entradas', price: 350, cost: 135, trackInventory: false },
      { sku: 'RC-005', name: 'Sopa del Dia', category: 'Entradas', price: 225, cost: 75, trackInventory: false },
      { sku: 'RC-006', name: 'Flan de la Casa', category: 'Postres', price: 195, cost: 70, trackInventory: false },
      { sku: 'RC-007', name: 'Jugo Natural', category: 'Bebidas', price: 160, cost: 55, stock: 30 },
      { sku: 'RC-008', name: 'Agua Mineral', category: 'Bebidas', price: 90, cost: 35, stock: 36 },
    ],
  },
  {
    id: 'RESTAURANT_PIZZA',
    label: 'Pizzeria',
    description: 'Pizzas, pastas y bebidas para restaurantes por porcion o familiar.',
    vertical: 'FOOD',
    items: [
      { sku: 'PZ-001', name: 'Pizza Margarita', category: 'Pizzas', price: 550, cost: 210, trackInventory: false },
      { sku: 'PZ-002', name: 'Pizza Pepperoni', category: 'Pizzas', price: 650, cost: 260, trackInventory: false },
      { sku: 'PZ-003', name: 'Pizza Hawaiana', category: 'Pizzas', price: 675, cost: 280, trackInventory: false },
      { sku: 'PZ-004', name: 'Calzone', category: 'Pizzas', price: 425, cost: 175, trackInventory: false },
      { sku: 'PZ-005', name: 'Pasta Bolognesa', category: 'Pastas', price: 475, cost: 190, trackInventory: false },
      { sku: 'PZ-006', name: 'Pan de Ajo', category: 'Acompanantes', price: 150, cost: 55, trackInventory: false },
      { sku: 'PZ-007', name: 'Refresco 2L', category: 'Bebidas', price: 180, cost: 95, stock: 24 },
      { sku: 'PZ-008', name: 'Extra Queso', category: 'Extras', price: 95, cost: 35, trackInventory: false },
    ],
  },
  {
    id: 'SUPERMARKET',
    label: 'Supermercado',
    description: 'Productos basicos de abarrotes, higiene y bebidas.',
    vertical: 'RETAIL',
    items: [
      { sku: 'SM-001', name: 'Arroz Selecto 5 lb', category: 'Abarrotes', price: 275, cost: 205, stock: 36, minStock: 6 },
      { sku: 'SM-002', name: 'Aceite Vegetal 16 oz', category: 'Abarrotes', price: 165, cost: 118, stock: 42, minStock: 8 },
      { sku: 'SM-003', name: 'Leche Entera 1 L', category: 'Lacteos', price: 95, cost: 68, stock: 48, minStock: 10 },
      { sku: 'SM-004', name: 'Azucar Crema 2 lb', category: 'Abarrotes', price: 110, cost: 76, stock: 40, minStock: 8 },
      { sku: 'SM-005', name: 'Huevos 30 unidades', category: 'Lacteos', price: 295, cost: 230, stock: 18, minStock: 4 },
      { sku: 'SM-006', name: 'Pan de Molde', category: 'Panaderia', price: 145, cost: 95, stock: 24, minStock: 5 },
      { sku: 'SM-007', name: 'Detergente 1 kg', category: 'Limpieza', price: 240, cost: 165, stock: 22, minStock: 5 },
      { sku: 'SM-008', name: 'Pasta Dental', category: 'Cuidado personal', price: 130, cost: 82, stock: 30, minStock: 6 },
    ],
  },
  {
    id: 'HARDWARE',
    label: 'Ferreteria',
    description: 'Materiales, herramientas y consumibles de alta rotacion.',
    vertical: 'RETAIL',
    items: [
      { sku: 'FH-001', name: 'Cemento Gris 42.5 kg', category: 'Construccion', price: 495, cost: 390, stock: 40, minStock: 8 },
      { sku: 'FH-002', name: 'Varilla 3/8', category: 'Construccion', price: 285, cost: 220, stock: 60, minStock: 12 },
      { sku: 'FH-003', name: 'Pintura Blanca Galon', category: 'Pintura', price: 895, cost: 650, stock: 18, minStock: 4 },
      { sku: 'FH-004', name: 'Brocha 3 pulgadas', category: 'Pintura', price: 165, cost: 95, stock: 30, minStock: 6 },
      { sku: 'FH-005', name: 'Tornillos 1 pulg Caja', category: 'Tornilleria', price: 220, cost: 130, stock: 25, minStock: 5 },
      { sku: 'FH-006', name: 'Martillo Mango Fibra', category: 'Herramientas', price: 520, cost: 330, stock: 12, minStock: 3 },
      { sku: 'FH-007', name: 'Cinta Teflon', category: 'Plomeria', price: 45, cost: 18, stock: 80, minStock: 15 },
      { sku: 'FH-008', name: 'Cinta Metrica 5 m', category: 'Herramientas', price: 240, cost: 145, stock: 16, minStock: 4 },
    ],
  },
  {
    id: 'CAFETERIA',
    label: 'Cafeteria',
    description: 'Cafe, bebidas frias, panaderia y snacks para venta rapida.',
    vertical: 'FOOD',
    items: [
      { sku: 'CF-001', name: 'Cafe Americano', category: 'Cafe', price: 95, cost: 28, trackInventory: false },
      { sku: 'CF-002', name: 'Cappuccino', category: 'Cafe', price: 145, cost: 48, trackInventory: false },
      { sku: 'CF-003', name: 'Latte', category: 'Cafe', price: 155, cost: 52, trackInventory: false },
      { sku: 'CF-004', name: 'Croissant', category: 'Panaderia', price: 135, cost: 62, stock: 18, minStock: 4 },
      { sku: 'CF-005', name: 'Muffin Chocolate', category: 'Panaderia', price: 120, cost: 55, stock: 20, minStock: 4 },
      { sku: 'CF-006', name: 'Sandwich Jamon y Queso', category: 'Sandwiches', price: 250, cost: 115, trackInventory: false },
      { sku: 'CF-007', name: 'Jugo de Naranja', category: 'Bebidas', price: 140, cost: 58, stock: 24 },
      { sku: 'CF-008', name: 'Agua Botella', category: 'Bebidas', price: 60, cost: 25, stock: 48 },
    ],
  },
];

export const getProductSeedPack = (id: ProductSeedPackId): ProductSeedPack | null => (
  id === 'NONE' ? null : PRODUCT_SEED_PACKS.find(pack => pack.id === id) || null
);

export const buildSeedProducts = (
  packId: ProductSeedPackId,
  options: {
    defaultTaxIds?: string[];
    defaultTariffId?: string;
    defaultWarehouseId?: string;
  } = {}
): Product[] => {
  const pack = getProductSeedPack(packId);
  if (!pack) return [];

  const now = new Date().toISOString();
  const defaultTaxIds = options.defaultTaxIds || [];
  const defaultWarehouseId = options.defaultWarehouseId || '';
  const defaultTariffId = options.defaultTariffId || '';

  return pack.items.map((item) => {
    const trackInventory = item.trackInventory !== false;
    const stock = trackInventory ? Number(item.stock || 0) : 0;
    const id = `starter-${pack.id.toLowerCase()}-${item.sku.toLowerCase()}`;
    const product: Product & Record<string, unknown> = {
      id,
      name: item.name,
      price: item.price,
      category: item.category,
      stock,
      barcode: item.sku,
      cost: item.cost ?? Math.round(item.price * 0.6 * 100) / 100,
      is_sellable: true,
      type: 'PRODUCT',
      isInventoriable: trackInventory,
      images: [],
      attributes: [],
      variants: [],
      tariffs: defaultTariffId ? [{ tariffId: defaultTariffId, price: item.price }] : [],
      stockBalances: trackInventory && defaultWarehouseId ? { [defaultWarehouseId]: stock } : {},
      activeInWarehouses: defaultWarehouseId ? [defaultWarehouseId] : [],
      appliedTaxIds: defaultTaxIds,
      minStock: item.minStock,
      operationalFlags: {
        isWeighted: false,
        trackInventory,
        autoPrintLabel: false,
        promptPrice: false,
        integersOnly: true,
        ageRestricted: false,
        allowNegativeStock: false,
        excludeFromPromotions: false,
        excludeFromLoyalty: false,
        usesLots: false,
        usesSerial: false,
      },
      createdAt: now,
      updatedAt: now,
      seedPackId: pack.id,
      seedPackName: pack.label,
      isStarterData: true,
    };

    return product;
  });
};
