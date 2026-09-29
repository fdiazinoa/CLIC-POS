import assert from 'node:assert/strict';
import test from 'node:test';

import { buildEscPosTicketPayload } from '../services/printer/EscPosFormatter';
import { buildTicketTaxPresentationHtml } from '../utils/printer';
import {
  buildTransactionCustomerSnapshot,
  calculateTransactionFiscalSummary,
  consolidateTaxBreakdownForDisplay,
  hasAuthoritativeZeroTax,
} from '../utils/fiscalBreakdown';

const taxes = [
  { id: 'legacy-tax-18', name: 'Impuesto', rate: 0.18, type: 'VAT' },
  { id: 'erp-itbis-18', code: 'ITBIS18', name: 'ITBIS', rate: 0.18, type: 'VAT' },
  { id: 'service-18', name: 'Servicio especial', rate: 0.18, type: 'SERVICE_CHARGE' },
] as any;

const duplicatedVatLines = [
  { id: 'legacy-tax-18', name: 'Impuesto', rate: 0.18, amount: 1.8, taxableBase: 10, total: 11.8, lineCount: 1 },
  { id: 'erp-itbis-18', name: 'ITBIS', rate: 0.18, amount: 0.9, taxableBase: 5, total: 5.9, lineCount: 1 },
];

test('consolida IDs equivalentes de ITBIS por tipo fiscal y tasa sin alterar el desglose original', () => {
  const original = structuredClone(duplicatedVatLines);
  const display = consolidateTaxBreakdownForDisplay(duplicatedVatLines, taxes);

  assert.deepEqual(duplicatedVatLines, original);
  assert.equal(display.length, 1);
  assert.equal(display[0].name, 'ITBIS');
  assert.equal(display[0].rate, 0.18);
  assert.equal(display[0].amount, 2.7);
  assert.equal(display[0].taxableBase, 15);
  assert.equal(display[0].lineCount, 2);
});

test('no mezcla impuestos de tipos fiscales distintos aunque compartan la misma tasa', () => {
  const display = consolidateTaxBreakdownForDisplay([
    ...duplicatedVatLines,
    { id: 'service-18', name: 'Servicio especial', rate: 0.18, amount: 2.7, taxableBase: 15, total: 17.7, lineCount: 2 },
  ], taxes);

  assert.equal(display.length, 2);
  assert.deepEqual(display.map((line) => [line.name, line.amount]), [
    ['ITBIS', 2.7],
    ['Servicio especial', 2.7],
  ]);
});

test('el ticket térmico imprime una sola línea ITBIS 18% con el total consolidado', () => {
  const transaction = {
    id: 'tax-display-1',
    displayId: 'TCK-TAX-1',
    date: '2026-09-01T16:45:00.000Z',
    items: [
      { id: 'water-1', cartId: 'water-1', name: 'Agua Dasani', quantity: 1, price: 10, appliedTaxIds: ['legacy-tax-18'] },
      { id: 'water-2', cartId: 'water-2', name: 'Agua absoluta', quantity: 1, price: 5, appliedTaxIds: ['erp-itbis-18'] },
    ],
    subtotal: 15,
    taxAmount: 2.7,
    taxBreakdown: structuredClone(duplicatedVatLines),
    total: 17.7,
    payments: [{ id: 'cash-1', method: 'CASH', amount: 17.7 }],
    userId: 'user-1',
    userName: 'Cajero',
    terminalId: 'terminal-1',
    status: 'COMPLETED',
  } as any;
  const config = {
    companyInfo: { name: 'PANCUVI SRL', rnc: '', phone: '', address: '' },
    currencySymbol: 'RD$',
    receiptConfig: {},
    taxes,
    terminals: [],
  } as any;

  const payload = buildEscPosTicketPayload(transaction, config);
  const decoded = Buffer.from(payload || '', 'base64').toString('latin1');

  assert.equal(decoded.match(/ITBIS 18%/g)?.length, 1);
  assert.match(decoded, /ITBIS 18%\s+RD\$2\.70/);
  assert.doesNotMatch(decoded, /Impuesto 18%/i);
  assert.equal(transaction.taxBreakdown.length, 2);
});

test('una venta exenta persistida omite impuestos sin inferir la exención por B14', () => {
  const config = {
    companyInfo: { name: 'Restaurante Clic Pos', rnc: '', phone: '', address: '' },
    currencySymbol: 'RD$',
    receiptConfig: {},
    taxRate: 0.18,
    taxes,
    terminals: [],
  } as any;
  const baseTransaction = {
    id: 'b14-exempt-1',
    displayId: 'TKT000019',
    documentType: 'TICKET',
    seriesId: 'b14',
    date: '2026-09-29T15:03:00.000Z',
    ncfType: 'B14',
    ncf: 'B1400000006',
    items: [
      { id: 'water-1', cartId: 'water-1', name: 'Agua Purificada', quantity: 1, price: 600, appliedTaxIds: ['erp-itbis-18'] },
    ],
    total: 600,
    payments: [{ id: 'card-1', method: 'CARD', amount: 600 }],
    userId: 'user-1',
    userName: 'Cajero',
    terminalId: 'terminal-1',
    status: 'COMPLETED',
  } as any;
  const exemptTransaction = {
    ...baseTransaction,
    taxAmount: 0,
    taxBreakdown: [],
    customerSnapshot: { name: 'MERCASEND SRL', isTaxExempt: true },
  } as any;

  assert.equal(hasAuthoritativeZeroTax(exemptTransaction), true);
  assert.deepEqual(calculateTransactionFiscalSummary(exemptTransaction, config).taxBreakdown, []);
  assert.equal(calculateTransactionFiscalSummary(exemptTransaction, config).taxTotal, 0);

  const exemptPayload = buildEscPosTicketPayload(exemptTransaction, config);
  const exemptDecoded = Buffer.from(exemptPayload || '', 'base64').toString('latin1');
  assert.doesNotMatch(exemptDecoded, /ITBIS 18%|IMPUESTOS/);

  const incompleteLegacyB14 = { ...baseTransaction } as any;
  assert.equal(hasAuthoritativeZeroTax(incompleteLegacyB14), false);
  assert.equal(calculateTransactionFiscalSummary(incompleteLegacyB14, config).taxTotal, 108);
});

test('un impuesto positivo persistido prevalece sobre un snapshot exento y las líneas cero solo se filtran al presentar', () => {
  const config = {
    taxRate: 0.18,
    taxes,
  } as any;
  const transaction = {
    items: [{ price: 100, quantity: 1, appliedTaxIds: ['erp-itbis-18'] }],
    total: 118,
    taxAmount: 18,
    taxBreakdown: [],
    customerSnapshot: { isTaxExempt: true },
  } as any;
  const zeroLine = { id: 'erp-itbis-18', name: 'ITBIS', rate: 0.18, amount: 0, taxableBase: 0, total: 0, lineCount: 1 };

  assert.equal(hasAuthoritativeZeroTax(transaction), false);
  assert.equal(calculateTransactionFiscalSummary(transaction, config).taxTotal, 18);
  assert.deepEqual(consolidateTaxBreakdownForDisplay([zeroLine], taxes), []);
  assert.equal(zeroLine.amount, 0);

  const positiveLineConflict = {
    ...transaction,
    taxAmount: 0,
    taxBreakdown: [],
    items: [{
      price: 100,
      quantity: 1,
      appliedTaxIds: ['erp-itbis-18'],
      netAmount: 100,
      taxAmount: 18,
      totalAmount: 118,
    }],
  } as any;
  assert.equal(hasAuthoritativeZeroTax(positiveLineConflict), false);
  assert.equal(calculateTransactionFiscalSummary(positiveLineConflict, config).taxTotal, 18);
});

test('líneas históricas fiscales completas conservan autoridad cero en el comprobante RD$600', () => {
  const config = {
    companyInfo: { name: 'Restaurante Clic Pos', rnc: '', phone: '', address: '' },
    currencySymbol: 'RD$',
    receiptConfig: {},
    taxRate: 0.18,
    taxes,
    terminals: [],
  } as any;
  const prices = [210, 150, 130, 110];
  const transaction = {
    id: 'historic-b14-zero-lines',
    displayId: 'TKT000019',
    documentType: 'TICKET',
    seriesId: 'b14',
    date: '2026-09-29T15:03:00.000Z',
    ncfType: 'B14',
    items: prices.map((price, index) => ({
      id: `water-${index}`,
      cartId: `water-${index}`,
      name: `Agua ${index + 1}`,
      quantity: 1,
      price,
      appliedTaxIds: ['erp-itbis-18'],
      netAmount: price,
      taxAmount: 0,
      totalAmount: price,
    })),
    netAmount: 600,
    taxAmount: 0,
    total: 600,
    payments: [{ id: 'card-1', method: 'CARD', amount: 600 }],
    userId: 'user-1',
    userName: 'Cajero',
    terminalId: 'terminal-1',
    status: 'COMPLETED',
  } as any;

  assert.equal(hasAuthoritativeZeroTax(transaction), true);
  assert.equal(calculateTransactionFiscalSummary(transaction, config).taxTotal, 0);

  const htmlTax = buildTicketTaxPresentationHtml(transaction, config);
  assert.deepEqual(htmlTax.itemTaxHtml, ['', '', '', '']);
  assert.equal(htmlTax.totalTaxHtml, '');

  const decoded = Buffer.from(buildEscPosTicketPayload(transaction, config) || '', 'base64').toString('latin1');
  assert.doesNotMatch(decoded, /ITBIS 18%|IMPUESTOS/);

  const inconsistentHistory = {
    ...transaction,
    items: transaction.items.map((item: any, index: number) => (
      index === 0 ? { ...item, totalAmount: item.totalAmount + 1 } : item
    )),
  } as any;
  assert.equal(hasAuthoritativeZeroTax(inconsistentHistory), false);
  assert.equal(calculateTransactionFiscalSummary(inconsistentHistory, config).taxTotal, 108);
});

test('el generador HTML fiscal usado por printTicket distingue comprobantes exentos y gravados', () => {
  const config = {
    companyInfo: { name: 'CLIC POS', rnc: '', phone: '', address: '' },
    currencySymbol: 'RD$',
    receiptConfig: {},
    taxRate: 0.18,
    taxes,
    terminals: [],
  } as any;
  const base = {
    id: 'tax-html', displayId: 'tax-html', documentType: 'TICKET', seriesId: 'ticket',
    date: '2026-09-29T15:03:00.000Z',
    items: [{ id: 'water', cartId: 'water', name: 'Agua', quantity: 1, price: 100, appliedTaxIds: ['erp-itbis-18'] }],
    payments: [], userId: 'user', userName: 'Cajero', terminalId: 'terminal', status: 'COMPLETED',
  } as any;
  const exempt = { ...base, total: 100, netAmount: 100, taxAmount: 0, taxBreakdown: [] } as any;
  const taxed = {
    ...base,
    total: 118,
    netAmount: 100,
    taxAmount: 18,
    taxBreakdown: [{ id: 'erp-itbis-18', name: 'ITBIS', rate: 0.18, amount: 18, taxableBase: 100, total: 118, lineCount: 1 }],
  } as any;

  const exemptHtml = buildTicketTaxPresentationHtml(exempt, config);
  assert.deepEqual(exemptHtml.itemTaxHtml, ['']);
  assert.equal(exemptHtml.totalTaxHtml, '');

  const taxedHtml = buildTicketTaxPresentationHtml(taxed, config);
  assert.match(taxedHtml.itemTaxHtml[0], /ITBIS 18%: RD\$18\.00/);
  assert.match(taxedHtml.totalTaxHtml, /TOTAL IMPUESTOS/);
  assert.match(taxedHtml.totalTaxHtml, /RD\$18\.00/);
});

test('el snapshot fiscal compartido conserva la exención en checkout estándar y split', () => {
  const customer = {
    name: 'MERCASEND SRL',
    taxId: '130090752',
    address: 'Santo Domingo',
    phone: '8090000000',
    email: 'cliente@example.com',
    isTaxExempt: true,
  } as any;

  const standardSnapshot = buildTransactionCustomerSnapshot(customer);
  const splitSnapshot = buildTransactionCustomerSnapshot(customer);
  assert.equal(standardSnapshot.isTaxExempt, true);
  assert.deepEqual(splitSnapshot, standardSnapshot);
});
