import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { KG_PER_LB, convertWeight, convertUnitPrice, createWeightPresentation, displayWeightPrice,
  displayWeightQuantity, canonicalWeightQuantity, canonicalWeightPrice, validCanonicalScaleWeight,
  sameWeightPresentation, weightLineLabel, validWeightPresentation } from '../utils/scaleWeight';
import { zebraWeightKg } from '../utils/zebraWeight';
import { validateV3PinnedLineSource } from '../services/sync/LargeMasterSyncV3LineSource';
import { hasV3KilogramContract } from '../utils/weightedProduct';
import { calculateLineFiscalValuesForTransaction } from '../utils/fiscalBreakdown';
import type { CartItem, Product } from '../types';

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);
for (const canonicalUnit of ['kg', 'lb'] as const) for (const displayUnit of ['kg', 'lb'] as const) {
  test(`ERP ${canonicalUnit}, scale ${displayUnit}: native Metric/English and manual preserve mass/amount`, () => {
    const snapshot = createWeightPresentation('scale', displayUnit, canonicalUnit);
    const price = 1;
    for (const response of [{ weight: '0.45359237', weight_mode: 'Metric', status: '6' },
      { weight: '1', weight_mode: 'English', status: '6' }]) {
      const kg = zebraWeightKg(response);
      const quantity = convertWeight(kg, 'kg', canonicalUnit);
      const line = { quantity, price, weightPresentation: snapshot } as CartItem;
      const visibleQty = displayWeightQuantity(line);
      const visiblePrice = displayWeightPrice(line);
      close(visibleQty * visiblePrice, quantity * price);
      close(canonicalWeightQuantity(line, visibleQty), quantity);
      close(canonicalWeightPrice(line, visiblePrice), price);
      assert.equal(validCanonicalScaleWeight(visibleQty, displayUnit, canonicalUnit), true);
      const reopened = JSON.parse(JSON.stringify(line));
      assert.equal(weightLineLabel(reopened, '$'), weightLineLabel(line, '$'));
      assert.equal(sameWeightPresentation(reopened.weightPresentation, snapshot), true);
      const refund = { ...reopened, quantity: -quantity };
      close(displayWeightQuantity(refund), -visibleQty);
    }
  });
}
test('price presentation retains the conversion precision and canonical totals/taxes', () => {
  const line = { id: 'P', cartId: 'L', quantity: 1, price: 1, taxable: true, appliedTaxIds: ['TX'],
    weightPresentation: createWeightPresentation('scale', 'lb', 'kg') } as CartItem;
  assert.equal(displayWeightPrice(line), KG_PER_LB);
  assert.match(weightLineLabel(line, '$'), /0.45359237\/lb/);
  for (const taxIncluded of [true, false]) {
    const config = { taxes: [{ id: 'TX', name: 'ITBIS', type: 'VAT', rate: 0.18 }] } as any;
    const a = calculateLineFiscalValuesForTransaction([line], config, { isTaxIncluded: taxIncluded });
    const legacy = { ...line, weightPresentation: undefined };
    const b = calculateLineFiscalValuesForTransaction([legacy], config, { isTaxIncluded: taxIncluded });
    assert.deepEqual(a, b);
  }
});
test('canonical epsilon rejects display pounds that are too small in canonical kilograms', () => {
  assert.equal(validCanonicalScaleWeight(0.000002, 'lb', 'kg'), false);
  for (const value of [0, NaN, Infinity, -1]) assert.equal(validCanonicalScaleWeight(value, 'kg', 'lb'), false);
  assert.equal(validCanonicalScaleWeight(0.125, 'lb', 'kg'), true);
});
test('snapshot corruption fails closed for display, pinning, restore and merge', () => {
  const presentation = createWeightPresentation('S', 'lb', 'kg');
  assert.equal(Object.isFrozen(presentation), true);
  const product = { id: 'P', type: 'PRODUCT', taxable: true, isInventoriable: true, appliedTaxIds: [],
    measurementUnit: 'Kilogramo', purchaseUnit: 'kg', conversionFactor: 1,
    operationalFlags: { isWeighted: true, integersOnly: false, trackInventory: false }, variants: [] } as unknown as Product;
  const authority = { syncId: 'S', syncVersion: 1, tariffId: 'T', taxIncluded: true, inventoryVersion: 1, inventoryCursor: 'C' };
  const line = { ...product, quantity: 0.25, price: 1, cartId: 'L', weightPresentation: presentation, v3SaleAuthority: authority } as CartItem;
  validateV3PinnedLineSource(line, product, authority);
  for (const patch of [{ displayUnit: 'oz' }, { canonicalUnit: 'lb' }, { conversionVersion: 2 }, { scaleId: '' }]) {
    const snapshot = { ...presentation, ...patch } as any;
    assert.equal(validWeightPresentation(snapshot, product.measurementUnit), false);
    assert.throws(() => validateV3PinnedLineSource({ ...line, weightPresentation: snapshot }, product, authority));
    if (patch.canonicalUnit !== 'lb') assert.throws(() => displayWeightQuantity({ ...line, weightPresentation: snapshot }));
  }
  assert.equal(sameWeightPresentation(presentation, createWeightPresentation('S', 'kg', 'kg')), false);
  const pounds = { ...product, measurementUnit: 'Libra', purchaseUnit: 'lb' };
  assert.equal(hasV3KilogramContract(pounds), true);
  assert.equal(hasV3KilogramContract({ ...pounds, purchaseUnit: 'kg' }), false);
  assert.equal(hasV3KilogramContract({ ...pounds, operationalFlags: { ...pounds.operationalFlags, trackInventory: true } }), false);
});

test('stale default requires explicit modal selection and original price uses captured display unit', () => {
  const modal = readFileSync(new URL('../components/ScaleModal.tsx', import.meta.url), 'utf8');
  assert.match(modal, /useState\(defaultScaleId \|\| ''\)/);
  assert.doesNotMatch(modal, /scales.length === 1 \? scales\[0\].id/);
  const pos = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
  assert.match(pos, /displayWeightPrice\(item, item.originalPrice!\)/);
});
