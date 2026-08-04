import type { BusinessConfig } from '../types';

/**
 * Catálogos operativos que una Caja Cliente debe replicar desde la Master para
 * poder vender, descontar, despachar a producción y cobrar sin depender del ERP.
 * Rooms/tables/parkedTickets viajan por el contrato transaccional de /api/mesas.
 */
export const POS_MASTER_OPERATIONAL_CATALOGS = [
  'products',
  'taxes',
  'customers',
  'suppliers',
  'warehouses',
  'paymentMethods',
  'priceLists',
  'productPrices',
  'categories',
  'productCategories',
  'productGroups',
  'collections',
  'serviceTypes',
  'productionAreas',
  'users',
  'roles',
  'documentSeries',
  'documentTypes',
  'internalSequences',
  'fiscalRanges',
  'fiscalReceiptTypes',
  'fiscalReceipts',
  'fiscalSequences',
  'terminalFiscalConfig',
  'promotions',
  'campaigns',
  'coupons',
  'discountRules',
  'promotionRules',
  'promotionConditions',
  'promotionBenefits',
  'pointsPrograms',
  'loyaltyPrograms',
  'pointsRules',
  'earningRules',
  'redemptionRules',
  'customerPointBalances',
  'loyaltyTiers',
  'productStocks',
  'transfers',
  'receptions',
] as const;

export type PosMasterOperationalCatalog = typeof POS_MASTER_OPERATIONAL_CATALOGS[number];

type CatalogReader = (collection: string) => Promise<unknown>;

const CONFIG_COLLECTION_FALLBACKS: Partial<Record<PosMasterOperationalCatalog, keyof BusinessConfig>> = {
  taxes: 'taxes',
  paymentMethods: 'paymentMethods',
  priceLists: 'tariffs',
  promotions: 'promotions',
};

/** Construye el snapshot LAN combinando estado React vigente y SQLite. */
export const buildPosMasterCatalogSnapshot = async (
  readCollection: CatalogReader,
  liveCatalogs: Partial<Record<PosMasterOperationalCatalog, unknown[]>>,
  config: BusinessConfig,
): Promise<Record<PosMasterOperationalCatalog, unknown[]>> => {
  const entries = await Promise.all(POS_MASTER_OPERATIONAL_CATALOGS.map(async (collection) => {
    const liveValue = liveCatalogs[collection];
    if (Array.isArray(liveValue)) return [collection, liveValue] as const;

    let storedValue: unknown = [];
    try {
      storedValue = await readCollection(collection);
    } catch (error) {
      console.warn(`[MASTER_LAN] No se pudo leer ${collection} desde SQLite:`, error);
    }

    const storedItems = Array.isArray(storedValue) ? storedValue : [];
    if (storedItems.length > 0) return [collection, storedItems] as const;

    const configKey = CONFIG_COLLECTION_FALLBACKS[collection];
    const configValue = configKey ? config[configKey] : undefined;
    return [collection, Array.isArray(configValue) ? configValue : storedItems] as const;
  }));

  return Object.fromEntries(entries) as Record<PosMasterOperationalCatalog, unknown[]>;
};
