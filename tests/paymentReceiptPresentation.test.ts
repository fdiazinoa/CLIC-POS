import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    buildPaymentReceiptPresentation,
    buildPaymentSettlementSummary,
    buildTransactionSettlementFields,
    getPaymentAppliedBaseAmount,
    getPaymentChangeBaseAmount,
} from '../utils/paymentSettlement';
import { assertSalePostedPayload, buildSalePostedPayload } from '../services/sync/SalePostedContract';
import { buildEscPosTicketPayload } from '../services/printer/EscPosFormatter';

const config = {
  companyInfo: { name: 'CLIC POS', rnc: '', phone: '', address: '' },
  currencySymbol: 'RD$',
  receiptConfig: {},
  taxes: [],
  terminals: [],
  currencies: [
    { code: 'DOP', symbol: 'RD$', isBase: true, isEnabled: true },
    { code: 'USD', symbol: 'US$', isBase: false, isEnabled: true },
  ],
} as any;

const present = (payments: any[], total = 849.6) => buildPaymentReceiptPresentation(
  buildPaymentSettlementSummary(payments, total, 'DOP'),
  config,
  'DOP',
  'RD$'
);

test('un efectivo mayor al total muestra solo recibido y cambio', () => {
  const presentation = present([{
    id: 'cash-1',
    method: 'CASH',
    methodLabel: 'Efectivo',
    currencyCode: 'DOP',
    amount: 2_000,
  }]);

  assert.equal(presentation.heading, 'PAGO');
  assert.deepEqual(presentation.groups[0].rows, [{
    label: 'EFECTIVO RECIBIDO',
    value: 'RD$2000.00',
  }]);
  assert.deepEqual(presentation.change, {
    label: 'CAMBIO',
    value: 'RD$1150.40',
    emphasis: true,
  });
});

test('un efectivo exacto evita conceptos innecesarios', () => {
  const presentation = present([{
    id: 'cash-1',
    method: 'CASH',
    methodLabel: 'Efectivo',
    currencyCode: 'DOP',
    amount: 849.6,
  }]);

  assert.deepEqual(presentation.groups[0].rows, [{ label: 'EFECTIVO', value: 'RD$849.60' }]);
  assert.equal(presentation.change, undefined);
});

test('una divisa muestra recibido, equivalente y cambio una sola vez', () => {
  const presentation = present([{
    id: 'cash-usd',
    method: 'CASH',
    methodLabel: 'Efectivo',
    currencyCode: 'USD',
    amount: 1_180,
    amountOriginal: 20,
    exchangeRate: 59,
  }]);

  assert.deepEqual(presentation.groups[0].rows, [
    { label: 'EFECTIVO RECIBIDO', value: 'US$20.00' },
    { label: 'EQUIVALENTE', value: 'RD$1180.00' },
  ]);
  assert.equal(presentation.change?.value, 'RD$330.40');
});

test('un pago mixto distingue tarjeta y efectivo recibido sin total aplicado duplicado', () => {
  const presentation = present([
    { id: 'card-1', method: 'CARD', methodLabel: 'Tarjeta', currencyCode: 'DOP', amount: 300 },
    { id: 'cash-1', method: 'CASH', methodLabel: 'Efectivo', currencyCode: 'DOP', amount: 1_000 },
  ]);

  assert.equal(presentation.heading, 'PAGOS');
  assert.deepEqual(presentation.groups.flatMap(group => group.rows), [
    { label: 'TARJETA', value: 'RD$300.00' },
    { label: 'EFECTIVO RECIBIDO', value: 'RD$1000.00' },
  ]);
  assert.equal(presentation.change?.value, 'RD$450.40');
});

test('un pago pendiente conserva su importe pero no se cuenta como dinero cobrado', () => {
  const fields = buildTransactionSettlementFields([{
    id: 'credit-1',
    method: 'CREDIT',
    methodLabel: 'Pendiente',
    amount: 1_100,
    timestamp: new Date('2026-09-04T15:20:00.000Z'),
  }], 1_100, 'DOP');

  assert.equal(fields.settlementReceivedBase, 0);
  assert.equal(fields.settlementAppliedBase, 0);
  assert.equal(fields.settlementChangeBase, 0);
  assert.equal(fields.payments[0].amount, 1_100);
  assert.equal(getPaymentAppliedBaseAmount(fields.payments[0]), 0);
  assert.equal(getPaymentChangeBaseAmount(fields.payments[0]), 0);

  const presentation = present(fields.payments, 1_100);
  assert.deepEqual(presentation.groups[0].rows, [{ label: 'PENDIENTE', value: 'RD$1100.00' }]);
});

test('efectivo más pendiente cuadra SALE_POSTED sin depender del orden de pagos', () => {
  const fields = buildTransactionSettlementFields([
    { id: 'credit-1', method: 'CREDIT', methodLabel: 'Pendiente', amount: 700, timestamp: new Date('2026-09-04T15:20:00.000Z') },
    { id: 'cash-1', method: 'CASH', methodLabel: 'Efectivo', amount: 400, timestamp: new Date('2026-09-04T15:20:00.000Z') },
  ], 1_100, 'DOP');

  assert.equal(fields.settlementReceivedBase, 400);
  assert.equal(fields.settlementAppliedBase, 400);
  assert.equal(fields.settlementChangeBase, 0);
  assert.equal(getPaymentAppliedBaseAmount(fields.payments[0]), 0);
  assert.equal(getPaymentAppliedBaseAmount(fields.payments[1]), 400);

  const transaction = {
    id: 'TXN-MIXED-PENDING',
    displayId: 'TCK-MIXED-PENDING',
    documentType: 'TICKET',
    status: 'PENDING',
    date: '2026-09-04T15:20:00.000Z',
    total: 1_100,
    netAmount: 1_100,
    taxAmount: 0,
    discountAmount: 0,
    items: [{ id: 'item-1', quantity: 1, price: 1_100, totalAmount: 1_100 }],
    pendingBalance: 700,
    ...fields,
  };

  assert.doesNotThrow(() => assertSalePostedPayload(buildSalePostedPayload(transaction)));
});

test('HTML y ESC/POS comparten la presentación y eliminan los totales duplicados', () => {
  const htmlSource = readFileSync(new URL('../utils/printer.ts', import.meta.url), 'utf8');
  const escPosSource = readFileSync(new URL('../services/printer/EscPosFormatter.ts', import.meta.url), 'utf8');

  for (const source of [htmlSource, escPosSource]) {
    assert.match(source, /buildPaymentReceiptPresentation/);
    assert.doesNotMatch(source, /TOTAL APLICADO/);
    assert.doesNotMatch(source, /TOTAL RECIBIDO/);
  }
});

test('el ticket térmico de un sobrepago imprime un solo recibido y un solo cambio', () => {
  const payload = buildEscPosTicketPayload({
    id: 'sale-overpayment-1',
    displayId: 'TCK-OVERPAYMENT-1',
    date: new Date().toISOString(),
    items: [{ id: 'p1', cartId: 'c1', name: 'Producto', quantity: 1, price: 849.6 }],
    total: 849.6,
    payments: [{
      id: 'cash-1',
      method: 'CASH',
      methodLabel: 'Efectivo',
      currencyCode: 'DOP',
      amount: 2_000,
    }],
    userId: 'u1',
    userName: 'Cajero',
    terminalId: 't1',
    status: 'COMPLETED',
  } as any, config);
  const decoded = Buffer.from(payload || '', 'base64').toString('latin1');

  assert.match(decoded, /PAGO/);
  assert.match(decoded, /EFECTIVO RECIBIDO\s+RD\$2000\.00/);
  assert.match(decoded, /CAMBIO\s+RD\$1150\.40/);
  assert.equal(decoded.match(/EFECTIVO RECIBIDO/g)?.length, 1);
  assert.equal(decoded.match(/CAMBIO/g)?.length, 1);
  assert.doesNotMatch(decoded, /EQUIVALENTE|TOTAL APLICADO|TOTAL RECIBIDO/);
});
