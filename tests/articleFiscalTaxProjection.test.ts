import test from 'node:test';
import assert from 'node:assert/strict';
import type { BusinessConfig, CartItem, Transaction } from '../types';
import { calculateTaxBreakdownFromItems, calculateUncoveredServiceChargeBase, freezeAuthoritativeLineFiscalAmounts } from '../utils/fiscalBreakdown';
import { buildV3FrozenFiscalProviderTransaction } from '../components/v3OperationalUIQueue';

const config = { terminals: [], taxRate: 0, taxes: [
  { id: 'VAT', name: 'ITBIS', rate: 0.18, type: 'VAT' },
  { id: 'SERVICE', name: 'Servicio legal', rate: 0.10, type: 'SERVICE_CHARGE', code: '002' },
], serviceTaxPolicies: { DINE_IN: { taxIds: ['VAT'], legalTip: { enabled: true, percentage: 10 } } } } as BusinessConfig;
const line = (price = 85, included = false, ids = ['VAT', 'SERVICE']) => ({
  id: 'A', cartId: 'L', price, quantity: 1, appliedTaxIds: ids,
  v3SaleAuthority: { taxIncluded: included },
}) as CartItem;

for (const mode of ['RESTAURANT', 'SUPERMARKET']) {
  for (const included of [false, true]) {
    for (const discount of [0, 0.1]) {
      test(`${mode}: assigned VAT and legal service survive policy, included=${included}, discount=${discount}`, () => {
        const business = { ...config, subVertical: mode } as BusinessConfig;
        const raw = line(included ? 108.8 : 85, included);
        const discountAmount = raw.price * discount;
        const net = 85 * (1 - discount);
        const tax = Math.round(net * 0.28 * 100) / 100;
        const total = Math.round((net + tax) * 100) / 100;
        const options = { isTaxIncluded: included, discountAmount, allowedTaxIds: ['VAT'] };
        assert.equal(calculateUncoveredServiceChargeBase([raw], business, options), 0);
        const items = freezeAuthoritativeLineFiscalAmounts([raw], business, { ...options,
          transactionNetAmount: net, transactionTaxAmount: tax, transactionTotal: total });
        const tx = { items, terminalId: 'T', netAmount: net, taxAmount: tax, total, discountAmount,
          customerSnapshot: { isTaxExempt: false }, serviceTaxPolicySnapshot: { taxIds: ['VAT'] } } as Transaction;
        const projection = buildV3FrozenFiscalProviderTransaction(tx, business);
        assert.strictEqual(projection.items, items);
        assert.equal(projection.total, total);
        assert.deepEqual(projection.taxBreakdown?.map(row => [row.type, row.rate, row.amount, row.fiscalAdditionalTaxCode]),
          [['VAT', 0.18, Math.round(net * 0.18 * 100) / 100, undefined],
            ['SERVICE_CHARGE', 0.1, Math.round(net * 0.1 * 100) / 100, '001']]);
      });
    }
  }
}

test('historical 18-only frozen amount with 18+10 IDs rejects without inventing or rewriting', () => {
  const tx = { items: [{ ...line(), netAmount: 85, taxAmount: 15.3, totalAmount: 100.3 }],
    taxAmount: 15.3, total: 100.3, netAmount: 85 } as Transaction;
  const before = JSON.stringify(tx);
  assert.throws(() => buildV3FrozenFiscalProviderTransaction(tx, config), /FROZEN_FISCAL_TAX_MISMATCH/);
  assert.equal(JSON.stringify(tx), before);
});

test('mixed basket header tip applies only uncovered net discounted lines', () => {
  const items = [line(), line(100.3, true, ['VAT'])];
  // A tariff applies consistently to this basket.
  items[0].price = 108.8;
  assert.equal(calculateUncoveredServiceChargeBase(items, config, { isTaxIncluded: true, discountAmount: 20.91 }), 76.5);
});

test('customer exemption and taxable=false preserve zero configured taxes', () => {
  assert.deepEqual(calculateTaxBreakdownFromItems([line()], config, { taxExempt: true }), []);
  assert.deepEqual(calculateTaxBreakdownFromItems([{ ...line(), taxable: false }], config), []);
});

test('unknown IDs fail clearly; legacy defaults remain policy-filtered', () => {
  assert.throws(() => calculateTaxBreakdownFromItems([line(85, false, ['missing'])], config), /FISCAL_ARTICLE_TAX_NOT_FOUND/);
  const legacy = { price: 85, quantity: 1 };
  const rows = calculateTaxBreakdownFromItems([legacy], config, {
    terminalConfig: { operational: { defaultTaxIds: ['VAT', 'SERVICE'] } } as any, allowedTaxIds: ['VAT'] });
  assert.deepEqual(rows.map(row => row.id), ['VAT']);
});

test('VAT10 and OTHER do not acquire legal-service classification from rates or internal codes', () => {
  const business = { ...config, taxes: [{ id: 'X', name: 'Propina legal', type: 'VAT', rate: 0.1, code: '001' }] } as BusinessConfig;
  assert.equal(calculateTaxBreakdownFromItems([line(85, false, ['X'])], business)[0].fiscalAdditionalTaxCode, undefined);
  const unsupported = { ...business, taxes: [{ ...business.taxes[0], type: 'OTHER' }] } as BusinessConfig;
  const tx = { items: [{ ...line(85, false, ['X']), netAmount: 85, taxAmount: 8.5, totalAmount: 93.5 }],
    netAmount: 85, taxAmount: 8.5, total: 93.5 } as Transaction;
  assert.throws(() => buildV3FrozenFiscalProviderTransaction(tx, unsupported), /CLASSIFICATION_REQUIRED/);
});

test('signed E34 projection preserves stored refund and signed typed taxes', () => {
  const tx = { documentType: 'REFUND', items: [{ ...line(), quantity: -1, netAmount: -85, taxAmount: -23.8, totalAmount: -108.8 }],
    netAmount: -85, taxAmount: -23.8, total: -108.8 } as Transaction;
  const projection = buildV3FrozenFiscalProviderTransaction(tx, config);
  assert.deepEqual(projection.taxBreakdown?.map(row => [row.amount, row.taxableBase]), [[-15.3, -85], [-8.5, -85]]);
  assert.strictEqual(projection.items, tx.items);
});

test('mixed assigned service and uncovered header tip retain exact frozen NET and all taxes', () => {
  const raw = [line(), { ...line(85, false, ['VAT']), id: 'B', cartId: 'M' }];
  const headerTip = calculateUncoveredServiceChargeBase(raw, config) * 0.1;
  assert.equal(headerTip, 8.5);
  const tx = { items: freezeAuthoritativeLineFiscalAmounts(raw, config, {
    transactionNetAmount: 178.5, transactionTaxAmount: 39.1, transactionTotal: 217.6 }),
    netAmount: 178.5, taxAmount: 39.1, total: 217.6, serviceChargeAmount: headerTip } as Transaction;
  const projected = buildV3FrozenFiscalProviderTransaction(tx, config);
  assert.equal(projected.netAmount, 178.5);
  assert.equal(projected.serviceChargeAmount, 8.5);
  assert.deepEqual(projected.taxBreakdown?.map(row => [row.type, row.amount, row.taxableBase]),
    [['VAT', 30.6, 170], ['SERVICE_CHARGE', 8.5, 85]]);
});

test('future included-price header tip uses net base, existing frozen record remains untouched', () => {
  const raw = line(118, true, ['VAT']);
  const tip = calculateUncoveredServiceChargeBase([raw], config, { isTaxIncluded: true }) * 0.1;
  assert.equal(tip, 10);
  assert.equal(118 + tip, 128);
});
