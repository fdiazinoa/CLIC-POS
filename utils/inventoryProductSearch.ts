import type { Product } from '../types';

const normalizeSearchValue = (value: unknown): string => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

const getProductSearchValues = (product: Product): string[] => {
  const record = product as Product & Record<string, unknown>;
  const variants = Array.isArray(product.variants) ? product.variants : [];

  return [
    product.id,
    product.name,
    product.barcode,
    product.category,
    record.sku,
    record.code,
    record.item_code,
    record.internalCode,
    record.reference,
    ...variants.flatMap(variant => [variant.sku, ...(Array.isArray(variant.barcode) ? variant.barcode : [])]),
  ]
    .map(normalizeSearchValue)
    .filter(Boolean);
};

export const findExactInventoryProduct = (
  products: Product[],
  query: string,
): Product | undefined => {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) return undefined;

  return products.find(product => getProductSearchValues(product).some(value => value === normalizedQuery));
};

export const filterInventoryProducts = (
  products: Product[],
  query: string,
  limit = 20,
): Product[] => {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) return [];

  return products
    .map(product => {
      const values = getProductSearchValues(product);
      const exact = values.some(value => value === normalizedQuery);
      const startsWith = values.some(value => value.startsWith(normalizedQuery));
      const includes = values.some(value => value.includes(normalizedQuery));
      const score = exact ? 3 : startsWith ? 2 : includes ? 1 : 0;
      return { product, score };
    })
    .filter(result => result.score > 0)
    .sort((left, right) => right.score - left.score || left.product.name.localeCompare(right.product.name))
    .slice(0, Math.max(1, limit))
    .map(result => result.product);
};
