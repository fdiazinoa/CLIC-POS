import { assertLegacyMasterPullAllowed, usesLargeMasterSyncV3Authority } from './LargeMasterSyncV3Authority';
import type { CloudChannel } from './SyncProfile';

const aliases: Record<string, string> = { items: 'products', products: 'products', taxes: 'taxes',
  priceLists: 'priceLists', price_lists: 'priceLists', productPrices: 'productPrices',
  product_prices: 'productPrices', prices: 'productPrices', productStocks: 'productStocks',
  product_stocks: 'productStocks' };
const wrappers = new Set(['terminal_config', 'terminal', 'config', 'business_config', 'businessConfig',
  'masters', 'resolved', 'catalog', 'pricing', 'inventory', 'snapshot']);

/** Inspect incoming contract containers only, never tax metadata retained in a merged local config. */
export const assertLargeMasterSyncV3IncomingConfigMasters = (
  payload: unknown, channel: CloudChannel, candidateEnabled?: boolean,
): void => {
  if (!usesLargeMasterSyncV3Authority(channel, candidateEnabled)) return;
  const visit = (value: unknown, inventory = false): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    for (const [key, child] of Object.entries(value)) {
      const collection = aliases[key] || (inventory && key === 'balances' ? 'productStocks' : undefined);
      if (collection && (Array.isArray(child) || child && typeof child === 'object' && Object.keys(child).length)) {
        assertLegacyMasterPullAllowed(collection, channel, candidateEnabled);
      }
      if (key === 'catalog_delta' && child && typeof child === 'object' && Object.keys(child).length) {
        assertLegacyMasterPullAllowed('products', channel, candidateEnabled);
      }
      if (key === 'domains' && child && typeof child === 'object' && !Array.isArray(child)) {
        for (const [scope, domain] of Object.entries(child)) visit(domain, scope === 'inventory');
      } else if (wrappers.has(key)) visit(child, inventory || key === 'inventory');
    }
  };
  visit(payload);
};

export const assertLargeMasterSyncV3ConfigWriteDestinations = (
  collections: readonly string[], channel: CloudChannel, candidateEnabled?: boolean,
): void => {
  for (const collection of collections) assertLegacyMasterPullAllowed(collection, channel, candidateEnabled);
};
