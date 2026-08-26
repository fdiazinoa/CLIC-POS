import type { Product } from '../types';
import { productReferenceCandidates } from './productReferences';

const normalizeSearchValue = (value: unknown): string => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

const expandSearchValue = (value: unknown): string[] => {
  const normalized = normalizeSearchValue(value);
  if (!normalized) return [];

  // Some Android engines emit UPC-A (12 digits) while ERP catalogs persist
  // the equivalent EAN-13 value with a leading zero, or vice versa.
  if (/^\d{12}$/.test(normalized)) return [normalized, `0${normalized}`];
  if (/^0\d{12}$/.test(normalized)) return [normalized, normalized.slice(1)];
  return [normalized];
};

const getProductSearchValues = (product: Product): string[] => {
  const record = product as Product & Record<string, unknown>;
  const variants = Array.isArray(product.variants) ? product.variants : [];

  return [
    product.name,
    product.category,
    record.internalCode,
    record.reference,
    ...productReferenceCandidates(record),
    ...variants.flatMap(variant => productReferenceCandidates(variant as unknown as Record<string, unknown>)),
  ]
    .flatMap(expandSearchValue)
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
