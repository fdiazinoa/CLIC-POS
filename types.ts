
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

// --- FISCAL NCF TYPES ---
export type NCFType = 'B01' | 'B02' | 'B14' | 'B15';

export interface FiscalRangeDGII {
  id: string;
  type: NCFType;
  prefix: string;
  startNumber: number;
  endNumber: number;
  currentGlobal: number; // Último entregado a cualquier terminal
  expiryDate: string;
  isActive: boolean;
}

export interface FiscalAllocation {
  id: string;
  terminalId: string;
  type: NCFType;
  rangeStart: number;
  rangeEnd: number;
  assignedAt: string;
  status: 'ACTIVE' | 'EXHAUSTED';
}

export interface LocalFiscalBuffer {
  type: NCFType;
  prefix: string;
  currentNumber: number; // El que se usará en la próxima factura
  endNumber: number;     // Límite de este lote
  expiryDate: string;
}

// --- KARDEX TYPES ---
export type LedgerConcept = 'COMPRA' | 'VENTA' | 'AJUSTE_ENTRADA' | 'AJUSTE_SALIDA' | 'TRASPASO_ENTRADA' | 'TRASPASO_SALIDA' | 'INICIAL';

export interface InventoryLedgerEntry {
  id: string;
  createdAt: string;
  warehouseId: string;
  productId: string;
  concept: LedgerConcept;
  documentRef: string; 
  qtyIn: number;
  qtyOut: number;
  unitCost: number; 
  balanceQty: number; 
  balanceAvgCost: number; 
}

// --- WATCHLIST & BI TYPES ---
export type WatchlistCriteria = 'MANUAL' | 'RECENT_IN' | 'DORMANT_STOCKS' | 'LOW_STOCK';

export interface WatchlistAlertSettings {
  maxDormancyDays: number;
  minVelocity: number;
  minSellThrough: number;
  criticalWeeksOfSupply: number;
  overstockWeeksOfSupply: number;
}

export interface Watchlist {
  id: string;
  name: string;
  description?: string;
  criteria: WatchlistCriteria;
  productIds: string[];
  createdAt: string;
  color?: string;
  alertSettings: WatchlistAlertSettings;
}

export interface WatchlistKPIs {
  productId: string;
  lastSaleDate: string | null;
  daysSinceLastSale: number;
  velocity7d: number; 
  sellThrough: number; 
  weeksOfSupply: number;
  totalSoldPeriod: number;
}

export type ScaleTech = 'DIRECT' | 'LABEL';

export interface TaxDefinition {
  id: string;
  name: string;
  rate: number; 
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

export interface NCFConfig {
  batchSize: number;
  lowBatchThreshold: number;
}

export interface TerminalConfig {
  currentDeviceId?: string;
  lastPairingDate?: string;
  isBlocked?: boolean;
  deviceBindingToken: string;
  
  fiscal: {
    batchSize: number; // Deprecated but kept for compatibility
    lowBatchThreshold: number;
    // New: Configuration per NCF Type
    typeConfigs?: Partial<Record<NCFType, NCFConfig>>;
  };

  security: {
    deviceBindingToken: string;
    requirePinForVoid: boolean;
    requirePinForDiscount: boolean;
    requireManagerForRefunds: boolean;
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
    customerDisplay?: CustomerDisplayConfig;
    scales?: ScaleDevice[];
  };
  ux: {
    theme: 'LIGHT' | 'DARK';
    gridDensity: 'COMFORTABLE' | 'COMPACT';
    showProductImages: boolean;
    quickKeysLayout: 'A' | 'B';
  };
  inventoryScope?: {
    defaultSalesWarehouseId: string;
    visibleWarehouseIds: string[];
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

export type PromotionType = 'DISCOUNT' | 'BOGO' | 'BUNDLE' | 'HAPPY_HOUR';
export type AttributeType = 'TEXT' | 'COLOR' | 'IMAGE';
export type PricingStrategyType = 'MANUAL' | 'COST_PLUS' | 'DERIVED';
export type RoundingRule = 'NONE' | 'ENDING_99' | 'CEILING' | 'ROUND_HALF_UP' | 'ROUND_FLOOR';

export interface Modifier {
  id: string;
  name: string;
  price: number;
}

export interface ProductGroup {
  id: string;
  name: string;
  code: string;
  color?: string;
  description?: string;
  productIds: string[];
}

export interface Season {
  id: string;
  name: string;
  code: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  productIds: string[];
}

export interface TipConfiguration {
  enabled: boolean;
  defaultOptions: [number, number, number];
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
  taxRate: number;
  taxes: TaxDefinition[];
  themeColor: 'blue' | 'orange' | 'gray';
  features: {
    stockTracking: boolean;
  };
  companyInfo: CompanyInfo;
  currencies: CurrencyConfig[];
  paymentMethods: PaymentMethodDefinition[];
  terminals: { id: string; config: TerminalConfig }[];
  tariffs: Tariff[];
  productGroups?: ProductGroup[];
  seasons?: Season[];
  receiptConfig?: ReceiptConfig;
  tipsConfig?: TipConfiguration;
  emailConfig?: EmailConfig;
  scales?: ScaleDevice[];
  scaleLabelConfig?: {
    isEnabled: boolean;
    prefixes: string[];
    itemDigits: number;
    valueDigits: number;
    decimals: number;
    mode: 'WEIGHT' | 'PRICE';
  };
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
  notes?: string;
  loyaltyPoints?: number;
  creditLimit?: number;
  currentDebt?: number;
  tier?: string;
  createdAt?: string;
  totalSpent?: number;
  lastVisit?: string;
  tags?: string[];
  requiresFiscalInvoice?: boolean;
  prefersEmail?: boolean;
  isTaxExempt?: boolean;
  applyChainedTax?: boolean;
  addresses?: CustomerAddress[];
  creditDays?: number;
  defaultNcfType?: NCFType;
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
  initialStock?: number;
}

export interface TariffPrice {
  tariffId: string;
  name?: string;
  price: number;
  costBase?: number;
  margin?: number;
  tax?: number;
}

export interface ProductOperationalFlags {
  isWeighted: boolean;
  trackInventory: boolean;
  autoPrintLabel: boolean;
  promptPrice: boolean;
  integersOnly: boolean;
  ageRestricted: boolean;
  allowNegativeStock: boolean;
  excludeFromPromotions: boolean;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  stock?: number;
  image?: string;
  barcode?: string;
  cost?: number; 
  type?: 'PRODUCT' | 'SERVICE' | 'KIT';
  images: string[];
  attributes: ProductAttribute[];
  variants: ProductVariant[];
  tariffs: TariffPrice[];
  stockBalances?: Record<string, number>;
  activeInWarehouses?: string[];
  appliedTaxIds: string[];
  minStock?: number;
  warehouseSettings?: Record<string, {min: number, max: number}>;
  availableModifiers?: Modifier[];
  description?: string;
  departmentId?: string;
  sectionId?: string;
  familyId?: string;
  subfamilyId?: string;
  brandId?: string;
  operationalFlags?: ProductOperationalFlags;
  createdAt?: string;
}

export interface CartItem extends Product {
  quantity: number;
  cartId: string;
  modifiers?: string[];
  note?: string;
  originalPrice?: number;
  salespersonId?: string;
  ncf?: string; // NCF asignado a esta línea o al ticket
}

export interface Transaction {
  id: string;
  date: string;
  items: CartItem[];
  total: number;
  payments: any[];
  userId: string;
  userName: string;
  terminalId?: string; // Nuevo: Para auditoría por caja
  status: 'COMPLETED' | 'REFUNDED' | 'PARTIAL_REFUND';
  customerId?: string;
  customerName?: string;
  refundReason?: string;
  ncf?: string; // NCF final del documento
  ncfType?: NCFType;
}

export type ViewState = 'SETUP' | 'WIZARD' | 'LOGIN' | 'POS' | 'SETTINGS' | 'CUSTOMERS' | 'HISTORY' | 'FINANCE' | 'Z_REPORT' | 'SUPPLY_CHAIN' | 'FRANCHISE_DASHBOARD' | 'DEVICE_UNAUTHORIZED';

export interface TariffPriceOverride {
  productId: string;
  price: number;
  lockPrice: boolean;
}

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
  items: Record<string, TariffPriceOverride>;
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  type: string;
  address: string;
  allowPosSale: boolean;
  allowNegativeStock: boolean;
  isMain?: boolean;
  storeId?: string;
}

export interface StockTransferItem {
  productId: string;
  productName: string;
  quantity: number;
}

export interface StockTransfer {
  id: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  items: StockTransferItem[];
  status: 'IN_TRANSIT' | 'COMPLETED';
  createdAt: string;
  sentAt?: string; 
  receivedAt?: string;
  createdBy?: string;
}

export interface Promotion {
  id: string;
  name: string;
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

export interface ParkedTicket {
  id: string;
  name: string;
  items: CartItem[];
  customerId?: string;
  customerName?: string;
  timestamp: string;
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

export interface CustomerTransaction {
  id: string;
  date: string;
  total: number;
  status: string;
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

export type LabelElementType = 'TEXT' | 'BARCODE' | 'QR';
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

export interface BehaviorConfig {
  allowNegativeStock: boolean;
  askGuestsOnTicketOpen: boolean;
  autoLogoutMinutes: number;
  requireManagerForRefunds: boolean;
  autoPrintZReport: boolean;
}

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
}

export interface VariantTemplate {
  id: string;
  name: string;
  attributeId: string;
  valueIds: string[];
}

export interface CustomerDisplayConfig {
  isEnabled: boolean;
  welcomeMessage: string;
  showItemImages: boolean;
  showQrPayment: boolean;
  layout: 'SPLIT' | 'FULL_TOTAL' | 'MARKETING_ONLY';
  connectionType: 'NETWORK' | 'USB' | 'VIRTUAL' | 'HDMI';
  ipAddress?: string;
  ads: { id: string; url: string; active: boolean }[];
}

export interface ScaleDevice {
  id: string;
  name: string;
  isEnabled: boolean;
  technology: ScaleTech;
  directConfig?: {
    port: string;
    baudRate: number;
    dataBits: number;
    protocol: string;
  };
  labelConfig?: {
    mode: 'WEIGHT' | 'PRICE';
    prefixes: string[];
    decimals: number;
    itemDigits: number;
    valueDigits: number;
  };
}
