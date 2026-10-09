/** Only catalog/price semantics participate; inventory and global snapshot hashes do not. */
export const v3ManifestFingerprint = (manifest: {
  cursor_map?: { items?: unknown; product_prices?: unknown };
  price_version?: unknown; domain_hashes?: { product_prices?: unknown };
}): string | null => {
  const tokens = [manifest.cursor_map?.items, manifest.cursor_map?.product_prices,
    manifest.price_version, manifest.domain_hashes?.product_prices]
    .map(value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() || null : null);
  return tokens.some(Boolean) ? JSON.stringify(tokens) : null;
};

export type V3ManifestCheckpoint = { binding: string; fingerprint: string; syncId: string; syncVersion: number; stockAuthority: string };
export const needsV3ManifestRefresh = (fingerprint: string | null, hint: boolean,
  checkpoint: V3ManifestCheckpoint | null, binding: string, generation: { syncId: string; syncVersion: number; stockAuthority?: string }): boolean =>
  fingerprint ? !checkpoint || checkpoint.binding !== binding || checkpoint.fingerprint !== fingerprint
    || checkpoint.stockAuthority !== generation.stockAuthority || checkpoint.syncId !== generation.syncId || checkpoint.syncVersion !== generation.syncVersion : hint;

export const isV3CatalogHint = (collections: string[], domains: Record<string, unknown>, imageOnly: boolean): boolean => {
  if (imageOnly) return false;
  const hints = [...collections, ...Object.keys(domains)].map(value => value.toLowerCase());
  return hints.length === 0 || hints.some(value => ['catalog', 'items', 'articles', 'products', 'prices',
    'product_prices', 'productprices', 'terminal_config', 'company_config'].includes(value));
};
