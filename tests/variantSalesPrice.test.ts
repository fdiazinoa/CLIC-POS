import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProductVariant } from '../types';
import { resolveVariantSalesPrice } from '../utils/variantSalesPrice';

const variant = (price: number): ProductVariant => ({
  sku: 'CAMISA-A-BLANCO-S',
  barcode: [],
  attributeValues: { Color: 'Blanco', Talla: 'S' },
  price,
});

test('una variante con precio cero hereda el precio efectivo mostrado por el POS', () => {
  assert.equal(resolveVariantSalesPrice(variant(0), 850), 850);
});

test('una variante con precio propio positivo conserva ese precio', () => {
  assert.equal(resolveVariantSalesPrice(variant(975), 850), 975);
});

test('una variante sin precio válido no convierte en cero una tarifa activa', () => {
  const withoutPrice = { ...variant(0), price: undefined } as unknown as ProductVariant;
  assert.equal(resolveVariantSalesPrice(withoutPrice, 850), 850);
});

test('sin variante se conserva el precio efectivo del artículo', () => {
  assert.equal(resolveVariantSalesPrice(undefined, 850), 850);
});
