import assert from 'node:assert/strict';
import test from 'node:test';

import type { BusinessConfig, CartItem, Transaction } from '../types';
import { normalizeTransactionForSync } from '../services/sync/sourceIdentity';
import { applyTerminalConfigSnapshot } from '../utils/terminalConfigSnapshot';

const applyPromotionsPayload = (promotions: unknown[]) => applyTerminalConfigSnapshot(
  {} as BusinessConfig,
  {
    terminalId: 'terminal-1',
    incomingSnapshot: {
      resolved: { promotions },
    } as any,
  },
).config.promotions || [];

test('normaliza el payload ERP VARIANT y deduplica aliases equivalentes', () => {
  const promotions = applyPromotionsPayload([{
    id: 'promo-variant-contract',
    name: 'Variantes ERP',
    type: 'DISCOUNT',
    targetType: 'variant',
    targetValue: 'parent-1',
    targetRefs: [' SKU-RED-M ', 'sku-red-m', { variantId: 'variant-red-m' }, { barcodes: ['7460001'] }],
    targetLabel: 'Camiseta / Roja M',
    benefitValue: 15,
    schedule: { isActive: true },
  }]);

  assert.equal(promotions.length, 1);
  assert.equal(promotions[0].targetType, 'VARIANT');
  assert.equal(promotions[0].targetValue, 'parent-1');
  assert.deepEqual(promotions[0].targetRefs, ['SKU-RED-M', 'variant-red-m', '7460001']);
  assert.equal(promotions[0].targetLabel, 'Camiseta / Roja M');
});

test('un target explícito desconocido se descarta en vez de convertirse a PRODUCT', () => {
  const promotions = applyPromotionsPayload([{
    id: 'promo-unsupported',
    name: 'No soportada',
    type: 'DISCOUNT',
    targetType: 'FUTURE_TARGET',
    targetValue: 'parent-1',
    benefitValue: 50,
  }]);

  assert.deepEqual(promotions, []);
});

test('payload PRODUCT sin targetType explícito mantiene compatibilidad histórica', () => {
  const promotions = applyPromotionsPayload([{
    id: 'promo-product-legacy',
    name: 'Producto legado',
    type: 'DISCOUNT',
    targetValue: 'parent-1',
    benefitValue: 10,
  }]);

  assert.equal(promotions[0].targetType, 'PRODUCT');
});

test('sync offline conserva identidad de variante y traza promocional', () => {
  const item = {
    id: 'parent-1',
    cartId: 'line-1',
    name: 'Camiseta',
    category: 'Ropa',
    price: 80,
    originalPrice: 100,
    quantity: 2,
    images: [],
    attributes: [],
    variants: [],
    tariffs: [],
    appliedTaxIds: [],
    adjustmentSource: 'PROMOTION',
    appliedPromotionId: 'promo-variant-contract',
    variantSku: 'SKU-RED-M',
    variantId: 'variant-red-m',
    variantBarcodes: ['7460001'],
    promotionTrace: {
      promotionId: 'promo-variant-contract',
      targetType: 'VARIANT',
      targetValue: 'parent-1',
      matchedVariantRef: 'SKU-RED-M',
      matchedTargetRef: 'SKU-RED-M',
      matchedVariantRefType: 'SKU',
    },
  } as CartItem;
  const normalized = normalizeTransactionForSync({
    id: 'txn-variant-offline',
    items: [item],
    payments: [],
  } as Transaction);

  assert.equal(normalized.items[0].variantId, 'variant-red-m');
  assert.deepEqual(normalized.items[0].variantBarcodes, ['7460001']);
  assert.equal(normalized.items[0].promotionTrace?.targetType, 'VARIANT');
  assert.equal(normalized.items[0].promotionTrace?.matchedVariantRef, 'SKU-RED-M');
  assert.equal(normalized.items[0].discountAmount, 40);
});
