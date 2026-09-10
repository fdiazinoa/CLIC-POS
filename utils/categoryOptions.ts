export type CategoryOption = { id: string; name: string };

const erpUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const normalizeCategoryOption = (entry: unknown): CategoryOption | null => {
  if (typeof entry === 'string') {
    const name = entry.trim();
    return name ? { id: name, name } : null;
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const record = entry as Record<string, unknown>;
  const name = String(
    record.name ||
    record.nombre ||
    record.label ||
    record.posCategoryName ||
    record.pos_category_name ||
    record.description ||
    record.descripcion ||
    record.code ||
    record.id ||
    ''
  ).trim();
  if (!name) return null;
  const id = String(
    record.id ||
    record.posCategoryId ||
    record.pos_category_id ||
    record.categoryId ||
    record.category_id ||
    record.code ||
    name
  ).trim();
  return { id: id || name, name };
};

export const preferCategoryOptionWithErpIdentity = (
  current: CategoryOption | undefined,
  candidate: CategoryOption,
): CategoryOption => {
  if (!current) return candidate;
  if (!erpUuid.test(current.id) && erpUuid.test(candidate.id)) return candidate;
  return current;
};
