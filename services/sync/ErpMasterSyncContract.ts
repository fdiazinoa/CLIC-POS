export type ErpMasterDomain =
    | 'catalog'
    | 'inventory'
    | 'prices'
    | 'fiscal'
    | 'terminal_config'
    | 'promotions'
    | 'loyalty'
    | 'purchase_orders'
    | 'transfers';

export type ErpMasterCollectionContract = {
    domain: ErpMasterDomain;
    critical: boolean;
    supported: boolean;
};

/**
 * POS-facing contract for the legacy ERP collection endpoints.
 * CONFIG_PUSH_V2 uses domains and is the primary transport.
 */
export const ERP_MASTER_COLLECTION_CONTRACT: Readonly<Record<string, ErpMasterCollectionContract>> = Object.freeze({
    products: { domain: 'catalog', critical: true, supported: true },
    items: { domain: 'catalog', critical: true, supported: true },
    taxes: { domain: 'fiscal', critical: true, supported: true },
    customers: { domain: 'catalog', critical: false, supported: true },
    suppliers: { domain: 'catalog', critical: false, supported: true },
    warehouses: { domain: 'inventory', critical: true, supported: true },
    paymentMethods: { domain: 'terminal_config', critical: true, supported: true },
    priceLists: { domain: 'prices', critical: false, supported: true },
    productPrices: { domain: 'prices', critical: false, supported: true },
    categories: { domain: 'catalog', critical: true, supported: true },
    collections: { domain: 'catalog', critical: true, supported: true },
    rooms: { domain: 'terminal_config', critical: false, supported: true },
    tables: { domain: 'terminal_config', critical: false, supported: true },
    productionAreas: { domain: 'catalog', critical: false, supported: true },
    documentSeries: { domain: 'fiscal', critical: true, supported: true },
    documentTypes: { domain: 'fiscal', critical: true, supported: true },
    internalSequences: { domain: 'fiscal', critical: true, supported: true },
    fiscalRanges: { domain: 'fiscal', critical: true, supported: true },
    fiscalReceiptTypes: { domain: 'fiscal', critical: true, supported: true },
    fiscalReceipts: { domain: 'fiscal', critical: true, supported: true },
    fiscalSequences: { domain: 'fiscal', critical: true, supported: true },
    terminalFiscalConfig: { domain: 'fiscal', critical: true, supported: true },
    promotions: { domain: 'promotions', critical: false, supported: true },
    campaigns: { domain: 'loyalty', critical: false, supported: true },
    coupons: { domain: 'loyalty', critical: false, supported: true },
    pointsPrograms: { domain: 'loyalty', critical: false, supported: true },
    loyaltyPrograms: { domain: 'loyalty', critical: false, supported: true },
    pointsRules: { domain: 'loyalty', critical: false, supported: true },
    earningRules: { domain: 'loyalty', critical: false, supported: true },
    redemptionRules: { domain: 'loyalty', critical: false, supported: true },

    // Known local/legacy names kept for explicit diagnostics. Domain snapshots
    // may populate them, but the ERP collection API does not expose them.
    productCategories: { domain: 'catalog', critical: true, supported: true },
    productGroups: { domain: 'catalog', critical: true, supported: true },
    serviceTypes: { domain: 'catalog', critical: false, supported: true },
    users: { domain: 'catalog', critical: false, supported: true },
    roles: { domain: 'catalog', critical: false, supported: true },
    productStocks: { domain: 'inventory', critical: false, supported: true },
    supplierProductPrices: { domain: 'prices', critical: false, supported: true },
    discountRules: { domain: 'promotions', critical: false, supported: true },
    promotionRules: { domain: 'promotions', critical: false, supported: true },
    promotionConditions: { domain: 'promotions', critical: false, supported: true },
    promotionBenefits: { domain: 'promotions', critical: false, supported: true },
    customerPointBalances: { domain: 'loyalty', critical: false, supported: true },
    loyaltyTiers: { domain: 'loyalty', critical: false, supported: true },
    purchaseOrders: { domain: 'purchase_orders', critical: false, supported: false },
    transfers: { domain: 'transfers', critical: false, supported: false },
    config: { domain: 'terminal_config', critical: true, supported: false },
});

export const ERP_CONFIG_PUSH_V2_DOMAIN_COLLECTIONS: Readonly<Record<ErpMasterDomain, readonly string[]>> =
    Object.freeze({
        catalog: ['products', 'items', 'customers', 'suppliers', 'users', 'roles', 'categories', 'productCategories', 'productGroups', 'collections', 'serviceTypes', 'productionAreas'],
        inventory: ['warehouses', 'productStocks'],
        prices: ['priceLists', 'productPrices', 'supplierProductPrices'],
        fiscal: ['documentSeries', 'documentTypes', 'fiscalRanges', 'fiscalAllocations', 'fiscalReceiptTypes', 'fiscalReceipts', 'fiscalSequences', 'internalSequences', 'terminalFiscalConfig', 'taxes'],
        terminal_config: ['config', 'paymentMethods', 'rooms', 'tables'],
        promotions: ['promotions', 'discountRules', 'promotionRules', 'promotionConditions', 'promotionBenefits'],
        loyalty: ['campaigns', 'coupons', 'pointsPrograms', 'loyaltyPrograms', 'pointsRules', 'earningRules', 'redemptionRules', 'customerPointBalances', 'loyaltyTiers'],
        purchase_orders: ['purchaseOrders'],
        transfers: ['transfers'],
    });

export const ERP_CONFIG_PUSH_V2_DOMAINS = new Set<ErpMasterDomain>(
    Object.keys(ERP_CONFIG_PUSH_V2_DOMAIN_COLLECTIONS) as ErpMasterDomain[],
);

export const ERP_SUPPORTED_MASTER_COLLECTIONS = new Set(
    Object.entries(ERP_MASTER_COLLECTION_CONTRACT)
        .filter(([, contract]) => contract.supported)
        .map(([collection]) => collection),
);

export const ERP_CRITICAL_MASTER_COLLECTIONS = new Set(
    Object.entries(ERP_MASTER_COLLECTION_CONTRACT)
        .filter(([, contract]) => contract.supported && contract.critical)
        .map(([collection]) => collection),
);

export const isSupportedErpMasterCollection = (collection: string): boolean =>
    ERP_SUPPORTED_MASTER_COLLECTIONS.has(collection);

export const isCriticalErpMasterCollection = (collection: string): boolean =>
    ERP_CRITICAL_MASTER_COLLECTIONS.has(collection);

export const getErpMasterCollectionContract = (collection: string): ErpMasterCollectionContract | null =>
    ERP_MASTER_COLLECTION_CONTRACT[collection] || null;
