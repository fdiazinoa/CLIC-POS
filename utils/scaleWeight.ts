import { formatQuantity } from './quantityPresentation';
import type { CartItem, ScaleWeightUnit, WeightPresentation } from '../types';
import { isValidScaleWeight } from './cartQuantity';

export const KG_PER_LB = 0.45359237;
export const weightUnit = (value: unknown): ScaleWeightUnit | null => {
  if (typeof value !== 'string') return null;
  const unit = value.trim().toLowerCase();
  return ['kg', 'kilogramo'].includes(unit) ? 'kg' : ['lb', 'libra'].includes(unit) ? 'lb' : null;
};
/** Unknown legacy units retain the historical kg interaction without inventing a source conversion. */
export function resolveScaleWeightContract(product: { measurementUnit?: unknown; v3SaleAuthority?: unknown }, configuredUnit: ScaleWeightUnit) {
  const canonical = weightUnit(product.measurementUnit);
  return canonical ? { canonicalUnit: canonical, displayUnit: configuredUnit, capturePresentation: true, allowed: true, legacyFallback: false }
    : { canonicalUnit: 'kg' as const, displayUnit: 'kg' as const, capturePresentation: false,
      allowed: !product.v3SaleAuthority, legacyFallback: !product.v3SaleAuthority };
}

const kilograms = (unit: ScaleWeightUnit): number => {
  if (unit !== 'kg' && unit !== 'lb') throw new Error('Unidad de peso inválida.');
  return unit === 'lb' ? KG_PER_LB : 1;
};
export const convertWeight = (value: number, from: ScaleWeightUnit, to: ScaleWeightUnit): number =>
  kilograms(from) === kilograms(to) ? value : value * kilograms(from) / kilograms(to);
export const convertUnitPrice = (value: number, from: ScaleWeightUnit, to: ScaleWeightUnit): number =>
  kilograms(from) === kilograms(to) ? value : value * kilograms(to) / kilograms(from);
export const createWeightPresentation = (scaleId: string, displayUnit: ScaleWeightUnit,
  canonicalUnit: ScaleWeightUnit): Readonly<WeightPresentation> => Object.freeze({
    scaleId, displayUnit, canonicalUnit, conversionVersion: 1,
  });
export const validWeightPresentation = (snapshot: WeightPresentation | undefined, sourceUnit: unknown): boolean =>
  !snapshot || (snapshot.conversionVersion === 1 && typeof snapshot.scaleId === 'string' && !!snapshot.scaleId
    && (snapshot.displayUnit === 'kg' || snapshot.displayUnit === 'lb')
    && (snapshot.canonicalUnit === 'kg' || snapshot.canonicalUnit === 'lb')
    && snapshot.canonicalUnit === weightUnit(sourceUnit));
export const sameWeightPresentation = (a?: WeightPresentation, b?: WeightPresentation): boolean =>
  JSON.stringify(a || null) === JSON.stringify(b || null);
const checkedSnapshot = (snapshot: WeightPresentation, sourceUnit?: unknown): WeightPresentation => {
  if (!validWeightPresentation(snapshot, sourceUnit === undefined ? snapshot.canonicalUnit : sourceUnit)) throw new Error('Contrato de unidad capturada inválido.');
  return snapshot;
};
export const displayWeightQuantity = (item: Pick<CartItem, 'quantity' | 'weightPresentation'> & { measurementUnit?: unknown }): number =>
  item.weightPresentation ? convertWeight(item.quantity, checkedSnapshot(item.weightPresentation, item.measurementUnit).canonicalUnit, item.weightPresentation.displayUnit) : item.quantity;
export const displayWeightPrice = (item: Pick<CartItem, 'price' | 'weightPresentation'> & { measurementUnit?: unknown }, price = item.price): number =>
  item.weightPresentation ? convertUnitPrice(price, checkedSnapshot(item.weightPresentation, item.measurementUnit).canonicalUnit, item.weightPresentation.displayUnit) : price;
export const canonicalWeightQuantity = (item: Pick<CartItem, 'weightPresentation'> & { measurementUnit?: unknown }, quantity: number): number =>
  item.weightPresentation ? convertWeight(quantity, checkedSnapshot(item.weightPresentation, item.measurementUnit).displayUnit, item.weightPresentation.canonicalUnit) : quantity;
export const canonicalWeightPrice = (item: Pick<CartItem, 'weightPresentation'> & { measurementUnit?: unknown }, price: number): number =>
  item.weightPresentation ? convertUnitPrice(price, checkedSnapshot(item.weightPresentation, item.measurementUnit).displayUnit, item.weightPresentation.canonicalUnit) : price;
export const validCanonicalScaleWeight = (value: number, from: ScaleWeightUnit, canonical: ScaleWeightUnit): boolean =>
  isValidScaleWeight(value) && isValidScaleWeight(convertWeight(value, from, canonical));
export const formatWeightNumber = (value: number): string => Number(value.toPrecision(12)).toString();
export const weightLineLabel = (item: Pick<CartItem, 'quantity' | 'price' | 'weightPresentation'>,
  currency: string, price = item.price, quantityPrecision: number = 3): string => item.weightPresentation
  ? `${formatQuantity(displayWeightQuantity(item), quantityPrecision)} ${item.weightPresentation.displayUnit} x ${currency}${formatWeightNumber(displayWeightPrice(item, price))}/${item.weightPresentation.displayUnit}`
  : `${formatQuantity(item.quantity, quantityPrecision)} x ${currency}${price.toFixed(2)}`;
