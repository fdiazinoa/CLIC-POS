import assert from 'node:assert/strict';
import test from 'node:test';
import type { BusinessConfig, TerminalConfig, Transaction, ZReport } from '../types';
import { buildCloseReportDetails, resolveCloseReportSections } from '../utils/closeReportOptions';
import { generateZReportReceipt } from '../services/printer/templates/ZReportReceipt';

const terminalConfig = {
  erpTerminalId: 'erp-t1',
  workflow: {
    session: {
      closeReportOptionsByUser: {
        u1: {
          X: ['SELLER_SUMMARY'],
          Z: ['ITEM_SUMMARY', 'TAX_SUMMARY', 'CURRENCY_BREAKDOWN', 'HOURLY_SALES'],
        },
      },
    },
  },
} as unknown as TerminalConfig;

const config = {
  taxRate: 0.18,
  taxes: [],
  currencies: [{ code: 'DOP', symbol: 'RD$', isBase: true }],
  companyInfo: { name: 'CLIC QA' },
  terminals: [{ id: 'T1', config: terminalConfig }],
} as unknown as BusinessConfig;

const sale = {
  id: 'sale-1',
  date: '2026-08-24T10:15:00-04:00',
  items: [{ id: 'p1', name: 'Camisa', quantity: 2, price: 100, totalAmount: 200 }],
  total: 236,
  payments: [],
  userId: 'u1',
  userName: 'Ana',
  status: 'COMPLETED',
  taxAmount: 36,
  taxBreakdown: [{ id: 'itbis-18', name: 'ITBIS', rate: 0.18, amount: 36, taxableBase: 200, total: 236, lineCount: 1 }],
} as Transaction;

const refund = {
  ...sale,
  id: 'refund-1',
  date: '2026-08-24T11:10:00-04:00',
  documentType: 'REFUND',
  items: [{ id: 'p1', name: 'Camisa', quantity: 1, price: 100, totalAmount: 100 }],
  total: 118,
  userId: 'u2',
  userName: 'Luis',
  taxAmount: 18,
  taxBreakdown: [{ id: 'itbis-18', name: 'ITBIS', rate: 0.18, amount: 18, taxableBase: 100, total: 118, lineCount: 1 }],
} as Transaction;

test('resuelve opciones X y Z de forma independiente por usuario', () => {
  assert.deepEqual(resolveCloseReportSections(config, 'erp-t1', 'u1', 'X'), ['SELLER_SUMMARY']);
  assert.deepEqual(resolveCloseReportSections(config, 'T1', 'u1', 'Z'), [
    'ITEM_SUMMARY',
    'TAX_SUMMARY',
    'CURRENCY_BREAKDOWN',
    'HOURLY_SALES',
  ]);
  assert.deepEqual(resolveCloseReportSections(config, 'T1', 'u2', 'Z'), []);
});

test('calcula anexos de vendedor, artículo, impuestos y ventas por hora', () => {
  const sections = ['SELLER_SUMMARY', 'ITEM_SUMMARY', 'TAX_SUMMARY', 'HOURLY_SALES'] as const;
  const details = buildCloseReportDetails([sale, refund], config, terminalConfig, [...sections]);

  assert.deepEqual(details.sellerSummary, [
    { userId: 'u1', userName: 'Ana', transactionCount: 1, netSales: 236 },
    { userId: 'u2', userName: 'Luis', transactionCount: 1, netSales: -118 },
  ]);
  assert.deepEqual(details.itemSummary, [
    { productId: 'p1', productName: 'Camisa', quantity: 1, netSales: 100 },
  ]);
  assert.deepEqual(details.taxSummary, [
    { taxId: 'itbis-18', taxName: 'ITBIS', rate: 0.18, taxableBase: 100, taxAmount: 18 },
  ]);
  assert.equal(details.hourlySales?.length, 2);
  assert.equal(details.hourlySales?.[0].label, '10:00 - 11:00');
});

test('la plantilla HTML incluye solamente los anexos seleccionados', () => {
  const enabledSections = ['SELLER_SUMMARY', 'CURRENCY_BREAKDOWN'] as const;
  const report = {
    id: 'z1',
    terminalId: 'T1',
    sequenceNumber: 'Z000001',
    openedAt: sale.date,
    closedAt: sale.date,
    closedByUserId: 'u1',
    closedByUserName: 'Ana',
    baseCurrency: 'DOP',
    totalsByMethod: {},
    cashExpected: {},
    cashCounted: {},
    cashDiscrepancy: {},
    cashSales: 0,
    cashIn: 0,
    cashOut: 0,
    transactionCount: 1,
    notes: '',
    enabledSections: [...enabledSections],
    reportDetails: buildCloseReportDetails([sale], config, terminalConfig, [...enabledSections]),
    denominationBreakdown: { DOP: [{ denomination: 100, quantity: 2, total: 200 }] },
  } as ZReport;

  const html = generateZReportReceipt(report, [], config);
  assert.match(html, /RESUMEN X VENDEDOR/);
  assert.match(html, /DESGLOSE DE MONEDA/);
  assert.doesNotMatch(html, /VENTAS X HORA/);
});
