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
  const canonicalize = (value: unknown) => { const key = categoryIdentityKey(value); return ambiguous.has(key) && !identities.has(key) ? `ambiguous:${key}` : aliasToCanonical.get(key) || key; };
  const productCategory = (product: { posCategoryId?: string; category?: string }) => {
    const id = categoryIdentityKey(product.posCategoryId);
    return id ? identities.has(id) ? id : `unmapped:${id}` : canonicalize(product.category);
  };
  return { aliasToCanonical, canonicalToCategory, canonicalize, productCategory };
}
