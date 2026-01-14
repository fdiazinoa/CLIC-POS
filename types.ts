
export type VerticalType = 'RETAIL' | 'RESTAURANT';

export enum SubVertical {
  SUPERMARKET = 'Supermercado',
  CLOTHING = 'Tienda Ropa',
  PHARMACY = 'Farmacia',
  SERVICES = 'Servicios',
  RESTAURANT = 'Restaurante',
  FAST_FOOD = 'Fast Food',
  BAR = 'Discoteca/Bar'
}

export interface TaxDefinition {
  id: string;
  name: string;
  rate: number; // e.g., 0.18
  type: 'VAT' | 'SERVICE_CHARGE' | 'EXEMPT' | 'OTHER';
}

export interface CompanyInfo {
  name: string;
  rnc: string;
  phone: string;
  address: string;
}

export interface ReceiptConfig {
  logo?: string;
  footerMessage?: string;
  showCustomerInfo?: boolean;
  showSavings?: boolean;
  showQr?: boolean;
  showForeignCurrencyTotals?: boolean;
}

export interface DocumentSeries {
  id: string;
  name: string;
  description: string;
  prefix: string;
  nextNumber: number;
  padding: number;
  icon: string; 
  color: string; 
}

export interface TerminalConfig {
  defaultWarehouseId?: string;
  security: {
    deviceBindingToken: string;
    requirePinForVoid: boolean;
    requirePinForDiscount: boolean;
    autoLogoutMinutes: number;
  };
  pricing: {
    allowedTariffIds: string[];
    defaultTariffId: string;
  };
  workflow: {
    inventory: {
      realTimeValidation: boolean;
      allowNegativeStock: boolean;
      reserveStockOnCart: boolean;
      showStockOnTiles: boolean;
      showProductImagesInReceipt: boolean;
    };
    session: {
      blindClose: boolean;
      allowSalesWithOpenZ: boolean;
      maxCashInDrawer: number;
      askGuestsOnTicketOpen: boolean;
      autoPrintZReport: boolean;
    };
    offline: {
      mode: 'OPTIMISTIC' | 'STRICT' | 'READ_ONLY';
      maxOfflineTransactionLimit: number;
    };
  };
  financial: {
    roundingMethod: 'ROUND_HALF_UP' | 'ROUND_FLOOR' | 'NONE';
    taxInclusivePrices: boolean;
    printTaxBreakdown: boolean;
    returnChangeInBaseCurrency: boolean;
    acceptedCurrencies: string[];
  };
  documentSeries: DocumentSeries[];
  hardware: {
    cashDrawerTrigger: 'PRINTER' | 'DIRECT';
    receiptPrinterId?: string;
  };
  ux: {
    theme: 'LIGHT' | 'DARK';
    gridDensity: 'COMFORTABLE' | 'COMPACT';
    showProductImages: boolean;
    quickKeysLayout: 'A' | 'B';
  };
}

export interface CurrencyConfig {
  code: string;
  name: string;
  symbol: string;
  rate: number;
  isEnabled: boolean;
  isBase?: boolean;
}

export type PaymentMethod = 'CASH' | 'CARD' | 'QR' | 'OTHER';

export interface PaymentMethodDefinition {
  id: string;
  name: string;
  type: PaymentMethod;
  isEnabled: boolean;
  icon: string;
  color: string;
  opensDrawer: boolean;
  requiresSignature: boolean;
  integration: 'NONE' | 'CARNET' | 'VISANET' | 'STRIPE';
  integrationConfig?: Record<string, string>;
}

export interface TipConfiguration {
  enabled: boolean;
  defaultOptions: number[];
  allowCustomTip: boolean;
  serviceCharge: {
    enabled: boolean;
    percentage: number;
    applyIfTotalOver: number;
    applyIfGuestsOver: number;
  };
}

export interface EmailConfig {
  subjectTemplate: string;
  accentColor: string;
  bannerImage: string;
  customFooter: string;
  showSocialLinks: boolean;
}

export interface BusinessConfig {
  vertical: VerticalType;
  subVertical: SubVertical;
  currencySymbol: string;
  taxRate: number; // Global fallback
  taxes: TaxDefinition[]; // Multiple tax master list
  themeColor: 'blue' | 'orange' | 'gray';
  features: {
    stockTracking: boolean;
  };
  companyInfo: CompanyInfo;
  currencies: CurrencyConfig[];
  paymentMethods: PaymentMethodDefinition[];
  terminals: { id: string; config: TerminalConfig }[];
  tariffs: Tariff[];
  receiptConfig?: ReceiptConfig;
  tipsConfig?: TipConfiguration;
  emailConfig?: EmailConfig;
}

export interface RoleDefinition {
  id: string;
  name: string;
  permissions: string[];
  isSystem: boolean;
}

export interface User {
  id: string;
  name: string;
  pin: string;
  role: string;
  photo?: string;
}

export interface CustomerAddress {
  id: string;
  type: 'BILLING' | 'SHIPPING';
  isDefault: boolean;
  country: string;
  state: string;
  city: string;
  street: string;
  number: string;
  zipCode: string;
  latitude?: number;
  longitude?: number;
  receptionHours?: string;
  contactPhone?: string;
}

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  taxId?: string;
  address?: string;
  addresses?: CustomerAddress[];
  notes?: string;
  loyaltyPoints?: number;
  creditLimit?: number;
  currentDebt?: number;
  tags?: string[];
  tier?: string;
  requiresFiscalInvoice?: boolean;
  prefersEmail?: boolean;
  isTaxExempt?: boolean;
  applyChainedTax?: boolean;
  createdAt?: string;
  totalSpent?: number;
  lastVisit?: string;
  creditDays?: number;
}

export interface Modifier {
  id: string;
  name: string;
  price: number;
}

export interface ProductAttribute {
  id: string;
  name: string;
  options: string[];
  optionCodes: string[];
}

export interface ProductVariant {
  sku: string;
  barcode: string[];
  attributeValues: Record<string, string>;
  price: number;
  initialStock: number;
}

export interface TariffPrice {
  tariffId?: string;
  productId?: string;
  name?: string;
  price: number; 
  lockPrice?: boolean;
  costBase?: number;
  margin?: number;
  tax?: number;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  stock?: number;
  image?: string;
  barcode?: string;
  minStock?: number;
  cost?: number;
  type?: 'PRODUCT' | 'SERVICE' | 'KIT';
  images: string[];
  attributes: ProductAttribute[];
  variants: ProductVariant[];
  tariffs: TariffPrice[];
  stockBalances?: Record<string, number>;
  activeInWarehouses?: string[];
  trackStock?: boolean;
  purchaseTax?: number;
  salesTax?: number;
  appliedTaxIds: string[]; // Reference to TaxDefinition IDs
  description?: string;
  availableModifiers?: Modifier[];
}

export interface CartItem extends Product {
  quantity: number;
  cartId: string;
  note?: string;
  salespersonId?: string;
  originalPrice?: number;
  modifiers?: string[]; 
}

export interface PaymentEntry {
  id: string;
  method: PaymentMethod;
  amount: number;
  timestamp: Date;
  currencyCode?: string;
  amountOriginal?: number;
  exchangeRate?: number;
}

export interface Transaction {
  id: string;
  date: string;
  items: CartItem[];
  total: number;
  payments: PaymentEntry[];
  userId: string;
  userName: string;
  status: 'COMPLETED' | 'REFUNDED' | 'PARTIAL_REFUND';
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
  status: 'ORDERED' | 'PARTIAL' | 'COMPLETED';
  items: PurchaseOrderItem[];
  totalCost: number;
}

export type ViewState = 'SETUP' | 'WIZARD' | 'LOGIN' | 'POS' | 'SETTINGS' | 'CUSTOMERS' | 'HISTORY' | 'FINANCE' | 'Z_REPORT' | 'SUPPLY_CHAIN' | 'FRANCHISE_DASHBOARD';

export type PricingStrategyType = 'MANUAL' | 'COST_PLUS' | 'DERIVED';
export type RoundingRule = 'NONE' | 'ENDING_99' | 'CEILING';

export interface Tariff {
  id: string;
  name: string;
  active: boolean;
  currency: string;
  taxIncluded: boolean;
  strategy: {
    type: PricingStrategyType;
    rounding: RoundingRule;
    factor?: number; 
    baseTariffId?: string;
  };
  scope: {
    storeIds: string[];
    priority: number;
  };
  schedule: {
    daysOfWeek: number[];
    timeStart: string;
    timeEnd: string;
  };
  items: Record<string, TariffPrice>;
}

export interface CustomerTransaction {
  id: string;
  date: string;
  total: number;
  items: number;
  status: 'PAID' | 'PENDING' | 'CANCELLED';
}

export type PromotionType = 'DISCOUNT' | 'BOGO' | 'BUNDLE' | 'HAPPY_HOUR';

export interface Promotion {
  id: string;
  name: string;
  type: PromotionType;
  targetType: 'PRODUCT' | 'CATEGORY' | 'ALL';
  targetValue: string;
  benefitValue: number;
  schedule: {
    days: string[];
    startTime: string;
    endTime: string;
    isActive: boolean;
  };
}

export interface Shift {
  id: string;
  userId: string | null;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  label: string;
  color: string;
}

export interface TimeRecord {
  id: string;
  userId: string;
  type: 'IN' | 'OUT';
  timestamp: string;
  method: 'PIN' | 'FACE_ID';
}

export type LabelElementType = 'TEXT' | 'BARCODE' | 'QR' | 'IMAGE';
export type LabelDataSource = 'CUSTOM_TEXT' | 'PRODUCT_NAME' | 'PRODUCT_PRICE' | 'PRODUCT_SKU';

export interface LabelElement {
  id: string;
  type: LabelElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  dataSource: LabelDataSource;
  fontSize?: number;
  isBold?: boolean;
}

export interface LabelTemplate {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  elements: LabelElement[];
}

export type WarehouseType = 'PHYSICAL' | 'DISTRIBUTION' | 'VIRTUAL' | 'TRANSIT';

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  type: WarehouseType;
  address: string;
  allowPosSale: boolean;
  allowNegativeStock: boolean;
  isMain: boolean;
  storeId: string;
}

export type AttributeType = 'TEXT' | 'COLOR' | 'IMAGE' | 'SIZE';

export interface AttributeValue {
  id: string;
  name: string;
  shortCode: string;
  value: string;
}

export interface AttributeDefinition {
  id: string;
  name: string;
  type: AttributeType;
  values: AttributeValue[];
  options?: string[]; 
  optionCodes?: string[]; 
}

export interface VariantTemplate {
  id: string;
  name: string;
  attributeId: string;
  valueIds: string[];
}

export interface BehaviorConfig {
  allowNegativeStock: boolean;
  askGuestsOnTicketOpen: boolean;
  autoLogoutMinutes: number;
  requireManagerForRefunds: boolean;
  autoPrintZReport: boolean;
}
