import assert from 'node:assert/strict';
import test from 'node:test';
import { getInitialConfig } from '../constants';
import { SubVertical, type Customer, type ParkedTicket, type Promotion, type Table } from '../types';
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

test('cliente vivo exento prevalece cuando el snapshot falta o quedó desactualizado', () => {
  const config = getInitialConfig(SubVertical.RESTAURANT);
  config.serviceTaxPolicies = { DINE_IN: { legalTip: { enabled: false, percentage: 0 } } };
  const customer = { id: 'customer-exempt', name: 'Comensal', isTaxExempt: true } as Customer;
  const order = ticket(1, 100);
  order.customerId = customer.id;
  const noSnapshot = buildTableAccountFiscalSummary(order, table, config, config.terminals[0].config, false, config.terminals[0].id, customer);
  assert.equal(noSnapshot.taxTotal, 0);
  assert.equal(noSnapshot.total, 100);
  order.customerSnapshot = { name: customer.name, isTaxExempt: false };
  const staleSnapshot = buildTableAccountFiscalSummary(order, table, config, config.terminals[0].config, false, config.terminals[0].id, customer);
  assert.equal(staleSnapshot.taxTotal, 0);
  assert.equal(staleSnapshot.total, 100);
});

test('cliente vivo no exento reemplaza snapshot exento y promoción sigue base POS', () => {
  const config = getInitialConfig(SubVertical.RESTAURANT);
  config.promotions = [allPromotion()];
  config.serviceTaxPolicies = { DINE_IN: { legalTip: { enabled: false, percentage: 0 } } };
  const customer = { id: 'customer-taxable', name: 'Comensal', isTaxExempt: false } as Customer;
  const order = ticket(1, 100);
  order.customerId = customer.id;
  order.customerSnapshot = { name: customer.name, isTaxExempt: true };
  const fiscal = buildTableAccountFiscalSummary(order, table, config, config.terminals[0].config, false, config.terminals[0].id, customer);
  assert.equal(fiscal.subtotal, 80);
  assert.equal(fiscal.taxTotal, 14.4);
  assert.equal(fiscal.total, 94.4);
  const exempt = buildTableAccountFiscalSummary(order, table, config, config.terminals[0].config, false, config.terminals[0].id, { ...customer, isTaxExempt: true });
  assert.equal(exempt.taxTotal, 0);
  assert.equal(exempt.total, 80);
});

test('matriz POS: promoción → descuento porcentual/fijo → ITBIS → propina, incluido/excluido y cliente vivo', () => {
  const config = getInitialConfig(SubVertical.RESTAURANT);
  config.promotions = [allPromotion()];
  const terminal = config.terminals[0];
  const cases = [
    { name: 'porcentaje excluido con propina', type: 'PERCENT' as const, value: 10, included: false, exempt: false, discount: 8, tax: 12.96, tip: 7.2, total: 92.16 },
    { name: 'fijo incluido con propina', type: 'FIXED' as const, value: 10, included: true, exempt: false, discount: 10, tax: 10.68, tip: 7, total: 77 },
    { name: 'porcentaje excluido cliente exento', type: 'PERCENT' as const, value: 10, included: false, exempt: true, discount: 8, tax: 0, tip: 7.2, total: 79.2 },
  ];
  for (const scenario of cases) {
    const order = ticket(1, 100);
    order.discountType = scenario.type;
    order.discountValue = scenario.value;
    order.discountAmount = 10; // histórico: obsoleto tras aplicar promoción
    order.customerId = 'customer-1';
    order.customerSnapshot = { name: 'Comensal', isTaxExempt: !scenario.exempt };
    const customer = { id: 'customer-1', name: 'Comensal', isTaxExempt: scenario.exempt } as Customer;
    const posCart = applyPromotions(order.items, config, terminal.id, customer);
    const gross = posCart.reduce((sum, line) => sum + line.price * line.quantity, 0);
    const posDiscount = scenario.type === 'PERCENT' ? gross * scenario.value / 100 : Math.min(scenario.value, gross);
    const posTax = scenario.exempt ? 0 : calculateTaxBreakdownFromItems(posCart, config, {
      discountAmount: posDiscount, isTaxIncluded: scenario.included, terminalConfig: terminal.config,
    }).reduce((sum, tax) => sum + tax.amount, 0);
    const posTip = (gross - posDiscount) * 0.10;
    const posTotal = Math.round((gross - posDiscount + (scenario.included ? 0 : posTax) + posTip) * 100) / 100;
    const fiscal = buildTableAccountFiscalSummary(order, table, config, terminal.config, scenario.included, terminal.id, customer);
    assert.equal(fiscal.subtotal, gross, scenario.name);
    assert.equal(fiscal.discountTotal, posDiscount, scenario.name);
    assert.equal(fiscal.taxTotal, scenario.tax, scenario.name);
    assert.equal(fiscal.taxTotal, posTax, scenario.name);
    assert.ok(Math.abs(fiscal.serviceChargeAmount - scenario.tip) < 0.000001, scenario.name);
    assert.equal(fiscal.serviceChargeAmount, posTip, scenario.name);
    assert.equal(fiscal.total, scenario.total, scenario.name);
    assert.equal(fiscal.total, posTotal, scenario.name);
    assert.equal(order.items[0].price, 100, scenario.name);
  }
});

test('matriz de centavos sigue precisión POS hasta el total fiscal final', () => {
  const values = [1.03, 2.37, 5.55, 9.99, 10.03, 10.05, 10.07, 11.11, 19.97, 20.01, 33.33, 99.99];
  for (const [index, price] of values.entries()) {
    const config = getInitialConfig(SubVertical.RESTAURANT);
    if (index % 2 === 0 && price !== 10.03) config.promotions = [allPromotion()];
    const order = ticket(1, price);
    order.items[0].price = price;
    order.discountType = index % 3 === 0 ? 'FIXED' : 'PERCENT';
    order.discountValue = order.discountType === 'FIXED' ? 0.11 : 10;
    order.discountAmount = 0; // no sustituye la regla persistida
    const included = index % 2 === 1;
    const terminal = config.terminals[0];
    const posCart = applyPromotions(order.items, config, terminal.id);
    const gross = posCart.reduce((sum, line) => sum + line.price * line.quantity, 0);
    const discount = order.discountType === 'PERCENT' ? gross * (10 / 100) : Math.min(0.11, gross);
    const tax = calculateTaxBreakdownFromItems(posCart, config, {
      discountAmount: discount, isTaxIncluded: included, terminalConfig: terminal.config,
    }).reduce((sum, line) => sum + line.amount, 0);
    const tip = (gross - discount) * 0.10;
    const posTotal = Math.round((gross - discount + (included ? 0 : tax) + tip + Number.EPSILON) * 100) / 100;
    const fiscal = buildTableAccountFiscalSummary(order, table, config, terminal.config, included, terminal.id);
    assert.equal(fiscal.subtotal, gross, `bruto ${price}`);
    assert.equal(fiscal.discountTotal, discount, `descuento ${price}`);
    assert.equal(fiscal.taxTotal, tax, `ITBIS ${price}`);
    assert.equal(fiscal.serviceChargeAmount, tip, `propina ${price}`);
    assert.equal(fiscal.total, posTotal, `total ${price}`);
    if (price === 10.03) assert.equal(fiscal.total, 11.55);
  }
});

test('cantidad fraccionaria y promoción conservan precisión POS hasta 15.66', () => {
  const config = getInitialConfig(SubVertical.RESTAURANT);
  config.promotions = [allPromotion()];
  const terminal = config.terminals[0];
  const order = ticket(4.295, 0);
  order.items[0].price = 3.75;
  order.discountType = 'PERCENT';
  order.discountValue = 5;
  order.discountAmount = 0.81;
  const posCart = applyPromotions(order.items, config, terminal.id);
  assert.equal(posCart[0].price, 3);
  const gross = posCart.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const discount = gross * (5 / 100);
  const tax = calculateTaxBreakdownFromItems(posCart, config, {
    discountAmount: discount, isTaxIncluded: false, terminalConfig: terminal.config,
  }).reduce((sum, line) => sum + line.amount, 0);
  const tip = (gross - discount) * 0.10;
  const posTotal = Math.round((gross - discount + tax + tip + Number.EPSILON) * 100) / 100;
  const fiscal = buildTableAccountFiscalSummary(order, table, config, terminal.config, false, terminal.id);
  assert.equal(posTotal, 15.66);
  assert.equal(fiscal.subtotal, gross);
  assert.equal(fiscal.discountTotal, discount);
  assert.equal(fiscal.taxTotal, tax);
  assert.equal(fiscal.serviceChargeAmount, tip);
  assert.equal(fiscal.total, posTotal);
});

test('descuento legado sin regla conserva importe guardado', () => {
  const config = getInitialConfig(SubVertical.RESTAURANT);
  config.serviceTaxPolicies = { DINE_IN: { legalTip: { enabled: false, percentage: 0 } } };
  const order = ticket(1, 100);
  order.discountAmount = 10;
  const fiscal = buildTableAccountFiscalSummary(order, table, config, config.terminals[0].config, false);
  assert.equal(fiscal.discountTotal, 10);
  assert.equal(fiscal.total, 106.2);
});
