import type { ClassificationItem } from '../types';
export const categoryIdentityKey = (value: unknown): string => typeof value === 'string' ? value.trim().toLowerCase() : '';
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
