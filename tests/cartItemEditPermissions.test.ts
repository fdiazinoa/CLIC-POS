import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  preserveCartItemCommercialFields,
  resolveCartItemEditCapabilities,
} from '../utils/cartItemEditPermissions';

test('el cajero solo puede modificar vendedor y notas desde el lápiz', () => {
  const capabilities = resolveCartItemEditCapabilities([
    'POS_CHECKOUT',
    'POS_REPRINT_RECEIPT',
    'POS_ALLOW_SALES_WITH_OPEN_Z',
  ]);

  assert.deepEqual(capabilities, {
    canApplyDiscount: false,
    canOverridePrice: false,
    canEditQuantity: false,
    canVoidItem: false,
    annotationOnly: true,
  });

  const original: any = {
    cartId: 'line-1',
    productId: 'product-1',
    name: 'Producto',
    quantity: 2,
    price: 100,
    originalPrice: 100,
    discountAmount: 0,
    note: 'Anterior',
    salespersonId: 'seller-1',
  };
  const sanitized = preserveCartItemCommercialFields(original, {
    ...original,
    quantity: 99,
    price: 1,
    originalPrice: 1,
    discountAmount: 198,
    adjustmentSource: 'MANUAL_DISCOUNT',
    note: 'Nueva nota',
    salespersonId: 'seller-2',
  });

  assert.equal(sanitized.quantity, 2);
  assert.equal(sanitized.price, 100);
  assert.equal(sanitized.originalPrice, 100);
  assert.equal(sanitized.discountAmount, 0);
  assert.equal(sanitized.adjustmentSource, undefined);
  assert.equal(sanitized.note, 'Nueva nota');
  assert.equal(sanitized.salespersonId, 'seller-2');
});

test('supervisor y administrador conservan capacidades según sus permisos', () => {
  assert.deepEqual(resolveCartItemEditCapabilities(['POS_VOID_ITEM', 'POS_DISCOUNT']), {
    canApplyDiscount: true,
    canOverridePrice: false,
    canEditQuantity: true,
    canVoidItem: true,
    annotationOnly: false,
  });
  assert.deepEqual(resolveCartItemEditCapabilities(['ALL']), {
    canApplyDiscount: true,
    canOverridePrice: true,
    canEditQuantity: true,
    canVoidItem: true,
    annotationOnly: false,
  });
});

test('una línea bloqueada conserva vendedor y notas pero no operaciones comerciales', () => {
  assert.deepEqual(
    resolveCartItemEditCapabilities(['ALL'], { priceLocked: true, itemDispatched: true }),
    {
      canApplyDiscount: false,
      canOverridePrice: false,
      canEditQuantity: false,
      canVoidItem: false,
      annotationOnly: true,
    },
  );
});

test('el modal oculta controles restringidos y POS sanea la actualización del cajero', () => {
  const modalSource = readFileSync(new URL('../components/CartItemOptionsModal.tsx', import.meta.url), 'utf8');
  const posSource = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');

  assert.match(modalSource, /\{canEditQuantity && \(/);
  assert.match(modalSource, /\{canOverridePrice && \(/);
  assert.match(modalSource, /\{canApplyDiscount && \(/);
  assert.match(modalSource, /\{canVoidItem && <button/);
  assert.match(posSource, /if \(!cartItemEditCapabilities\.annotationOnly\)/);
  assert.match(posSource, /preserveCartItemCommercialFields\(editingItem, updatedItem\)/);
});
