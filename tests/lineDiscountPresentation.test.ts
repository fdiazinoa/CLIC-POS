import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatLineDiscountPercentage,
  resolveLineDiscountPresentation,
} from '../utils/lineDiscountPresentation';

test('explica RD$13 como 10% de RD$130 y conserva RD$117 como precio final', () => {
  const discount = resolveLineDiscountPresentation({
    originalPrice: 130,
    price: 117,
    quantity: 1,
  });

  assert.equal(discount.hasDiscount, true);
  assert.equal(discount.originalLineTotal, 130);
  assert.equal(discount.discountAmount, 13);
  assert.equal(discount.discountPercentage, 10);
  assert.equal(discount.discountPercentageLabel, '10%');
  assert.equal(discount.finalLineTotal, 117);
});

test('calcula monto total y porcentaje estable para varias unidades', () => {
  const discount = resolveLineDiscountPresentation({
    originalPrice: 100,
    price: 92.5,
    quantity: 2,
  });

  assert.equal(discount.originalLineTotal, 200);
  assert.equal(discount.discountAmount, 15);
  assert.equal(discount.discountPercentageLabel, '7.5%');
  assert.equal(discount.finalLineTotal, 185);
});

test('formatea porcentajes con máximo dos decimales', () => {
  assert.equal(formatLineDiscountPercentage(7.692307), '7.69%');
  assert.equal(formatLineDiscountPercentage(12), '12%');
});

test('no crea descuento cuando no existe precio original mayor', () => {
  const discount = resolveLineDiscountPresentation({ price: 70, quantity: 2 });

  assert.equal(discount.hasDiscount, false);
  assert.equal(discount.discountAmount, 0);
  assert.equal(discount.finalLineTotal, 140);
});
