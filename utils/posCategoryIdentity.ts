import type { ClassificationItem } from '../types';
export const categoryIdentityKey = (value: unknown): string => typeof value === 'string' ? value.trim().toLowerCase() : '';
/** Resolve label-only setup metadata against this bound session, never by a foreign display label. */
export function reconcileBoundV3PosCategories(
  categories: readonly Partial<ClassificationItem>[],
  boundCategories: readonly { key: string; label: string }[] = [],
): readonly Partial<ClassificationItem>[] {
  const keysByLabel = new Map<string, Set<string>>();
  const labelsByKey = new Map<string, Set<string>>();
  const configuredAliasOwners = new Map<string, Set<number>>();
  const configuredIdOwners = new Map<string, Set<number>>();
  for (const [index, category] of categories.entries()) {
    for (const [value, owners] of [[category.id, configuredIdOwners],
      ...[category.id, category.code, category.name].map(value => [value, configuredAliasOwners] as const)] as const) {
      const key = categoryIdentityKey(value);
      if (!key) continue;
      if (!owners.has(key)) owners.set(key, new Set());
      owners.get(key)!.add(index);
    }
  }
  for (const category of boundCategories) {
    const key = categoryIdentityKey(category.key);
    const label = categoryIdentityKey(category.label);
    if (!key || !label) continue;
    if (!keysByLabel.has(label)) keysByLabel.set(label, new Set());
    if (!labelsByKey.has(key)) labelsByKey.set(key, new Set());
    keysByLabel.get(label)!.add(key);
    labelsByKey.get(key)!.add(label);
  }
  return categories.map((category, index) => {
    const id = categoryIdentityKey(category.id);
    const label = categoryIdentityKey(category.name);
    if (!id || id !== label) return category;
    const candidates = keysByLabel.get(label);
    if (candidates?.size !== 1) return category;
    const key = [...candidates][0];
    if (labelsByKey.get(key)?.size !== 1) return category;
    const aliases = new Set([category.id, category.code, category.name].map(categoryIdentityKey).filter(Boolean));
    // Neither another configured identity nor a contradictory alias can be overwritten.
    const idOwners = configuredIdOwners.get(key);
    const conflict = (idOwners?.size || 0) > (idOwners?.has(index) ? 1 : 0) ||
      [...aliases].some(alias => (configuredAliasOwners.get(alias)?.size || 0) > 1);
    return conflict ? category : { ...category, id: key };
  });
}
/** Scope-local aliases are fail closed when labels/codes collide. Explicit IDs always win. */
export function buildPosCategoryIdentity(categories: readonly Partial<ClassificationItem>[], families: readonly Partial<ClassificationItem>[] = []) {
  const aliasToCanonical = new Map<string, string>();
  const canonicalToCategory = new Map<string, Partial<ClassificationItem>>();
  const ambiguous = new Set<string>();
  const identities = new Set(categories.map(c => categoryIdentityKey(c.id)).filter(Boolean));
  for (const category of [...categories, ...families]) {
    const isPos = categories.includes(category);
    const canonical = categoryIdentityKey(isPos ? category.id || category.code || category.name : category.name || category.code || category.id);
    if (!canonical || canonicalToCategory.has(canonical)) continue;
    canonicalToCategory.set(canonical, category);
    for (const alias of [category.id, category.code, category.name].map(categoryIdentityKey).filter(Boolean)) {
      if (identities.has(alias) && alias !== canonical) continue;
      const prior = aliasToCanonical.get(alias);
      if (!isPos && prior) continue;
      if (prior && prior !== canonical) { ambiguous.add(alias); aliasToCanonical.delete(alias); }
      else if (!ambiguous.has(alias)) aliasToCanonical.set(alias, canonical);
    }
  }
  // A real category ID cannot be made ambiguous by another category's display label.
  for (const id of identities) aliasToCanonical.set(id, id);
  const canonicalize = (value: unknown) => { const key = categoryIdentityKey(value); return aliasToCanonical.get(key) || key; };
  const productCategory = (product: { posCategoryId?: string; category?: string }) => {
    const id = categoryIdentityKey(product.posCategoryId);
    return id || canonicalize(product.category);
  };
  const selectionFilter = (selected: string, unrestrictedActiveCategoryKeys: readonly string[] = []) => {
    const key = categoryIdentityKey(selected);
    if (ambiguous.has(key) && !identities.has(key)) return { ids: [], aliases: [] };
    const canonical = canonicalize(key);
    return { ids: identities.has(canonical) || unrestrictedActiveCategoryKeys.some(value => categoryIdentityKey(value) === canonical) ? [canonical] : [],
      aliases: [...new Set([canonical, ...Array.from(aliasToCanonical).filter(([, id]) => id === canonical).map(([alias]) => alias)])].filter(Boolean) };
  };
  const isProductAllowed = (product: { posCategoryId?: string; category?: string }, allowed: ReadonlySet<string>) => {
    if (allowed.size === 0) return true; // Preserve explicit unrestricted terminal policy.
    const id = categoryIdentityKey(product.posCategoryId);
    if (id && !identities.has(id)) return false;
    const label = categoryIdentityKey(product.category);
    if (!id && ambiguous.has(label) && !identities.has(label)) return false;
    return allowed.has(productCategory(product));
  };
  return { aliasToCanonical, canonicalToCategory, canonicalize, productCategory, isProductAllowed, selectionFilter };
}
