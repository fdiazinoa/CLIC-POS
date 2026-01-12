import { Product, SubVertical, VerticalType, BusinessConfig, User, RoleDefinition, PermissionDetail, Customer } from './types';

// Catalog of all available permissions in the system
export const AVAILABLE_PERMISSIONS: PermissionDetail[] = [
  { key: 'CAN_ACCESS_SETTINGS', label: 'Acceso a Configuración', description: 'Permite entrar al módulo de ajustes y usuarios.', category: 'ADMIN' },
  { key: 'CAN_APPLY_DISCOUNT', label: 'Aplicar Descuentos', description: 'Permite modificar precios o aplicar descuentos manuales.', category: 'SALES' },
  { key: 'CAN_VOID_ITEM', label: 'Anular/Eliminar Items', description: 'Permite borrar productos de una orden activa.', category: 'SALES' },
  { key: 'CAN_FINALIZE_PAYMENT', label: 'Cobrar/Facturar', description: 'Permite acceder a la pantalla de pagos y cerrar mesas.', category: 'CASH' },
  { key: 'CAN_MANAGE_TABLES', label: 'Gestionar Mesas', description: 'Permite asignar, mover o liberar mesas.', category: 'SALES' },
  { key: 'CAN_VIEW_REPORTS', label: 'Ver Reportes', description: 'Acceso a cierre de caja y reportes de venta.', category: 'ADMIN' },
  { key: 'CAN_CLOSE_REGISTER', label: 'Cierre de Caja', description: 'Permite realizar el corte Z.', category: 'CASH' },
  { key: 'CAN_MANAGE_CUSTOMERS', label: 'Gestionar Clientes', description: 'Crear, editar y ver base de datos de clientes.', category: 'ADMIN' }
];

// Default Roles Configuration
export const DEFAULT_ROLES: RoleDefinition[] = [
  { 
    id: 'ADMIN', 
    name: 'Administrador', 
    permissions: AVAILABLE_PERMISSIONS.map(p => p.key), // All permissions
    isSystem: true,
    icon: 'ShieldAlert'
  },
  { 
    id: 'SUPERVISOR', 
    name: 'Supervisor', 
    permissions: ['CAN_APPLY_DISCOUNT', 'CAN_VOID_ITEM', 'CAN_FINALIZE_PAYMENT', 'CAN_MANAGE_TABLES', 'CAN_VIEW_REPORTS', 'CAN_CLOSE_REGISTER', 'CAN_MANAGE_CUSTOMERS'],
    isSystem: false,
    icon: 'ShieldCheck'
  },
  { 
    id: 'CASHIER', 
    name: 'Cajero', 
    permissions: ['CAN_FINALIZE_PAYMENT', 'CAN_MANAGE_CUSTOMERS'], 
    isSystem: false,
    icon: 'Store'
  },
  { 
    id: 'WAITER', 
    name: 'Mesonero', 
    permissions: ['CAN_MANAGE_TABLES'], 
    isSystem: false,
    icon: 'Utensils'
  }
];

// Mock Users for Auth
export const MOCK_USERS: User[] = [
  { id: 'u1', name: 'Admin Principal', role: 'ADMIN', pin: '1111', photo: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?ixlib=rb-1.2.1&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80' },
  { id: 'u2', name: 'Roberto (Supervisor)', role: 'SUPERVISOR', pin: '2222', photo: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?ixlib=rb-1.2.1&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80' },
  { id: 'u3', name: 'Ana (Cajera)', role: 'CASHIER', pin: '3333', photo: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?ixlib=rb-1.2.1&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80' },
  { id: 'u4', name: 'Carlos (Mesonero)', role: 'WAITER', pin: '4444' },
];

export const MOCK_CUSTOMERS: Customer[] = [
  { id: 'c1', name: 'Juan Cliente', phone: '809-555-1234', email: 'juan@email.com', loyaltyPoints: 120, createdAt: new Date().toISOString() },
  { id: 'c2', name: 'Maria VIP', phone: '809-555-9876', email: 'maria@vip.com', taxId: '402-1234567-1', loyaltyPoints: 550, notes: 'Cliente frecuente, prefiere mesa en terraza.', createdAt: new Date().toISOString() },
  { id: 'c3', name: 'Empresa ABC S.R.L', phone: '809-555-5555', taxId: '101-55555-5', address: 'Calle Industrial #5', loyaltyPoints: 0, createdAt: new Date().toISOString() }
];

// Mock Products
export const RETAIL_PRODUCTS: Product[] = [
  { id: 'r1', name: 'Leche Entera 1L', price: 1.50, category: 'Lácteos', stock: 50, barcode: '101', image: 'https://picsum.photos/100/100?random=1' },
  { id: 'r2', name: 'Pan Molde', price: 2.00, category: 'Panadería', stock: 20, barcode: '102', image: 'https://picsum.photos/100/100?random=2' },
  { id: 'r3', name: 'Camiseta Básica', price: 15.00, category: 'Ropa', stock: 100, barcode: '103', image: 'https://picsum.photos/100/100?random=3' },
  { id: 'r4', name: 'Zapatillas Deportivas', price: 45.00, category: 'Calzado', stock: 15, barcode: '104', image: 'https://picsum.photos/100/100?random=4' },
  { id: 'r5', name: 'Paracetamol 500mg', price: 3.50, category: 'Farmacia', stock: 200, barcode: '105', image: 'https://picsum.photos/100/100?random=5' },
  { id: 'r6', name: 'Manzanas (kg)', price: 2.20, category: 'Frutas', stock: 100, isWeighted: true, barcode: '106', image: 'https://picsum.photos/100/100?random=6' },
  { id: 'r7', name: 'Champú', price: 5.50, category: 'Higiene', stock: 30, barcode: '107', image: 'https://picsum.photos/100/100?random=7' },
];

export const FOOD_PRODUCTS: Product[] = [
  { 
    id: 'f1', 
    name: 'Hamburguesa Clásica', 
    price: 8.50, 
    category: 'Platos', 
    hasModifiers: true, 
    barcode: '201', 
    image: 'https://picsum.photos/100/100?random=10',
    availableModifiers: [
      { id: 'm1', name: 'Sin Cebolla', price: 0 },
      { id: 'm2', name: 'Sin Tomate', price: 0 },
      { id: 'm3', name: 'Extra Queso', price: 1.50 },
      { id: 'm4', name: 'Extra Tocino', price: 2.00 },
      { id: 'm5', name: 'Término Bien Cocido', price: 0 }
    ]
  },
  { 
    id: 'f2', 
    name: 'Pizzas Margarita', 
    price: 10.00, 
    category: 'Platos', 
    hasModifiers: true, 
    barcode: '202', 
    image: 'https://picsum.photos/100/100?random=11',
    availableModifiers: [
      { id: 'm6', name: 'Orilla de Queso', price: 3.00 },
      { id: 'm7', name: 'Extra Pepperoni', price: 2.50 },
      { id: 'm8', name: 'Sin Albahaca', price: 0 }
    ]
  },
  { id: 'f3', name: 'Coca Cola', price: 2.00, category: 'Bebidas', stock: 100, barcode: '203', image: 'https://picsum.photos/100/100?random=12' },
  { id: 'f4', name: 'Cerveza Artesanal', price: 4.50, category: 'Bar', stock: 50, barcode: '204', image: 'https://picsum.photos/100/100?random=13' },
  { id: 'f5', name: 'Helado Vainilla', price: 3.00, category: 'Postres', barcode: '205', image: 'https://picsum.photos/100/100?random=14' },
  { id: 'f6', name: 'Café Espresso', price: 1.80, category: 'Cafetería', barcode: '206', image: 'https://picsum.photos/100/100?random=15' },
];

const DEFAULT_COMPANY_INFO = {
  name: 'Mi Empresa S.A.',
  address: 'Av. Principal #123',
  phone: '809-555-0100',
  rnc: '000000000',
  email: 'contacto@miempresa.com'
};

// Default Config Generators
export const getInitialConfig = (subVertical: SubVertical): BusinessConfig => {
  let config: BusinessConfig;

  switch (subVertical) {
    case SubVertical.RESTAURANT:
    case SubVertical.BAR:
      config = {
        vertical: VerticalType.RESTAURANT,
        subVertical,
        currencySymbol: '$',
        taxRate: 0.10,
        features: {
          tableManagement: true,
          kitchenPrinting: true,
          stockTracking: false, // Usually tracked in back-office for F&B
          barcodeScanning: false,
          tips: true,
          prescriptionCheck: false
        },
        themeColor: 'orange',
        companyInfo: DEFAULT_COMPANY_INFO
      };
      break;
    case SubVertical.SUPERMARKET:
    case SubVertical.CLOTHING:
    case SubVertical.PHARMACY:
      config = {
        vertical: VerticalType.RETAIL,
        subVertical,
        currencySymbol: '$',
        taxRate: 0.12,
        features: {
          tableManagement: false,
          kitchenPrinting: false,
          stockTracking: true,
          barcodeScanning: true,
          tips: false,
          prescriptionCheck: subVertical === SubVertical.PHARMACY
        },
        themeColor: 'blue',
        companyInfo: DEFAULT_COMPANY_INFO
      };
      break;
    case SubVertical.SERVICES:
      config = {
        vertical: VerticalType.SERVICE,
        subVertical,
        currencySymbol: '$',
        taxRate: 0.18,
        features: {
          tableManagement: false,
          kitchenPrinting: false,
          stockTracking: false,
          barcodeScanning: false,
          tips: true,
          prescriptionCheck: false
        },
        themeColor: 'purple',
        companyInfo: DEFAULT_COMPANY_INFO
      };
      break;
    default:
      config = {
        vertical: VerticalType.RETAIL,
        subVertical: SubVertical.GENERAL,
        currencySymbol: '$',
        taxRate: 0.0,
        features: {
          tableManagement: false,
          kitchenPrinting: false,
          stockTracking: true,
          barcodeScanning: false,
          tips: false,
          prescriptionCheck: false
        },
        themeColor: 'gray',
        companyInfo: DEFAULT_COMPANY_INFO
      };
  }
  return config;
};