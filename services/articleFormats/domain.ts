import {cloneFormatJSON} from './json';
import Decimal from 'decimal.js';
import type { ArticleFormat, ArticleFormatLine, ArticleFormatsDTO, ArticleFormatSnapshot } from './contract';

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
const MAX_BASE = new D('99999999999.9999');
export class ArticleFormatError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'ArticleFormatError'; }
}
const fail = (code: string): never => { throw new ArticleFormatError(code); };

export function exactDecimal(value: unknown, positive = false): Decimal {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail('ARTICLE_FORMAT_INVALID_DECIMAL');
  const decimal = new D(String(value));
  if (decimal.decimalPlaces() > 4 || decimal.abs().gt(MAX_BASE) || (positive && decimal.lte(0))) {
    return fail('ARTICLE_FORMAT_PRECISION_OR_RANGE');
  }
  return decimal;
}

function exactNumber(value: Decimal): number {
  if (value.decimalPlaces() > 4 || value.abs().gt(MAX_BASE)) return fail('ARTICLE_FORMAT_PRECISION_OR_RANGE');
  const number = value.toNumber();
  if (!new D(String(number)).eq(value)) return fail('ARTICLE_FORMAT_PRECISION_LOSS');
  return number;
}

export function toBaseQuantity(quantity: number, factor: number): number {
  return exactNumber(exactDecimal(quantity).mul(exactDecimal(factor, true)));
}

export function addQuantities(a: number, b: number): number {
  return exactNumber(exactDecimal(a).plus(exactDecimal(b)));
}

/** Cost is already per base unit; it is never multiplied or divided by a sale format. */
export function baseCost(value: number): string {
  if (!Number.isFinite(value) || value < 0) return fail('ARTICLE_FORMAT_INVALID_COST');
  const decimal = new D(String(value));
  if (decimal.decimalPlaces() > 8 || decimal.gt(MAX_BASE)) return fail('ARTICLE_FORMAT_INVALID_COST');
  return decimal.toString();
}

export function availability(stockBase: number, factor: number): number {
  return exactDecimal(stockBase).div(exactDecimal(factor, true)).floor().toNumber();
}

export function formatPrice(format: ArticleFormat, tariffId: string, baseTariffPrice: number): number {
  const override = format.prices.find(price => price.tariffId === tariffId);
  const result = override ? exactDecimal(override.price) : exactDecimal(baseTariffPrice).mul(exactDecimal(format.factor, true));
  if (result.isNegative()) return fail('ARTICLE_FORMAT_INVALID_PRICE');
  return exactNumber(result);
}

export function snapshot(format: ArticleFormatSnapshot): ArticleFormatSnapshot {
  if (format.schemaVersion !== 1 || typeof format.id !== 'string' || !format.id || typeof format.name !== 'string' || !format.name || typeof format.abbreviation !== 'string'
    || !(format.variantId === null || (typeof format.variantId === 'string' && format.variantId.length > 0))
    || !(format.barcode === null || typeof format.barcode === 'string')) return fail('ARTICLE_FORMAT_INVALID_SNAPSHOT');
  exactDecimal(format.factor, true);
  return Object.freeze({ schemaVersion: 1, id: format.id, variantId: format.variantId, name: format.name,
    abbreviation: format.abbreviation, factor: format.factor, barcode: format.barcode });
}

export function saleFormats(dto: ArticleFormatsDTO | undefined, variantId: string | null): ArticleFormat[] {
  return (dto?.formats || []).filter(format => format.variantId === variantId && format.active && format.allow_sale)
    .sort((a, b) => Number(b.default_sale) - Number(a.default_sale) || a.sort_order - b.sort_order || a.id.localeCompare(b.id));
}

export function freezeLine<T extends ArticleFormatLine>(line: T, format: ArticleFormatSnapshot): T & { articleFormat: ArticleFormatSnapshot; baseQuantity: number } {
  return { ...line, articleFormat: snapshot(format), baseQuantity: toBaseQuantity(line.quantity, format.factor) };
}

export function resizeLine<T extends ArticleFormatLine>(line: T, quantity: number): T {
  return line.articleFormat ? freezeLine({ ...line, quantity }, line.articleFormat) : { ...line, quantity };
}

/** Inventory boundary: legacy quantities remain unchanged; never read today's master factor. */
export function inventoryQuantity(line: Pick<ArticleFormatLine, 'quantity' | 'articleFormat' | 'baseQuantity'>): number {
  if (!line.articleFormat) return line.quantity;
  const historical = snapshot(line.articleFormat);
  const expected = toBaseQuantity(line.quantity, historical.factor);
  if (line.baseQuantity !== expected) return fail('ARTICLE_FORMAT_BASE_MISMATCH');
  return expected;
}

export function refundLine<T extends ArticleFormatLine>(original: T, quantity: number, previouslyRefundedBase: number): T {
  if (quantity <= 0) return fail('ARTICLE_FORMAT_INVALID_REFUND');
  const refund = resizeLine(original, quantity);
  const soldBase = inventoryQuantity(original);
  const returnedBase = addQuantities(previouslyRefundedBase, inventoryQuantity(refund));
  if (returnedBase > soldBase) return fail('ARTICLE_FORMAT_REFUND_EXCEEDS_SALE');
  return refund;
}

export function validateDTO(value: ArticleFormatsDTO, allowedTariffIds: readonly string[]): ArticleFormatsDTO {
  if (value.schema_version !== 1 || value.inventory_quantity_unit !== 'BASE' || typeof value.item_id !== 'string' || !value.item_id
    || !Array.isArray(value.formats) || value.formats.length > 200) return fail('ARTICLE_FORMAT_INVALID_DTO');
  const identities = new Set<string>();
  const barcodes = new Set<string>();
  const contexts = new Map<string | null, ArticleFormat[]>();
  for (const format of value.formats) {
    snapshot(format);
    if (format.factor > 99999999999) return fail('ARTICLE_FORMAT_PRECISION_OR_RANGE');
    const key = JSON.stringify([format.variantId, format.id]);
    if (identities.has(key)) return fail('ARTICLE_FORMAT_DUPLICATE_ID');
    identities.add(key);
    for (const flag of ['active', 'is_base', 'default_purchase', 'default_sale', 'allow_purchase', 'allow_sale', 'allow_transfer'] as const) {
      if (typeof format[flag] !== 'boolean') return fail('ARTICLE_FORMAT_INVALID_FLAG');
    }
    if (!Number.isSafeInteger(format.sort_order) || format.sort_order < 0 || !Array.isArray(format.prices)) return fail('ARTICLE_FORMAT_INVALID_DTO');
    if (format.barcode) {
      const digits = format.barcode;
      if (!/^\d{13}$/.test(digits) || (10 - [...digits.slice(0, 12)].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1), 0) % 10) % 10 !== Number(digits[12])) return fail('ARTICLE_FORMAT_INVALID_BARCODE');
      if (barcodes.has(digits)) return fail('ARTICLE_FORMAT_DUPLICATE_BARCODE');
      barcodes.add(digits);
    }
    const tariffIds = new Set<string>();
    for (const price of format.prices) {
      if (!allowedTariffIds.includes(price.tariffId) || tariffIds.has(price.tariffId)) return fail('ARTICLE_FORMAT_UNAUTHORIZED_TARIFF');
      if (exactDecimal(price.price).isNegative()) return fail('ARTICLE_FORMAT_INVALID_PRICE');
      tariffIds.add(price.tariffId);
    }
    contexts.set(format.variantId, [...(contexts.get(format.variantId) || []), format]);
  }
  for (const formats of contexts.values()) {
    if (formats.filter(f => f.is_base && f.active && f.factor === 1).length !== 1 || formats.some(f => f.is_base && f.factor !== 1)) return fail('ARTICLE_FORMAT_INVALID_BASE');
    for (const operation of ['purchase', 'sale'] as const) {
      if (formats.filter(f => f[`default_${operation}`]).length > 1
        || formats.some(f => f[`default_${operation}`] && (!f.active || !f[`allow_${operation}`]))) return fail('ARTICLE_FORMAT_INVALID_DEFAULT');
    }
  }
  return cloneFormatJSON(value);
}

export function resolveFormatBarcode(products: { id: string; article_formats?: ArticleFormatsDTO }[], code: string) {
  const matches = products.flatMap(product => (product.article_formats?.formats || [])
    .filter(format => format.active && format.allow_sale && format.barcode === code)
    .map(format => ({ itemId: product.id, variantId: format.variantId, format })));
  if (matches.length > 1) return fail('ARTICLE_FORMAT_AMBIGUOUS_BARCODE');
  return matches[0] || null;
}
