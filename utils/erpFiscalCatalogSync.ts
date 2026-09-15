import type { CartItem, Product, TaxDefinition } from '../types';
import { findTaxByIdentifier } from './taxIdentity';

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};

const normalizeStrings = (value: unknown): string[] => {
  const values = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  return Array.from(new Set(values.flatMap((entry) => {
    if (typeof entry === 'string') return entry.split(',').map((part) => part.trim());
    const record = asRecord(entry);
    const identifier = record.id ?? record.tax_id ?? record.taxId ?? record.code;
    return typeof identifier === 'string' ? [identifier.trim()] : [];
  }).filter(Boolean)));
};

const hasOwn = (value: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined;

export const readAuthoritativeProductTaxIds = (product: unknown): string[] | undefined => {
  const source = asRecord(product);
  const metadata = asRecord(source.metadata);
  const candidates: Array<[UnknownRecord, string]> = [
    [source, 'tax_ids'],
    [source, 'tax_id'],
    [source, 'taxIds'],
    [source, 'taxId'],
    [source, 'appliedTaxIds'],
    [metadata, 'tax_ids'],
    [metadata, 'tax_id'],
    [metadata, 'taxIds'],
    [metadata, 'taxId'],
    [metadata, 'appliedTaxIds'],
  ];
  const explicit = candidates.filter(([owner, key]) => hasOwn(owner, key));
  if (explicit.length === 0) return undefined;
  for (const [owner, key] of explicit) {
    const ids = normalizeStrings(owner[key]);
    if (ids.length > 0) return ids;
  }
  return [];
};

export const applyAuthoritativeProductTaxes = <T extends UnknownRecord>(product: T): T => {
  const taxIds = readAuthoritativeProductTaxIds(product);
  if (taxIds === undefined) return product;
  const explicitlyTaxable = product.taxable === true || product.taxable === 'true' || product.taxable === 1;
  const explicitlyExempt = product.taxable === false || product.taxable === 'false' || product.taxable === 0;
  const taxable = explicitlyExempt ? false : explicitlyTaxable || taxIds.length > 0;
  const authoritativeIds = taxable ? taxIds : [];
  return {
    ...product,
    taxable,
    tax_ids: [...authoritativeIds],
    appliedTaxIds: [...authoritativeIds],
  };
};

export const normalizeErpTaxDefinition = (tax: unknown): TaxDefinition => {
  const source = asRecord(tax);
  const rawRate = Number(source.rate ?? source.tax_rate ?? source.percentage ?? 0);
  const normalizedRate = Number.isFinite(rawRate) && rawRate > 1 ? rawRate / 100 : Math.max(0, rawRate || 0);
  return {
    ...source,
    id: String(source.id ?? source.tax_id ?? '').trim(),
    code: String(source.code ?? source.tax_code ?? '').trim() || undefined,
    name: String(source.name ?? source.description ?? source.code ?? 'Impuesto').trim(),
    rate: normalizedRate,
    type: (String(source.type ?? 'VAT').trim().toUpperCase() || 'VAT') as TaxDefinition['type'],
  } as TaxDefinition;
};

export const resolveProductTaxLog = (
  product: Pick<Product, 'id' | 'sku' | 'name' | 'taxable' | 'appliedTaxIds'>,
  taxes: TaxDefinition[],
  version: number,
) => ({
  product_id: product.id,
  sku: product.sku || null,
  name: product.name,
  taxable: product.taxable === true,
  tax_ids: [...(product.appliedTaxIds || [])],
  resolved_rates: (product.appliedTaxIds || []).map((taxId) => ({
    tax_id: taxId,
    rate: findTaxByIdentifier(taxes, taxId)?.rate ?? null,
  })),
  version,
});

export const reconcileOpenCartFiscalData = (
  cart: CartItem[],
  products: Product[],
): { cart: CartItem[]; updatedSkus: string[] } => {
  const productsById = new Map(products.map((product) => [String(product.id), product]));
  const productsBySku = new Map(products.filter((product) => product.sku).map((product) => [String(product.sku), product]));
  const updatedSkus: string[] = [];
  const nextCart = cart.map((line) => {
    const product = productsById.get(String(line.id)) || (line.sku ? productsBySku.get(String(line.sku)) : undefined);
    if (!product) return line;
    const nextTaxIds = [...(product.appliedTaxIds || [])];
    const currentTaxIds = Array.isArray(line.appliedTaxIds) ? line.appliedTaxIds : [];
    const unchanged = line.taxable === product.taxable
      && currentTaxIds.length === nextTaxIds.length
      && currentTaxIds.every((taxId, index) => taxId === nextTaxIds[index]);
    if (unchanged) return line;
    updatedSkus.push(product.sku || product.id);
    return {
      ...line,
      taxable: product.taxable,
      appliedTaxIds: nextTaxIds,
      tax_ids: nextTaxIds,
    } as CartItem;
  });
  return { cart: nextCart, updatedSkus: Array.from(new Set(updatedSkus)) };
};
