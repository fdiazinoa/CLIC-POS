
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
  type: 'SALE' | 'PAYMENT' | 'REFUND';
  amount: number;
  description: string;
}

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  taxId?: string; // RNC / NIF
  address?: string;
  notes?: string;
  loyaltyPoints?: number;
  createdAt: string;
  
  // Credit / Debt Logic
  creditLimit?: number;
  currentDebt?: number;
  creditHistory?: CustomerTransaction[];
}

export interface Modifier {
  id: string;
  name: string;
  price: number;
}

export interface ProductAttributeOption {
  id: string;
  name: string; // e.g. "Red", "XL"
}

export interface ProductAttribute {
  id: string;
  name: string; // e.g. "Color", "Size"
  options: ProductAttributeOption[];
}

export interface ProductVariant {
  id: string;
  name: string; // "Red / XL"
  price: number;
  stock: number;
  sku: string;
  cost?: number;
  combination: Record<string, string>; // { "Color": "Red", "Size": "XL" }
}

export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  stock?: number;
  minStock?: number; // Alert threshold
  barcode?: string;
  image?: string;
  isWeighted?: boolean; // For scales
  hasModifiers?: boolean;
  availableModifiers?: Modifier[];
  
  // Advanced Fields
  cost?: number;
  margin?: number; // %
  trackStock?: boolean;
  askPrice?: boolean; // Open Price Item
  
  // Variants
  attributes?: ProductAttribute[];
  variants?: ProductVariant[];
}

export interface CartItem extends Product {
  cartId: string; // Unique ID for cart instance
  quantity: number;
  originalPrice?: number; // Track if discounted
  modifiers?: string[]; // Array of modifier names
  note?: string; // Kitchen notes
  isSent?: boolean; // For kitchen orders
}

export type PaymentMethod = 'CASH' | 'CARD' | 'QR' | 'OTHER';

export interface PaymentEntry {
  id: string;
  method: PaymentMethod;
  amount: number;
  timestamp: Date;
}

export interface Transaction {
  id: string;
  date: string;
  items: CartItem[];
  total: number;
  payments: PaymentEntry[];
  userId: string;
  userName: string;
  status?: 'COMPLETED' | 'REFUNDED' | 'PARTIAL_REFUND';
  refundReason?: string;
  customerId?: string;
  customerName?: string;
}

export interface CashMovement {
  id: string;
  type: 'IN' | 'OUT';
  amount: number;
  reason: string;
  timestamp: string;
  userId: string;
  userName: string;
}

export interface CompanyInfo {
  name: string;
  address: string;
  phone: string;
  rnc: string;
  email: string;
}

export interface Supplier {
  id: string;
  name: string;
  contactName: string;
  phone: string;
  email: string;
}

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
  date: string;
  status: 'DRAFT' | 'ORDERED' | 'PARTIAL' | 'COMPLETED';
  items: PurchaseOrderItem[];
  totalCost: number;
}

// Configuration Types

export interface ReceiptConfig {
  logo?: string;
  footerMessage?: string;
  showCustomerInfo?: boolean;
  showSavings?: boolean;
  showQr?: boolean;
}

export interface EmailConfig {
  subjectTemplate: string;
  accentColor: string;
  bannerImage?: string;
  customFooter?: string;
  showSocialLinks: boolean;
}

export interface PaymentMethodDefinition {
  id: string;
  name: string;
  type: PaymentMethod;
  isEnabled: boolean;
  icon: string; // Lucide Icon Name
  color: string; // Tailwind class
  opensDrawer: boolean;
  requiresSignature: boolean;
  integration?: 'NONE' | 'CARNET' | 'VISANET' | 'STRIPE'; // Mock integrations
}

export interface CurrencyConfig {
  code: string;
  name: string;
  symbol: string;
  rate: number;
  isEnabled: boolean;
  isBase: boolean;
}

export interface LabelElement {
  id: string;
  type: 'TEXT' | 'BARCODE' | 'QR' | 'IMAGE';
  x: number; // mm
  y: number; // mm
  width: number; // mm
  height: number; // mm
  content: string; // Template string or static
  dataSource: 'PRODUCT_NAME' | 'PRODUCT_PRICE' | 'PRODUCT_SKU' | 'CUSTOM_TEXT';
  fontSize?: number;
  isBold?: boolean;
}

export type LabelElementType = LabelElement['type'];
export type LabelDataSource = LabelElement['dataSource'];

export interface LabelTemplate {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  elements: LabelElement[];
}

export interface TipConfiguration {
  enabled: boolean;
  defaultOptions: [number, number, number]; // e.g. [10, 15, 20]
  allowCustomTip: boolean;
  serviceCharge: {
    enabled: boolean;
    percentage: number;
    applyIfTotalOver?: number; // Only apply if ticket > X
    applyIfGuestsOver?: number; // Only apply if guests > Y
  };
}

export type PromotionType = 'DISCOUNT' | 'BOGO' | 'BUNDLE' | 'HAPPY_HOUR';

export interface Promotion {
  id: string;
  name: string;
  type: PromotionType;
  isActive: boolean;
  priority: number;
  
  // Schedule
  daysOfWeek: string[]; // ['L', 'M', ...]
  timeStart: string; // "00:00"
  timeEnd: string; // "23:59"
  startDate?: string;
  endDate?: string;

  // Rules
  targetType: 'PRODUCT' | 'CATEGORY' | 'ALL';
  targetValue: string; // ID of product/category
  
  // Benefits
  discountPercent?: number;
  discountFixed?: number;
  fixedPrice?: number;
  buyQuantity?: number; // For BOGO/Bundle
  getQuantity?: number; // For BOGO
}

// --- NEW: Behavior Configuration ---
export interface BehaviorConfig {
  // Sales
  allowNegativeStock: boolean;
  askGuestsOnTicketOpen: boolean; // Restaurant specific
  
  // Security
  autoLogoutMinutes: number; // 0 to disable
  requireManagerForRefunds: boolean;
  
  // Closing
  autoPrintZReport: boolean;
}

// --- NEW: Hardware Extensions ---
export interface CustomerDisplayConfig {
  isEnabled: boolean;
  welcomeMessage: string;
  idleImage?: string;
  showItemDetails: boolean;
}

export interface CashDroConfig {
  isEnabled: boolean;
  ipAddress: string;
  port: string;
  user: string;
  password?: string;
}

export interface BusinessConfig {
  vertical: VerticalType;
  subVertical: SubVertical;
  currencySymbol: string;
  taxRate: number;
  themeColor: 'blue' | 'orange' | 'purple' | 'gray';
  companyInfo: CompanyInfo;
  features: {
    tableManagement: boolean;
    kitchenPrinting: boolean;
    stockTracking: boolean;
    barcodeScanning: boolean;
    tips: boolean;
    prescriptionCheck: boolean;
  };
  // Advanced Configs
  receiptConfig?: ReceiptConfig;
  emailConfig?: EmailConfig;
  paymentMethods?: PaymentMethodDefinition[];
  currencies?: CurrencyConfig[];
  labelTemplates?: LabelTemplate[];
  tipsConfig?: TipConfiguration;
  promotions?: Promotion[];
  behaviorConfig?: BehaviorConfig;
  
  // Hardware Specific
  customerDisplayConfig?: CustomerDisplayConfig;
  cashDroConfig?: CashDroConfig;
}

// --- Helper Types for UI ---
export interface SavedTicket {
  id: string;
  alias: string;
  timestamp: string;
  items: CartItem[];
  customer: Customer | null;
  total: number;
  tableId: number | null;
  guestCount?: number;
}

export interface Table {
  id: number;
  name: string;
  zone: string;
  status: 'AVAILABLE' | 'OCCUPIED' | 'RESERVED';
  guests: number;
  time: string | null;
  amount: number | null;
  ticketId?: string;
}

export type ViewState = 'SETUP' | 'WIZARD' | 'LOGIN' | 'POS' | 'SETTINGS' | 'CUSTOMERS' | 'HISTORY' | 'FINANCE' | 'Z_REPORT' | 'SUPPLY_CHAIN' | 'FRANCHISE_DASHBOARD';
