
export enum VerticalType {
  RETAIL = 'RETAIL',
  RESTAURANT = 'RESTAURANT',
  SERVICE = 'SERVICE'
}

export enum SubVertical {
  SUPERMARKET = 'Supermercado',
  CLOTHING = 'Tienda de Ropa',
  PHARMACY = 'Farmacia',
  SERVICES = 'Servicios',
  RESTAURANT = 'Restaurante',
  FAST_FOOD = 'Fast Food',
  BAR = 'Discoteca/Bar',
  GENERAL = 'General'
}

// Relaxed RoleType to allow custom IDs, though we keep standard keys for defaults
export type RoleType = 'ADMIN' | 'SUPERVISOR' | 'CASHIER' | 'WAITER' | string;

export interface PermissionDetail {
  key: string;
  label: string;
  description: string;
  category: 'SALES' | 'ADMIN' | 'CASH' | 'SYSTEM'; // Added category for grouping
}

export interface RoleDefinition {
  id: string;
  name: string;
  permissions: string[]; // Array of Permission Keys
  isSystem?: boolean; // If true, cannot be deleted (like ADMIN)
  icon?: string; // Lucide Icon Name
}

export interface User {
  id: string;
  name: string;
  role: RoleType; // Maps to RoleDefinition.id
  pin: string;
  photo?: string; // URL or Base64 string of user photo
}

export interface TimeRecord {
  id: string;
  userId: string;
  type: 'IN' | 'OUT';
  timestamp: string; // ISO String
  method: 'PIN' | 'FACE_ID';
}

export interface Shift {
  id: string;
  userId: string | null; // Null if unassigned
  dayOfWeek: number; // 0 = Sunday, 1 = Monday...
  startTime: string; // "09:00"
  endTime: string; // "17:00"
  label: string; // "Turno Mañana"
  color: string; // Tailwind color class
}

export interface CustomerTransaction {
  id: string;
  date: string;
  type: 'SALE' | 'PAYMENT' | 'ADJUSTMENT';
  amount: number;
  description: string;
}

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  taxId?: string; // RNC or ID
  address?: string;
  loyaltyPoints: number;
  notes?: string;
  createdAt: string;
  // Credit Fields
  creditLimit?: number;
  currentDebt?: number;
  creditHistory?: CustomerTransaction[];
}

export interface CashMovement {
  id: string;
  type: 'IN' | 'OUT';
  amount: number;
  reason: string;
  timestamp: string; // ISO String
  userId: string;
  userName: string;
}

export interface Modifier {
  id: string;
  name: string;
  price: number;
}

// Retail Variant Definitions (Attributes)
export interface ProductAttributeOption {
  id: string;
  name: string; // e.g., "Rojo", "XL"
  value?: string; // Hex color code or raw value
}

export interface ProductAttribute {
  id: string;
  name: string; // e.g., "Color", "Talla"
  options: ProductAttributeOption[];
}

// Retail Concrete Variant (Matrix Result)
export interface ProductVariant {
  id: string;
  name: string; // "Camiseta - Rojo / XL"
  price: number;
  cost: number;
  stock: number;
  sku: string;
  combination: Record<string, string>; // { "Color": "Rojo", "Talla": "XL" }
}

export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  image?: string;
  stock?: number;
  isWeighted?: boolean; // For supermarket
  hasModifiers?: boolean; // For restaurant
  barcode?: string;
  availableModifiers?: Modifier[];
  // Retail Specifics
  cost?: number;
  margin?: number;
  minStock?: number;
  trackStock?: boolean;
  askPrice?: boolean; // Open price item
  taxRate?: number; // Specific tax override
  attributes?: ProductAttribute[]; // Definitions
  variants?: ProductVariant[]; // The generated matrix
}

export interface CartItem extends Product {
  cartId: string;
  quantity: number;
  modifiers?: string[]; // Array of modifier names
  note?: string;
  originalPrice?: number; // Base price before item-specific discounts/overrides
  discountReason?: string;
  isSent?: boolean; // If true, item has been sent to kitchen/bar
}

export type PaymentMethod = 'CASH' | 'CARD' | 'QR' | 'CREDIT' | 'OTHER';
export type PaymentIntegration = 'NONE' | 'CARNET' | 'VISANET' | 'STRIPE' | 'PAYPAL';

export interface PaymentMethodDefinition {
  id: string;
  name: string;
  type: PaymentMethod;
  isEnabled: boolean;
  icon: string; // Lucide icon name
  color: string; // Tailwind color class (e.g., 'bg-green-500')
  opensDrawer: boolean;
  requiresSignature: boolean;
  integration?: PaymentIntegration; // Only relevant if type === 'CARD' or 'QR'
}

export interface CurrencyConfig {
  code: string; // USD, EUR, MXN
  name: string;
  symbol: string;
  rate: number; // Exchange rate relative to base currency (1 Base = X This)
  isEnabled: boolean;
  isBase: boolean;
}

export interface TipConfiguration {
  enabled: boolean;
  defaultOptions: [number, number, number]; // e.g. [10, 15, 20]
  allowCustomTip: boolean;
  serviceCharge: {
    enabled: boolean;
    percentage: number;
    applyIfTotalOver?: number; // Apply if ticket > X
    applyIfGuestsOver?: number; // Apply if guests > X
  };
}

export interface PaymentEntry {
  id: string;
  method: PaymentMethod;
  amount: number;
  timestamp: Date; // Note: When parsing from JSON, this might be a string
}

export interface Transaction {
  id: string;
  date: string; // ISO string
  items: CartItem[];
  total: number;
  payments: PaymentEntry[];
  userId: string;
  userName: string;
  customerId?: string;
  customerName?: string;
  status?: 'COMPLETED' | 'REFUNDED' | 'PARTIAL_REFUND';
  refundReason?: string;
}

// --- LABEL DESIGNER TYPES ---
export type LabelElementType = 'TEXT' | 'BARCODE' | 'QR' | 'IMAGE';
export type LabelDataSource = 'PRODUCT_NAME' | 'PRODUCT_PRICE' | 'PRODUCT_SKU' | 'CUSTOM_TEXT';

export interface LabelElement {
  id: string;
  type: LabelElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
  isBold?: boolean;
  content: string; // Or placeholder text
  dataSource: LabelDataSource;
}

export interface LabelTemplate {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  elements: LabelElement[];
}

// --- SUPPLY CHAIN INTERFACES ---
export interface Supplier {
  id: string;
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
}

export type PurchaseOrderStatus = 'DRAFT' | 'ORDERED' | 'PARTIAL' | 'COMPLETED';

export interface PurchaseOrderItem {
  productId: string;
  productName: string;
  quantityOrdered: number;
  quantityReceived: number;
  cost: number;
}

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  date: string; // ISO
  status: PurchaseOrderStatus;
  items: PurchaseOrderItem[];
  totalCost: number;
  notes?: string;
}

// --- PROMOTION ENGINE TYPES ---
export type PromotionType = 'DISCOUNT' | 'BOGO' | 'BUNDLE' | 'HAPPY_HOUR';

export interface PromotionSchedule {
  days: string[]; // ['MON', 'TUE', ...]
  startTime: string; // "17:00"
  endTime: string; // "20:00"
  isActive: boolean;
}

export interface Promotion {
  id: string;
  name: string;
  type: PromotionType;
  targetType: 'PRODUCT' | 'CATEGORY' | 'ALL';
  targetValue: string; // Product ID or Category Name
  benefitValue: number; // e.g. 50 (for 50%) or 100 (for free item)
  schedule: PromotionSchedule;
}

export interface CompanyInfo {
  name: string;
  address: string;
  phone: string;
  rnc: string;
  email: string;
}

export interface ReceiptConfig {
  logo?: string; // Base64
  headerText?: string; // Additional header info
  footerMessage: string;
  showCustomerInfo: boolean;
  showSavings: boolean;
  showQr: boolean;
}

export interface BusinessConfig {
  vertical: VerticalType;
  subVertical: SubVertical;
  currencySymbol: string;
  taxRate: number;
  features: {
    tableManagement: boolean;
    kitchenPrinting: boolean;
    stockTracking: boolean;
    barcodeScanning: boolean;
    tips: boolean;
    prescriptionCheck: boolean; // Pharmacy
  };
  themeColor: string;
  companyInfo: CompanyInfo;
  receiptConfig?: ReceiptConfig;
  // New Payment & Currency Configs
  paymentMethods?: PaymentMethodDefinition[];
  currencies?: CurrencyConfig[];
  // Label Config
  labelTemplates?: LabelTemplate[];
  // Tip Config
  tipsConfig?: TipConfiguration;
}

export interface SavedTicket {
  id: string;
  alias: string;
  timestamp: string;
  items: CartItem[];
  customer: Customer | null;
  total: number;
  tableId?: number | null; // Linked table ID
  guestCount?: number; // Number of diners
}

export interface Table {
  id: number;
  name: string;
  zone: string;
  status: 'AVAILABLE' | 'OCCUPIED';
  guests: number;
  time: string | null;
  amount: number | null;
  ticketId?: string; // Links to a SavedTicket
}

export type ViewState = 'SETUP' | 'WIZARD' | 'LOGIN' | 'POS' | 'SETTINGS' | 'CUSTOMERS' | 'Z_REPORT' | 'HISTORY' | 'FINANCE' | 'SUPPLY_CHAIN' | 'FRANCHISE_DASHBOARD';
