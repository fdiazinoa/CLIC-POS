

export type VerticalType = 'RETAIL' | 'RESTAURANT';

export const SubVertical = {
  SUPERMARKET: 'Supermercado',
  CLOTHING: 'Tienda Ropa',
  PHARMACY: 'Farmacia',
  SERVICES: 'Servicios',
  RESTAURANT: 'Restaurante',
  FAST_FOOD: 'Fast Food',
  BAR: 'Discoteca/Bar'
} as const;

export type SubVertical = typeof SubVertical[keyof typeof SubVertical];

// --- SYNC CONFIGURATION TYPES ---
export type SyncMode = 'MASTER' | 'SLAVE';
export type SyncStatus = 'PENDING' | 'SYNCING' | 'COMPLETED' | 'ERROR';

export interface SyncConfig {
  mode: SyncMode;
  masterUrl?: string; // Required for SLAVE terminals (e.g., "https://192.168.1.100:3001")
  authToken?: string;
  autoSyncIntervalMs: number;
  isEnabled: boolean;
}


// --- DEVICE ROLE TYPES ---
export enum DeviceRole {
  STANDARD_POS = 'STANDARD_POS',
  SELF_CHECKOUT = 'SELF_CHECKOUT',
  PRICE_CHECKER = 'PRICE_CHECKER',
  HANDHELD_INVENTORY = 'HANDHELD_INVENTORY',
  KITCHEN_DISPLAY = 'KITCHEN_DISPLAY'
}

export enum AuthLevel {
  USER_REQUIRED = 'USER_REQUIRED',    // Level A: Requiere login de empleado
  HEADLESS = 'HEADLESS'                // Level B: Autenticación automática vía API Token
}

export interface DeviceRoleConfig {
  role: DeviceRole;
  authLevel: AuthLevel;
  apiToken?: string;              // Para autenticación headless
  defaultRoute?: string;          // Ruta inicial después de auth
  allowedModules: string[];       // Módulos permitidos
  uiSettings: {
    fullscreenForced?: boolean;
    touchTargetSize?: number;    // En px (>60px recomendado para kiosco)
    navigationLocked?: boolean;   // Prevenir navegación hacia atrás
    escapeHatch?: {
      enabled: boolean;
      gesture: string;            // ej: "logo-press-5s"
      requirePin: boolean;
      adminPin?: string;
    };
  };
  hardwareConfig?: {
    disablePrinter?: boolean;
    disableCashDrawer?: boolean;
    disableScanner?: boolean;
  };
}

// --- HARDWARE TYPES ---
export type ConnectionType = 'BLUETOOTH' | 'NETWORK' | 'USB' | 'SERIAL' | 'VIRTUAL';

export interface PrinterDevice {
  id: string;
  name: string;
  connection: ConnectionType;
  address?: string; // IP o MAC
  status: 'CONNECTED' | 'DISCONNECTED';
  type: 'TICKET' | 'LABEL' | 'KITCHEN' | 'LOGISTICS';
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
  id: string;
  type: NCFType;
  prefix: string;
  currentNumber: number; // El que se usará en la próxima factura
  endNumber: number;     // Límite de este lote
  expiryDate: string;
}

// --- KARDEX TYPES ---
export type LedgerConcept = 'COMPRA' | 'VENTA' | 'AJUSTE_ENTRADA' | 'AJUSTE_SALIDA' | 'TRASPASO_ENTRADA' | 'TRASPASO_SALIDA' | 'INICIAL' | 'DEVOLUCION';

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
  terminalId?: string; // Terminal ID or Series
  syncStatus?: SyncStatus;
  syncError?: string;
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

// Document Types for all transaction categories
export type DocumentType =
  // Sales
  | 'TICKET'           // Regular sale
  | 'REFUND'           // Refund/Return
  | 'VOID'             // Voided transaction

  // Inventory
  | 'TRANSFER'         // Transfer between warehouses
  | 'ADJUSTMENT_IN'    // Positive inventory adjustment
  | 'ADJUSTMENT_OUT'   // Negative inventory adjustment
  | 'PURCHASE'         // Purchase from supplier
  | 'PRODUCTION'       // Production/Assembly

  // Cash
  | 'CASH_IN'          // Cash in
  | 'CASH_OUT'         // Cash out
  | 'CASH_DEPOSIT'     // Bank deposit
  | 'CASH_WITHDRAWAL'  // Cash withdrawal

  // Closures
  | 'Z_REPORT'         // Cash register closure
  | 'X_REPORT'         // Partial report

  // Accounts
  | 'RECEIVABLE'       // Accounts receivable
  | 'PAYABLE'          // Accounts payable
  | 'PAYMENT_IN'       // Payment received
  | 'PAYMENT_OUT';     // Payment made

export interface DocumentSeries {
  id: string;
  documentType: DocumentType;  // Functional type
  name: string;
  description: string;
  prefix: string;
  nextNumber: number;
  padding: number;
  icon: string;
  color: string;
  businessUnit?: string;  // Optional: "Tienda Norte", "Caja Express"
}

export interface NCFConfig {
  batchSize: number;
  lowBatchThreshold: number;
  lowBatchThresholdPct?: number; // Umbral de alerta por porcentaje
}

export interface TerminalConfig {
  currentDeviceId?: string;
  lastPairingDate?: string;
  isBlocked?: boolean;
  deviceBindingToken: string;
  isPrimaryNode?: boolean; // Rol jerárquico de la terminal
  governedByMaster?: boolean; // NEW: If true, this terminal follows the configuration defined by the Master
  deviceRole?: DeviceRoleConfig; // NEW: Configuración de rol de dispositivo

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
      zReportEmails?: string;
      // New fields for Z Report Expansion
      checkOpenOrders: boolean;
      forceDenominationCount: boolean;
      cashVarianceThreshold: number;
      emailZReport: boolean;
      // New fields for Force Z on Day Change
      forceZChange: boolean;
      businessStartHour: number;
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
  documentAssignments?: Record<string, string>; // Mapeo de Rol -> ID de DocumentSeries maestra
  hardware: {
    cashDrawerTrigger: 'PRINTER' | 'DIRECT';
    receiptPrinterId?: string;
    printerAssignments?: Record<string, string>; // Roles: TICKET, LABEL, KITCHEN, LOGISTICS
    customerDisplay?: CustomerDisplayConfig;
    scales?: ScaleDevice[];
  };
  ux: {
    theme: 'LIGHT' | 'DARK';
    gridDensity: 'COMFORTABLE' | 'COMPACT';
    showProductImages: boolean;
    quickKeysLayout: 'A' | 'B';
    viewMode: 'VISUAL' | 'RETAIL';
  };
  catalog?: {
    allowedCategories: string[];
  };
  inventoryScope?: {
    defaultSalesWarehouseId: string;
    visibleWarehouseIds: string[];
  };
  wallet?: WalletConfig;
  syncConfig?: SyncConfig;
}

export interface WalletConfig {
  apple: {
    teamId: string;
    passTypeIdentifier: string;
    p12Cert: string; // Base64 (Encrypted in storage)
    p12Password: string; // (Encrypted in storage)
    isConfigured: boolean;
  };
  google: {
    issuerId: string;
    serviceAccountJson: string; // JSON String (Encrypted in storage)
    isConfigured: boolean;
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

export type PaymentMethod = 'CASH' | 'CARD' | 'QR' | 'WALLET' | 'OTHER';

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

export interface N8nConfig {
  webhookUrl: string;
  events: {
    onSale: boolean;
    onZReport: boolean;
  };
}

export interface EmailConfig {
  provider: 'resend';
  apiKey: string;
  from: string;
  defaultRecipient?: string; // Fallback recipient for system emails
  subjectTemplate?: string;
  accentColor?: string;
  bannerImage?: string;
  customFooter?: string;
  showSocialLinks?: boolean;
}

export interface ScaleLabelConfig {
  isEnabled: boolean;
  prefixes: string[];
  structure: {
    totalLength: number;
    prefixLength: number;
    pluStart: number;
    pluLength: number;
    valueStart: number;
    valueLength: number;
    checksumLength: number;
  };
  valueType: 'WEIGHT' | 'PRICE';
  decimals: number;
}



export interface LoyaltyConfig {
  isEnabled: boolean;
  earnRate: number; // Points per 1 unit of currency (e.g., 0.1 for 1 point per $10)
  redeemRate: number; // Value of 1 point (e.g., 0.10)
  minRedemptionPoints: number;
  expirationMonths: number;
  excludedCategories: string[];
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
  loyalty?: LoyaltyConfig;
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
  availablePrinters?: PrinterDevice[];
  scales?: ScaleDevice[];
  scaleLabelConfig?: ScaleLabelConfig;
  promotions?: Promotion[];
  campaigns?: Campaign[];
  coupons?: Coupon[];
  roles?: RoleDefinition[];
  auditLogs?: AuditLogEntry[];
  n8nConfig?: N8nConfig;
}

export interface RoleDefinition {
  id: string;
  name: string;
  permissions: Permission[];
  maxDiscountPercent?: number;
  isSystem?: boolean;
  zReportConfig?: {
    hiddenModules: ZReportModule[];
  };
}

export interface User {
  id: string;
  name: string;
  pin: string;
  role: string; // Legacy role string, keep for compatibility or migrate
  roleId?: string; // Link to RoleDefinition
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
  wallet?: Wallet;
  cards?: LoyaltyCard[];
  loyalty?: LoyaltyCard; // Deprecated, kept for backward compatibility during migration
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
  excludeFromLoyalty: boolean;
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
  warehouseSettings?: Record<string, { min: number, max: number }>;
  availableModifiers?: Modifier[];
  description?: string;
  departmentId?: string;
  sectionId?: string;
  familyId?: string;
  subfamilyId?: string;
  brandId?: string;
  operationalFlags?: ProductOperationalFlags;
  createdAt?: string;
  updatedAt?: string;
  hasActivePromotion?: boolean; // UI Flag for badges
}

export interface ProductStock {
  id: string; // generateId(productId, warehouseId)
  productId: string;
  warehouseId: string;
  quantity: number;
  updatedAt: string;
}

/**
 * Cart Item
 * 
 * IMPORTANT - PRICE SNAPSHOT PROTECTION:
 * When a product is added to cart, its `price` field becomes a SNAPSHOT
 * and is FROZEN for the duration of that sale. Subsequent catalog updates
 * (price changes, bulk updates, etc.) WILL NOT affect items already in cart.
 * 
 * This prevents the following scenario:
 * - Customer adds item @ $2.50
 * - Admin changes price to $3.00 on master terminal
 * - Catalog syncs to slave
 * - Customer would suddenly owe $3.00 instead of $2.50
 * 
 * With snapshot protection:
 * - Price at time of adding to cart is preserved
 * - Customer pays what they saw when they added item
 * - Next sale will use new price
 */
export interface CartItem extends Product {
  quantity: number;
  cartId: string;
  modifiers?: string[];
  note?: string;
  originalPrice?: number; // Optional: track original product price for auditing
  salespersonId?: string;
  ncf?: string; // NCF asignado a esta línea o al ticket
  appliedPromotionId?: string;
}

export interface Transaction {
  // Identifiers
  id: string;
  globalSequence?: number;          // Global unique sequence number
  displayId?: string;               // User-visible ID (e.g., "TCK01-000123")

  // Document Classification
  documentType?: DocumentType;      // Type of transaction
  seriesId?: string;                // Reference to DocumentSeries
  seriesNumber?: number;            // Number within the series

  // Transaction Data
  date: string;
  items: CartItem[];
  total: number;
  payments: any[];

  // User & Terminal
  userId: string;
  userName: string;
  terminalId?: string;

  // Status
  status: 'COMPLETED' | 'REFUNDED' | 'PARTIAL_REFUND';

  // Customer
  customerId?: string;
  customerName?: string;
  customerSnapshot?: {
    name: string;
    taxId?: string;
    address?: string;
    phone?: string;
    email?: string;
  };

  // Accounting
  taxAmount?: number;               // Total tax amount
  netAmount?: number;               // Net amount (before tax)
  discountAmount?: number;
  isTaxIncluded?: boolean;

  // Fiscal
  ncf?: string;                     // NCF final del documento
  ncfType?: NCFType;

  // Relationships
  relatedTransactions?: string[];   // Related transaction IDs
  originalTransactionId?: string;   // For refunds/voids
  refundReason?: string;
  syncStatus?: SyncStatus;
  syncError?: string;
  zReportId?: string; // ID of the Z-Report that closed this transaction
}

export type ViewState =
  // Standard views
  | 'SETUP'
  | 'WIZARD'
  | 'LOGIN'
  | 'POS'
  | 'SETTINGS'
  | 'SETTINGS_SYNC'
  | 'CUSTOMERS'
  | 'HISTORY'
  | 'FINANCE'
  | 'Z_REPORT'
  | 'SUPPLY_CHAIN'
  | 'FRANCHISE_DASHBOARD'
  | 'DEVICE_UNAUTHORIZED'
  // Kiosk / Self-Checkout views
  | 'KIOSK_WELCOME'
  | 'KIOSK_BROWSER'
  | 'KIOSK_CART'
  | 'KIOSK_PAYMENT'
  // Price Checker views
  | 'CHECKER_SCAN'
  // Handheld Inventory views
  | 'INVENTORY_HOME'
  | 'INVENTORY_COUNT'
  | 'INVENTORY_RECEPTION'
  | 'INVENTORY_LABELS'
  // Kitchen Display views
  | 'KITCHEN_ORDERS';

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

export type PromotionType = 'DISCOUNT' | 'BOGO' | 'HAPPY_HOUR' | 'CONDITIONAL_TARGET' | 'BUNDLE';
export type PromotionTargetType = 'ALL' | 'PRODUCT' | 'CATEGORY' | 'GROUP' | 'SEASON';
export type PromotionBenefitType = 'DISCOUNT_PERCENT' | 'FIXED_PRICE' | 'CASHBACK' | 'POINTS_MULTIPLIER';

export interface PromotionCondition {
  type: 'HAS_WALLET' | 'CUSTOMER_TIER' | 'HAS_POINTS_MIN';
  value: string; // "GOLD", "100", "TRUE"
}

export interface Promotion {
  id: string;
  name: string;
  type: PromotionType;
  priority: number;

  // Trigger
  trigger?: {
    type: 'TOTAL_SPEND' | 'ITEM_QTY' | 'MIN_TICKET_AMOUNT';
    value: number;
    excludeCategories?: string[];
    isRecursive?: boolean;
  };

  // Conditions (New)
  conditions?: PromotionCondition[];

  // Target
  targetType: PromotionTargetType;
  targetValue?: string; // ID of Product, Category, Group, Season
  targetStrategy?: {
    mode: 'CHEAPEST_ITEM' | 'MOST_EXPENSIVE_ITEM' | 'SLOW_MOVER' | 'CATEGORY_CHEAPEST';
    filterValue?: string | number; // Category ID or Days threshold
    tieBreaker?: 'FIRST_ADDED' | 'LAST_ADDED';
    allowSelfTrigger?: boolean;
  };

  // Benefit
  benefitType?: PromotionBenefitType; // Optional for backward compatibility, defaults to DISCOUNT implied by type
  benefitValue: number; // % or Fixed Amount or Multiplier

  // Schedule & Scope
  schedule: {
    days: string[]; // L, M, X, J, V, S, D
    startTime: string;
    endTime: string;
    isActive: boolean;
  };
  terminalIds?: string[];

  stats?: {
    usageCount: number;
    revenueGenerated: number;
    conversionRate: number;
  };
}

export interface PromotionRecommendation {
  type: 'TIMING' | 'DISCOUNT_DEPTH' | 'TARGET' | 'TERMINAL';
  message: string;
  confidence: number;
  suggestedAction?: () => void;
}

export interface CashMovement {
  id: string;
  type: 'IN' | 'OUT';
  amount: number;
  reason: string;
  timestamp: string;
  userId: string;
  userName: string;
  currencyCode?: string; // For multi-currency support, defaults to base currency
  syncStatus?: SyncStatus;
  syncError?: string;
}

export interface Supplier {
  id: string;
  name: string;
  taxId: string; // RNC o Cédula
  email: string;
  phone: string;
  contactPerson: string;
  paymentTermDays: number;
  isActive: boolean;
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
  dueDate?: string; // Derived from supplier.paymentTermDays
  status: 'ORDERED' | 'PARTIAL' | 'COMPLETED';
  items: PurchaseOrderItem[];
  totalCost: number;
  sentAt?: string; // For email tracking
}

export interface Reception {
  id: string;
  purchaseOrderId: string;
  date: string;
  receivedBy: string;
  receivedByUserName: string;
  items: PurchaseOrderItem[];
  terminalId?: string;
  syncStatus?: SyncStatus;
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

// --- EXTERNAL COUPONS ---

export interface Campaign {
  id: string;
  name: string;
  description?: string;
  benefitType: 'PERCENT' | 'FIXED_AMOUNT' | 'FREE_ITEM';
  benefitValue: number;
  minPurchaseAmount?: number;
  maxDiscountAmount?: number;
  activeDays?: string[]; // ['L', 'M', 'X', 'J', 'V', 'S', 'D']
  activeHours?: { start: string; end: string };
  startDate: string;
  endDate: string;
  totalGenerated: number;
  createdAt: string;
}

export interface Coupon {
  id: string;
  campaignId: string;
  code: string;
  status: 'GENERATED' | 'ASSIGNED' | 'REDEEMED' | 'EXPIRED';
  assignedTo?: string;
  redeemedAt?: string;
  ticketRef?: string;
  terminalId?: string;
  createdAt: string;
}



// --- SUPERVISOR INTERVENTION ---

export type Permission =
  | 'ALL'
  // --- POS CORE ---
  | 'SALE'
  | 'POS_VOID_ITEM'
  | 'POS_VOID_TICKET'
  | 'POS_VOID_PAID_TICKET'
  | 'POS_DISCOUNT'
  | 'POS_PRICE_OVERRIDE'
  | 'POS_OPEN_DRAWER'
  | 'POS_RETURNS'
  | 'POS_REPRINT_RECEIPT'
  | 'POS_CLOSE_Z'
  | 'POS_VIEW_ACTIVE_CASH'
  | 'POS_MANAGE_PARKED'

  // --- CATALOG ---
  | 'CATALOG_VIEW'
  | 'CATALOG_MANAGE'
  | 'CATALOG_VIEW_COST'
  | 'TARIFF_MANAGE'

  // --- INVENTORY ---
  | 'INVENTORY_VIEW'
  | 'INVENTORY_ADJUST'
  | 'INVENTORY_TRANSFER'
  | 'SUPPLY_CHAIN_ORDER'
  | 'SUPPLY_CHAIN_RECEIVE'

  // --- CUSTOMERS ---
  | 'CUSTOMER_VIEW'
  | 'CUSTOMER_MANAGE'
  | 'CUSTOMER_CREDIT_LIMIT'
  | 'CUSTOMER_VIEW_DEBT'

  // --- FINANCE & REPORTS ---
  | 'REPORTS_VIEW_SALES'
  | 'REPORTS_VIEW_FINANCIAL'
  | 'EXPENSE_MANAGE'

  // --- ADMIN & SETTINGS ---
  | 'SETTINGS_ACCESS'
  | 'SETTINGS_HARDWARE'
  | 'SETTINGS_USERS'
  | 'SETTINGS_TAXES'
  | 'AUDIT_LOG_VIEW';



export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actionType: Permission;
  cashierId: string;
  supervisorId: string;
  terminalId: string;
  ticketId?: string;
  itemId?: string;
  originalValue?: number;
  newValue?: number;
  reason?: string;
  hash: string;
}

// --- LOYALTY & WALLET TYPES ---

export type WalletTransactionType = 'DEPOSIT' | 'PAYMENT' | 'REFUND' | 'CASHBACK';

export interface WalletTransaction {
  id: string;
  walletId: string;
  type: WalletTransactionType;
  amount: number;
  referenceId?: string; // Ticket ID or External Ref
  timestamp: string;
}

export interface Wallet {
  id: string;
  customerId: string;
  balance: number;
  currency: string;
  status: 'ACTIVE' | 'BLOCKED';
  lastActivity: string;
  transactions: WalletTransaction[];
  pushToken?: string;
}

export type LoyaltyTransactionType = 'EARN' | 'REDEEM' | 'ADJUSTMENT';

export interface LoyaltyTransaction {
  id: string;
  cardId: string;
  type: LoyaltyTransactionType;
  points: number;
  referenceId?: string;
  timestamp: string;
}

export interface LoyaltyCard {
  id: string;
  customerId: string;
  type: 'LOYALTY' | 'GIFT';
  cardNumber: string; // Barcode/QR
  pointsBalance: number;
  status: 'ACTIVE' | 'LOST';
  issuedAt: string;
  history: LoyaltyTransaction[];
}
// --- Z-REPORT HISTORY ---
export interface ZReportStats {
  averageTicket: number;
  itemsPerSale: number;
  peakHour: string; // e.g., "14:00 - 15:00"
  topProduct: {
    name: string;
    quantity: number;
    total: number;
  } | null;
  returnsCount: number;
  returnsTotal: number;
  discountsTotal: number; // New: Total discounts given
}

export type ZReportModule = 'FINANCIAL' | 'PAYMENTS' | 'CASH_DETAILS' | 'KPIS' | 'AUDIT';

export interface ZReport {
  id: string;
  terminalId: string;
  sequenceNumber: string; // e.g., Z-0001
  openedAt: string; // Timestamp of first transaction/movement since last Z
  closedAt: string;
  closedByUserId: string;
  closedByUserName: string;

  // Financials
  baseCurrency: string;
  totalsByMethod: Record<string, number>; // CASH, CARD, etc.

  // Cash Details (Multi-currency)
  cashExpected: Record<string, number>;
  cashCounted: Record<string, number>;
  cashDiscrepancy: Record<string, number>;

  // Movements
  cashSales: number;
  cashIn: number;
  cashOut: number;

  // Metadata
  transactionCount: number;
  notes: string;

  // Analytics
  stats?: ZReportStats;
  syncStatus?: SyncStatus;
  syncError?: string;
}
