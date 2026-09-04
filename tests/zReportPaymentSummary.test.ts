import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { BusinessConfig, Transaction, ZReport } from '../types';
import { buildZReportPaymentMethodSummary, paymentMethodSummaryTotal } from '../utils/zReportPaymentSummary';
import { generateZReportReceipt } from '../services/printer/templates/ZReportReceipt';
import { buildEscPosZReportPayload } from '../services/printer/EscPosFormatter';

const config = {
  companyInfo: { name: 'PANCUVI SRL' },
  currencySymbol: 'RD$',
  currencies: [{ code: 'DOP', symbol: 'RD$', isBase: true }],
  terminals: [],
  paymentMethods: [
    { id: 'cash', name: 'Efectivo', type: 'CASH', isEnabled: true },
    { id: 'card', name: 'Tarjeta', type: 'CARD', isEnabled: true },
    { id: 'pending', name: 'Pendiente', type: 'CREDIT', isEnabled: true },
  ],
} as unknown as BusinessConfig;

const transaction = {
  id: 'sale-pancuvi',
  date: '2026-09-04T15:00:00-04:00',
  documentType: 'SALE',
  ncfType: 'B02',
  total: 26892.80,
  items: [],
  payments: [
    { id: 'p1', method: 'CASH', methodId: 'cash', methodLabel: 'Efectivo', amount: 35774.39, appliedAmount: 13674.81, changeAmount: 22099.58 },
    { id: 'p2', method: 'CARD', methodId: 'card', methodLabel: 'Tarjeta', amount: 4897.71, appliedAmount: 4897.71 },
    { id: 'p3', method: 'CREDIT', methodId: 'pending', methodLabel: 'Pendiente', amount: 8320.28, appliedAmount: 0 },
  ],
} as unknown as Transaction;

test('las formas del cierre usan nombres configurados y montos aplicados, incluido pendiente', () => {
  const summary = buildZReportPaymentMethodSummary([transaction], config);
  assert.deepEqual(summary.map(line => [line.name, line.amount]), [
    ['Efectivo', 13674.81],
    ['Tarjeta', 4897.71],
    ['Pendiente', 8320.28],
  ]);
  assert.equal(paymentMethodSummaryTotal(summary), 26892.80);
});

test('el cierre impreso es conciliable y no muestra recaudado ni códigos técnicos', () => {
  const paymentMethodSummary = buildZReportPaymentMethodSummary([transaction], config);
  const report = {
    id: 'z-pancuvi', terminalId: 'T1', sequenceNumber: 'ZS001000004',
    openedAt: transaction.date, closedAt: transaction.date,
    closedByUserId: 'u1', closedByUserName: 'FARAH', baseCurrency: 'DOP',
    totalsByMethod: { CASH: 13674.81, CARD: 4897.71, CREDIT: 8320.28 },
    paymentMethodSummary,
    cashExpected: { DOP: 16190.21 }, cashCounted: { DOP: 27180 }, cashDiscrepancy: { DOP: 10989.79 },
    cashSales: 13674.81, cashIn: 2515.40, cashOut: 0,
    transactionCount: 123, notes: '',
    stats: { grossSales: 26892.80, returnsTotal: 0, netSales: 26892.80 },
    paymentMethodDeclarations: [{ ...paymentMethodSummary[1], expected: 4897.71, declared: 4897.71, difference: 0 }],
  } as unknown as ZReport;

  const html = generateZReportReceipt(report, [], config);
  const escPos = Buffer.from(buildEscPosZReportPayload(report, [], config)!, 'base64').toString('latin1');
  for (const output of [html, escPos]) {
    assert.doesNotMatch(output, /Recaudado/i);
    assert.match(output, /FORMAS DE PAGO/);
    assert.match(output, /Efectivo/);
    assert.match(output, /Tarjeta/);
    assert.match(output, /Pendiente/);
    assert.match(output, /Total formas de pago/i);
    assert.match(output, /Efectivo en ventas/i);
    assert.match(output, /DECLARACI[ÓO]N(?: DE)? FORMAS DE PAGO/i);
  }
});

test('la terminal permite elegir las formas que se declaran manualmente', () => {
  const source = readFileSync(new URL('../components/TerminalSettings.tsx', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('../components/ZReportDashboard.tsx', import.meta.url), 'utf8');
  assert.match(source, /zReportDeclaredPaymentMethodIds/);
  assert.match(source, /Formas de pago a declarar/);
  assert.match(dashboard, /paymentMethodDeclarations/);
  assert.match(dashboard, /Declara el monto contado de cada forma de pago configurada/);
});
