/** Effective POS category identity. Accents intentionally follow the existing POS UI. */
export const normalizeV3CategoryKey = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

export interface V3OperationalCategory { key: string; label: string }
export type V3CategoryFilter = string | readonly string[] | null;

/** Only aliases declared by the current POS configuration are equivalent. */
export const resolveV3CategoryAliases = (
  selected: string, aliasToCanonical: ReadonlyMap<string, string>,
): string[] => {
  const key = normalizeV3CategoryKey(selected);
  const canonical = aliasToCanonical.get(key) || key;
  return [...new Set([canonical, ...Array.from(aliasToCanonical)
    .filter(([, value]) => value === canonical).map(([alias]) => alias)])].filter(Boolean);
};
