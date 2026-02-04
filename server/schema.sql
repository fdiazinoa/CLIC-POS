-- CLIC-POS SQLite Schema

-- 1. Configuration & Metadata (Key-Value)
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT -- JSON string
);

-- 2. Security & Sync
CREATE TABLE IF NOT EXISTS sync_tokens (
    token TEXT PRIMARY KEY,
    terminalId TEXT NOT NULL,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS connected_terminals (
    terminalId TEXT PRIMARY KEY,
    lastSeen TEXT,
    ip TEXT,
    deviceToken TEXT,
    status TEXT
);

-- 3. Core Entities
CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    permissions TEXT, -- JSON array
    maxDiscountPercent REAL,
    isSystem INTEGER DEFAULT 0,
    zReportConfig TEXT -- JSON object
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    pin TEXT NOT NULL,
    role TEXT,
    roleId TEXT,
    photo TEXT,
    FOREIGN KEY (roleId) REFERENCES roles(id)
);

CREATE TABLE IF NOT EXISTS warehouses (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    type TEXT,
    address TEXT,
    allowPosSale INTEGER DEFAULT 1,
    allowNegativeStock INTEGER DEFAULT 0,
    isMain INTEGER DEFAULT 0,
    storeId TEXT
);

CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    taxId TEXT,
    address TEXT,
    notes TEXT,
    loyaltyPoints REAL DEFAULT 0,
    creditLimit REAL DEFAULT 0,
    currentDebt REAL DEFAULT 0,
    tier TEXT,
    createdAt TEXT,
    totalSpent REAL DEFAULT 0,
    lastVisit TEXT,
    tags TEXT, -- JSON array
    requiresFiscalInvoice INTEGER DEFAULT 0,
    prefersEmail INTEGER DEFAULT 0,
    isTaxExempt INTEGER DEFAULT 0,
    applyChainedTax INTEGER DEFAULT 0,
    addresses TEXT, -- JSON array
    creditDays INTEGER DEFAULT 0,
    defaultNcfType TEXT
);

CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    category TEXT,
    stock REAL DEFAULT 0,
    image TEXT,
    barcode TEXT,
    cost REAL,
    type TEXT,
    images TEXT, -- JSON array
    attributes TEXT, -- JSON array
    variants TEXT, -- JSON array
    tariffs TEXT, -- JSON array
    stockBalances TEXT, -- JSON object (Legacy support)
    activeInWarehouses TEXT, -- JSON array
    appliedTaxIds TEXT, -- JSON array
    minStock REAL,
    warehouseSettings TEXT, -- JSON object
    availableModifiers TEXT, -- JSON array
    description TEXT,
    departmentId TEXT,
    sectionId TEXT,
    familyId TEXT,
    subfamilyId TEXT,
    brandId TEXT,
    operationalFlags TEXT, -- JSON object
    createdAt TEXT,
    updatedAt TEXT
);

-- 4. Inventory & Stocks
CREATE TABLE IF NOT EXISTS product_stocks (
    id TEXT PRIMARY KEY, -- productId + '_' + warehouseId
    productId TEXT NOT NULL,
    warehouseId TEXT NOT NULL,
    quantity REAL DEFAULT 0,
    updatedAt TEXT,
    UNIQUE(productId, warehouseId),
    FOREIGN KEY (productId) REFERENCES products(id),
    FOREIGN KEY (warehouseId) REFERENCES warehouses(id)
);

CREATE TABLE IF NOT EXISTS inventory_ledger (
    id TEXT PRIMARY KEY,
    createdAt TEXT NOT NULL,
    warehouseId TEXT NOT NULL,
    productId TEXT NOT NULL,
    concept TEXT NOT NULL,
    documentRef TEXT,
    qtyIn REAL DEFAULT 0,
    qtyOut REAL DEFAULT 0,
    unitCost REAL DEFAULT 0,
    balanceQty REAL DEFAULT 0,
    balanceAvgCost REAL DEFAULT 0,
    terminalId TEXT,
    syncStatus TEXT DEFAULT 'PENDING',
    syncError TEXT,
    FOREIGN KEY (productId) REFERENCES products(id),
    FOREIGN KEY (warehouseId) REFERENCES warehouses(id)
);

-- 5. Sales & Transactions
CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    globalSequence INTEGER,
    displayId TEXT,
    documentType TEXT,
    seriesId TEXT,
    seriesNumber INTEGER,
    date TEXT NOT NULL,
    items TEXT NOT NULL, -- JSON array (CartItems)
    total REAL NOT NULL,
    payments TEXT, -- JSON array
    userId TEXT,
    userName TEXT,
    terminalId TEXT,
    status TEXT,
    customerId TEXT,
    customerName TEXT,
    customerSnapshot TEXT, -- JSON object
    taxAmount REAL DEFAULT 0,
    netAmount REAL DEFAULT 0,
    discountAmount REAL DEFAULT 0,
    isTaxIncluded INTEGER DEFAULT 0,
    ncf TEXT,
    ncfType TEXT,
    relatedTransactions TEXT, -- JSON array
    originalTransactionId TEXT,
    refundReason TEXT,
    affectedInvoiceNumber TEXT,
    affectedNCF TEXT,
    syncStatus TEXT DEFAULT 'PENDING',
    syncError TEXT
);

CREATE TABLE IF NOT EXISTS transaction_history (
    id TEXT PRIMARY KEY,
    globalSequence INTEGER,
    displayId TEXT,
    documentType TEXT,
    seriesId TEXT,
    seriesNumber INTEGER,
    date TEXT NOT NULL,
    items TEXT NOT NULL, -- JSON array (CartItems)
    total REAL NOT NULL,
    payments TEXT, -- JSON array
    userId TEXT,
    userName TEXT,
    terminalId TEXT,
    status TEXT,
    customerId TEXT,
    customerName TEXT,
    customerSnapshot TEXT, -- JSON object
    taxAmount REAL DEFAULT 0,
    netAmount REAL DEFAULT 0,
    discountAmount REAL DEFAULT 0,
    isTaxIncluded INTEGER DEFAULT 0,
    ncf TEXT,
    ncfType TEXT,
    relatedTransactions TEXT, -- JSON array
    originalTransactionId TEXT,
    refundReason TEXT,
    affectedInvoiceNumber TEXT,
    affectedNCF TEXT,
    syncStatus TEXT DEFAULT 'PENDING',
    syncError TEXT,
    zReportId TEXT
);

-- 6. Other Collections (Flexible)
CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    data TEXT -- JSON object
);

CREATE TABLE IF NOT EXISTS purchase_orders (
    id TEXT PRIMARY KEY,
    data TEXT -- JSON object
);

CREATE TABLE IF NOT EXISTS transfers (
    id TEXT PRIMARY KEY,
    data TEXT -- JSON object
);

CREATE TABLE IF NOT EXISTS z_reports (
    id TEXT PRIMARY KEY,
    openedAt TEXT,
    closedAt TEXT,
    terminalId TEXT,
    userId TEXT,
    userName TEXT,
    openingBalance REAL,
    closingBalance REAL,
    totalSales REAL,
    totalTaxes REAL,
    totalDiscounts REAL,
    totalCash REAL,
    totalCard REAL,
    totalTransfer REAL,
    totalOther REAL,
    sequenceNumber TEXT,
    totalsByMethod TEXT,
    cashExpected TEXT,
    cashCounted TEXT,
    cashDiscrepancy TEXT,
    stats TEXT,
    transactionCount INTEGER,
    notes TEXT,
    baseCurrency TEXT,
    status TEXT,
    syncStatus TEXT DEFAULT 'PENDING',
    syncError TEXT
);

CREATE TABLE IF NOT EXISTS cash_movements (
    id TEXT PRIMARY KEY,
    createdAt TEXT,
    type TEXT,
    amount REAL,
    concept TEXT,
    userId TEXT,
    userName TEXT,
    terminalId TEXT,
    zReportId TEXT,
    syncStatus TEXT DEFAULT 'PENDING',
    syncError TEXT
);

CREATE TABLE IF NOT EXISTS receptions (
    id TEXT PRIMARY KEY,
    data TEXT -- JSON object
);

-- 7. Wallets & Advances
CREATE TABLE IF NOT EXISTS wallets (
    id TEXT PRIMARY KEY,
    customerId TEXT NOT NULL,
    balance REAL DEFAULT 0,
    currency TEXT DEFAULT 'DOP',
    status TEXT DEFAULT 'ACTIVE',
    updatedAt TEXT,
    FOREIGN KEY (customerId) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
    id TEXT PRIMARY KEY,
    walletId TEXT NOT NULL,
    type TEXT NOT NULL, -- 'DEPOSIT', 'PAYMENT', 'REFUND'
    amount REAL NOT NULL,
    referenceId TEXT, -- Transaction displayId
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (walletId) REFERENCES wallets(id)
);

-- Currency Audit Log
CREATE TABLE IF NOT EXISTS currency_audit_logs (
    id TEXT PRIMARY KEY,
    currencyCode TEXT NOT NULL,
    field TEXT NOT NULL, -- 'rate', 'buyRate', 'sellRate', etc.
    oldValue TEXT,
    newValue TEXT,
    changedAt TEXT NOT NULL,
    changedBy TEXT NOT NULL,
    changedByName TEXT NOT NULL,
    terminalId TEXT,
    FOREIGN KEY (changedBy) REFERENCES users(id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_product_stocks_product ON product_stocks(productId);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_product ON inventory_ledger(productId);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_sync ON transactions(syncStatus);
CREATE INDEX IF NOT EXISTS idx_z_reports_terminal ON z_reports(terminalId);
CREATE INDEX IF NOT EXISTS idx_cash_movements_zreport ON cash_movements(zReportId);
CREATE INDEX IF NOT EXISTS idx_currency_audit_currency ON currency_audit_logs(currencyCode);
CREATE INDEX IF NOT EXISTS idx_currency_audit_date ON currency_audit_logs(changedAt);

