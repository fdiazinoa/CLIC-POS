import assert from 'node:assert/strict';
import test from 'node:test';
import { getInitialConfig } from '../constants';
import { SubVertical, type ParkedTicket, type Promotion, type Table } from '../types';
import { calculateTaxBreakdownFromItems } from '../utils/fiscalBreakdown';
import { buildTableAccountFiscalSummary, getPaymentFractionFiscalDifference } from '../utils/tableAccountFiscalSummary';
import { applyPromotions } from '../utils/promotionEngine';

const table = { id: 'mesa-7', nombre: 'Mesa 7', guests: 2 } as Table;
const ticket = (quantity: number, total: number): ParkedTicket => ({
  id: `split-${quantity}`, name: 'Cuenta dividida', tableId: table.id,
  timestamp: '2026-10-03T19:00:00Z', total,
  items: [{ id: 'p1', cartId: 'line-1', name: 'Producto', price: 100, quantity, appliedTaxIds: ['tax-18'] } as any],
});

test('pre-cuenta de ticket dividido calcula ITBIS y propina como el carrito POS, no usa total obsoleto', () => {
  const config = getInitialConfig(SubVertical.RESTAURANT);
  const split = ticket(2, 200); // split heredado guarda la suma bruta sin impuestos
  const fiscal = buildTableAccountFiscalSummary(split, table, config, config.terminals[0].config, false);
  const posTax = calculateTaxBreakdownFromItems(split.items, config, { terminalConfig: config.terminals[0].config, isTaxIncluded: false });
  assert.equal(fiscal.taxTotal, posTax.reduce((sum, tax) => sum + tax.amount, 0));
  assert.equal(fiscal.taxTotal, 36);
  assert.equal(fiscal.serviceChargeAmount, 20);
  assert.equal(fiscal.total, 256);
  assert.notEqual(fiscal.total, split.total);
});

test('tarifa con impuesto incluido no vuelve a sumar ITBIS al total', () => {
  const config = getInitialConfig(SubVertical.RESTAURANT);
  config.serviceTaxPolicies = { DINE_IN: { legalTip: { enabled: false, percentage: 0 } } };
  const fiscal = buildTableAccountFiscalSummary(ticket(1, 100), table, config, config.terminals[0].config, true);
  assert.equal(fiscal.total, 100);
  assert.ok(fiscal.taxTotal > 0);
  assert.equal(fiscal.netSubtotal + fiscal.taxTotal, 100);
});

test('cliente exento conserva total bruto con tarifa incluida y elimina impuestos', () => {
  const config = getInitialConfig(SubVertical.RESTAURANT);
  config.serviceTaxPolicies = { DINE_IN: { legalTip: { enabled: false, percentage: 0 } } };
  const order = ticket(1, 100);
  order.customerSnapshot = { name: 'Exento', isTaxExempt: true };
  const fiscal = buildTableAccountFiscalSummary(order, table, config, config.terminals[0].config, true);
  assert.equal(fiscal.taxTotal, 0);
  assert.equal(fiscal.netSubtotal, 100);
  assert.equal(fiscal.total, 100);
});

test('muestra ITBIS e Impuesto Ley según impuestos del artículo', () => {
  const config = getInitialConfig(SubVertical.RESTAURANT);
  config.taxes.push({ id: 'law-tax', name: 'Impuesto Ley', rate: 0.02, type: 'OTHER' } as any);
  config.serviceTaxPolicies = { DINE_IN: { legalTip: { enabled: false, percentage: 0 } } };
  const order = ticket(1, 100);
  order.items[0].appliedTaxIds = ['tax-18', 'law-tax'];
  const fiscal = buildTableAccountFiscalSummary(order, table, config, config.terminals[0].config, false);
  assert.deepEqual(fiscal.taxBreakdown.map(tax => tax.name).sort(), ['ITBIS 18%', 'Impuesto Ley']);
  assert.equal(fiscal.total, 120);
});

test('bloquea cuotas que no reconcilian con total fiscal y tolera un centavo', () => {
  const order = ticket(2, 200);
  order.paymentFraction = {
    originalTotal: 200, count: 2, createdAt: '2026-10-03T19:00:00Z',
    parts: [{ index: 1, amount: 100, status: 'PAID' }, { index: 2, amount: 100, status: 'PENDING' }],
  };
  assert.equal(getPaymentFractionFiscalDifference(order, 256), 56);
  assert.equal(getPaymentFractionFiscalDifference(order, 200.01), 0);
  assert.equal(getPaymentFractionFiscalDifference(order, 200.02), 0.02);
});

const allPromotion = (): Promotion => ({
  id: 'promo-all-20', name: '20% de descuento', type: 'DISCOUNT', targetType: 'ALL',
  priority: 10, benefitValue: 20,
} as Promotion);

test('pre-cuenta usa promoción ALL del POS sin modificar la línea estacionada', () => {
  const config = getInitialConfig(SubVertical.RESTAURANT);
  config.promotions = [allPromotion()];
  config.serviceTaxPolicies = { DINE_IN: { legalTip: { enabled: false, percentage: 0 } } };
  const order = ticket(1, 100);
  order.items[0].appliedTaxIds = [];
  const before = JSON.stringify(order.items);
  const fiscal = buildTableAccountFiscalSummary(order, table, config, config.terminals[0].config, false, config.terminals[0].id);
  assert.equal(fiscal.items[0].price, 80);
  assert.equal(fiscal.subtotal, 80);
  assert.equal(fiscal.total, 80);
  assert.equal(JSON.stringify(order.items), before);
});

test('promoción, descuento global e ITBIS coinciden con el carrito procesado del POS', () => {
  const config = getInitialConfig(SubVertical.RESTAURANT);
  config.promotions = [allPromotion()];
  config.serviceTaxPolicies = { DINE_IN: { legalTip: { enabled: false, percentage: 0 } } };
  const order = ticket(1, 100);
  order.discountAmount = 10;
  const processedCart = applyPromotions(order.items, config, config.terminals[0].id);
  const posTax = calculateTaxBreakdownFromItems(processedCart, config, {
    discountAmount: 10, isTaxIncluded: false, terminalConfig: config.terminals[0].config,
  });
  const fiscal = buildTableAccountFiscalSummary(order, table, config, config.terminals[0].config, false, config.terminals[0].id);
  assert.equal(fiscal.subtotal, 80);
  assert.equal(fiscal.discountTotal, 10);
  assert.equal(fiscal.taxTotal, posTax.reduce((sum, tax) => sum + tax.amount, 0));
  assert.equal(fiscal.taxTotal, 12.6);
  assert.equal(fiscal.total, 82.6);
});
