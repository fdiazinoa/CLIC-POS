import assert from 'node:assert/strict';
import test from 'node:test';

import type { BusinessConfig, CartItem, Promotion } from '../types';
import { applyPromotions } from '../utils/promotionEngine';

const promotion = (overrides: Partial<Promotion> = {}): Promotion => ({
  id: 'promo-variant-1',
  name: '20% variantes seleccionadas',
  type: 'DISCOUNT',
  priority: 10,
  targetType: 'VARIANT',
  targetValue: 'parent-1',
  targetRefs: ['SKU-RED-M', 'variant-blue-l', '7460001234567'],
  targetLabel: 'Camiseta / Roja M, Azul L',
  benefitValue: 20,
  schedule: {
    days: ['L', 'M', 'X', 'J', 'V', 'S', 'D'],
    startTime: '00:00',
    endTime: '23:59',
    isActive: true,
  },
  ...overrides,
});

const config = (promotions: Promotion[]): BusinessConfig => ({ promotions } as BusinessConfig);

const line = (overrides: Partial<CartItem> = {}): CartItem => ({
  id: 'parent-1',
  name: 'Camiseta',
  price: 100,
  category: 'Ropa',
  images: [],
  attributes: [],
  variants: [],
  tariffs: [],
  appliedTaxIds: [],
  quantity: 1,
  cartId: 'line-1',
  variantSku: 'SKU-RED-M',
  variantId: 'variant-red-m',
  variantBarcodes: ['7460007654321'],
  ...overrides,
} as CartItem);

test('una variante seleccionada aplica y registra la referencia de match', () => {
  const [result] = applyPromotions([line()], config([promotion()]), 'POS-001');

  assert.equal(result.price, 80);
  assert.equal(result.discountAmount, 20);
  assert.equal(result.promotionTrace?.targetType, 'VARIANT');
  assert.equal(result.promotionTrace?.matchedVariantRef, 'SKU-RED-M');
  assert.equal(result.promotionTrace?.matchedVariantRefType, 'SKU');
});

test('varias variantes seleccionadas aplican dentro del mismo artículo padre', () => {
  const results = applyPromotions([
    line({ cartId: 'red', variantSku: 'SKU-RED-M' }),
    line({ cartId: 'blue', variantSku: 'none', variantId: 'variant-blue-l' }),
  ], config([promotion()]), 'POS-001');

  assert.deepEqual(results.map((item) => item.price), [80, 80]);
  assert.equal(results[1].promotionTrace?.matchedVariantRefType, 'VARIANT_ID');
});

test('otra variante del mismo padre y un producto sin variante no aplican', () => {
  const results = applyPromotions([
    line({ cartId: 'other', variantSku: 'SKU-GREEN-S', variantId: undefined, variantBarcodes: [] }),
    line({ cartId: 'base', variantSku: undefined, variantId: undefined, variantBarcodes: [] }),
  ], config([promotion()]), 'POS-001');

  assert.deepEqual(results.map((item) => item.price), [100, 100]);
  assert.equal(results.some((item) => item.appliedPromotionId), false);
});

test('la misma variante en otro artículo padre no aplica', () => {
  const [result] = applyPromotions([
    line({ id: 'parent-2', barcode: 'parent-1', variantSku: 'SKU-RED-M' }),
  ], config([promotion()]), 'POS-001');

  assert.equal(result.price, 100);
});

test('SKU normaliza mayúsculas y espacios, y barcode funciona como alias', () => {
  const results = applyPromotions([
    line({ cartId: 'sku', variantSku: '  sku - red - m  ', variantId: undefined, variantBarcodes: [] }),
    line({ cartId: 'barcode', variantSku: undefined, variantId: undefined, variantBarcodes: [' 7460001234567 '] }),
  ], config([promotion({ targetRefs: ['SKU-RED-M', '7460001234567'] })]), 'POS-001');

  assert.deepEqual(results.map((item) => item.price), [80, 80]);
  assert.equal(results[1].promotionTrace?.matchedVariantRefType, 'BARCODE');
});

test('promociones PRODUCT existentes conservan su comportamiento', () => {
  const productPromotion = promotion({
    id: 'promo-product-1',
    targetType: 'PRODUCT',
    targetValue: 'parent-1',
    targetRefs: [],
    benefitValue: 10,
  });
  const [result] = applyPromotions([line({ variantSku: undefined })], config([productPromotion]), 'POS-001');

  assert.equal(result.price, 90);
  assert.equal(result.promotionTrace?.targetType, 'PRODUCT');
});

test('un target desconocido se ignora y nunca cae como PRODUCT', () => {
  const unsupported = promotion({ targetType: 'UNSUPPORTED' as Promotion['targetType'] });
  const [result] = applyPromotions([line()], config([unsupported]), 'POS-001');

  assert.equal(result.price, 100);
  assert.equal(result.appliedPromotionId, undefined);
});

test('cantidad, reinserción y recuperación offline recalculan trazabilidad y totales', () => {
  const [initial] = applyPromotions([line()], config([promotion()]), 'POS-001');
  const reopenedLine = JSON.parse(JSON.stringify({ ...initial, quantity: 3 })) as CartItem;
  const [restored] = applyPromotions([reopenedLine], config([promotion()]), 'POS-001');

  assert.equal(restored.price, 80);
  assert.equal(restored.discountAmount, 60);
  assert.equal(restored.price * restored.quantity, 240);
  assert.equal(restored.promotionTrace?.matchedTargetRef, 'SKU-RED-M');

  const [reinserted] = applyPromotions([line({ cartId: 'reinserted', quantity: 1 })], config([promotion()]), 'POS-001');
  assert.equal(reinserted.price, 80);
});
