import assert from 'node:assert/strict';
import test from 'node:test';
import type { BusinessConfig, CashMovement, Transaction, ZReport } from '../types';
import { buildPosReportText, filterPosReportSource, localDate, validReportDates, wrapPosReportText } from '../utils/posReports';
import { buildEscPosVoucherPayload } from '../services/printer/EscPosFormatter';

const config = { companyInfo: { name: 'Mi tienda' }, currencies: [{ code: 'DOP', isBase: true }],
  terminals: [{ id: 'local', config: { terminalName: 'Caja 1', erpTerminalId: 'erp' } }], paymentMethods: [],
} as unknown as BusinessConfig;
const filters = { start: '2026-11-17', end: '2026-11-17', terminalId: 'local', productLimit: 10 };
const sale = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: 'sale', date: '2026-11-17T12:00:00', terminalId: 'erp', documentType: 'TICKET', status: 'COMPLETED',
  total: 100, taxAmount: 18, discountAmount: 10, items: [{ id: 'a', name: 'Cafe', quantity: 2, price: 50 }],
  payments: [{ method: 'CASH', amount: 150, appliedAmount: 100, changeAmount: 50, currencyCode: 'DOP' }],
  userId: 'u', userName: 'Cajero', ...overrides,
} as Transaction);
const empty = { transactions: [], movements: [], reports: [] };
const reportText = (kind: Parameters<typeof buildPosReportText>[0], transactions: Transaction[]) => buildPosReportText(kind, { ...empty, transactions }, filters, config);

test('filters local day boundaries, canonical terminal aliases and excludes pending/non-sales', () => {
  const result = filterPosReportSource({ ...empty, transactions: [sale(), sale({ id: 'early', date: '2026-11-17T00:00:00' }), sale({ id: 'late', date: '2026-11-18T00:00:00' }), sale({ id: 'pending', status: 'PENDING' }), sale({ id: 'other', terminalId: 'other' }), sale({ id: 'void', documentType: 'VOID' }), sale({ id: 'stock', documentType: 'TRANSFER' })] }, filters, config);
  assert.deepEqual(result.transactions.map(t => t.id), ['sale', 'early']);
});
test('current transaction supersedes archived copy, never doubles sales', () => {
  const result = filterPosReportSource({ ...empty, transactions: [sale({ total: 80 }), sale()] }, filters, config);
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0].total, 100);
});
test('refunded original remains a sale and separate credit note subtracts exactly once', () => {
  const text = reportText('SALES', [sale({ status: 'REFUNDED' }), sale({ id: 'nc', documentType: 'REFUND', total: -40, taxAmount: -6, items: [], payments: [] })]);
  assert.match(text, /Tickets de venta: 1/);
  assert.match(text, /Venta neta: DOP 60.00/);
  assert.match(text, /Impuestos registrados: DOP 12.00/);
  assert.match(text, /Descuentos globales: DOP 10.00/);
});
test('payment summary excludes cash change and separates tender currencies', () => {
  const text = reportText('PAYMENTS', [sale(), sale({ id: 'usd', payments: [{ method: 'CASH', amount: 600, appliedAmount: 500, currencyCode: 'USD', exchangeRate: 60, amountOriginal: 10 }] })]);
  assert.match(text, /Efectivo \/ DOP\n {2}Aplicado: DOP 100.00/);
  assert.match(text, /Efectivo \/ USD\n {2}Aplicado: DOP 500.00/);
  assert.doesNotMatch(text, /DOP 150.00/);
});
test('positive refund payment is subtracted, original refunded status is not subtracted', () => {
  const text = reportText('PAYMENTS', [sale({ status: 'REFUNDED' }), sale({ id: 'nc', documentType: 'REFUND', payments: [{ method: 'CASH', amount: 40 }] })]);
  assert.match(text, /Aplicado: DOP 60.00/);
});
test('products net negative refund quantities', () => {
  const text = reportText('PRODUCTS', [sale(), sale({ id: 'nc', documentType: 'REFUND', items: [{ id: 'a', name: 'Cafe', quantity: -1, price: 50 }] } as Partial<Transaction>)]);
  assert.match(text, /Cant: 1 {2}DOP 50.00/);
});
test('sales denominated in different currencies are not added together', () => {
  const text = reportText('SALES', [sale(), sale({ id: 'usd', currency: 'USD', total: 5 })]);
  assert.match(text, /Venta neta: DOP 100.00/);
  assert.match(text, /Venta neta: USD 5.00/);
});
test('cash movements retain separate currency totals and show their restricted balance', () => {
  const movements = [
    { id: '1', type: 'IN', amount: 100, currencyCode: 'DOP' },
    { id: '2', type: 'OUT', amount: 25, currencyCode: 'DOP' },
    { id: '3', type: 'IN', amount: 10, currencyCode: 'USD' },
  ].map(m => ({ timestamp: '2026-11-17T12:00:00', reason: 'Fondo', terminalId: 'erp', userName: 'Cajero', ...m })) as CashMovement[];
  const text = buildPosReportText('CASH', { ...empty, movements }, filters, config);
  assert.match(text, /Balance movimientos: DOP 75.00/);
  assert.match(text, /Balance movimientos: USD 10.00/);
  assert.match(text, /no representa efectivo en caja/);
});
test('Z history filters date and box, deduplicates and sorts newest first without modifying source', () => {
  const reports = ['2026-11-17T08:00:00', '2026-11-17T20:00:00', '2026-11-16T20:00:00'].map((closedAt, i) => ({ id: String(i), terminalId: 'erp', closedAt })) as ZReport[];
  const source = { ...empty, reports: [...reports, reports[0]] };
  const before = JSON.stringify(source);
  const filtered = filterPosReportSource(source, filters, config);
  assert.deepEqual(filtered.reports.map(r => r.id), ['1', '0']);
  assert.equal(JSON.stringify(source), before);
});
test('invalid date range is rejected and empty report is explicit', () => {
  assert.equal(validReportDates({ ...filters, start: '' }), false);
  assert.equal(validReportDates({ ...filters, start: '2026-11-18' }), false);
  assert.match(reportText('SALES', []), /Sin registros/);
  assert.equal(localDate(new Date(2026, 10, 17)), '2026-11-17');
});
test('compact ESC/POS uses 32 columns, sanitizes control characters and never opens drawer', () => {
  const payload = buildEscPosVoucherPayload('Informes POS', 'Consulta', 'Cafe\x1bp\n' + 'X'.repeat(70), 32)!;
  const bytes = Buffer.from(payload, 'base64');
  assert.equal(bytes.includes(Buffer.from([0x1b, 0x70])), false);
  for (const line of bytes.toString('latin1').split('\n').filter(line => /^X+$/.test(line))) assert.ok(line.length <= 32);
  assert.ok(bytes.includes(Buffer.from([0x1d, 0x56])));
});


test('different article formats are ranked separately and product limit is applied', () => {
  const tx = sale({ items: [
    { id: 'a', name: 'Cafe', quantity: 2, price: 50 },
    { id: 'a', name: 'Cafe', quantity: 3, price: 300, articleFormat: { schemaVersion: 1, id: 'pack', variantId: null, name: 'Paquete', abbreviation: 'Paq', factor: 6, barcode: null } },
  ] } as Partial<Transaction>);
  const text = buildPosReportText('PRODUCTS', { ...empty, transactions: [tx] }, { ...filters, productLimit: 1 }, config);
  assert.match(text, /Cafe \(Paq\)/);
  assert.match(text, /Cant: 3 {2}DOP 900.00/);
  assert.match(text, /Mostrados: 1 de 2/);
});

test('cashier sales retain original refunded sales, subtract credit notes once and keep same-name users separate', () => {
  const text = reportText('CASHIERS', [sale({ userId: 'a', userName: 'Ana', status: 'REFUNDED' }),
    sale({ id: 'nc', userId: 'a', userName: 'Ana', documentType: 'REFUND', total: -40 }),
    sale({ id: 'b', userId: 'b', userName: 'Ana', total: 200 }),
    sale({ id: 'c', userId: 'c', userName: 'Luis', currency: 'USD', total: 5 })]);
  assert.match(text, /Venta neta: DOP 60.00/);
  assert.match(text, /Ticket promedio: DOP 100.00/);
  assert.match(text, /Venta neta: DOP 200.00/);
  assert.match(text, /TOTAL NETO: DOP 260.00/);
  assert.match(text, /TOTAL NETO: USD 5.00/);
  assert.equal(text.match(/\nAna\n/g)?.length, 2);
});
test('hourly report sorts local hours, aggregates days and subtracts returns at their recorded hour', () => {
  const text = reportText('HOURS', [sale({ date: '2026-11-17T23:59:00' }),
    sale({ id: 'midnight', date: '2026-11-17T00:00:00', total: 60 }),
    sale({ id: 'nextday', date: '2026-11-18T00:30:00', total: 50 }),
    sale({ id: 'nc', date: '2026-11-17T00:59:00', documentType: 'REFUND', total: 10 })]);
  assert.ok(text.indexOf('00:00 - 00:59') < text.indexOf('23:00 - 23:59'));
  assert.match(text, /Tickets de venta: 2\nVentas: DOP 110.00\nDevoluciones \(1\): DOP 10.00\nVenta neta: DOP 100.00/);
  assert.match(text, /TOTAL NETO: DOP 200.00/);
});
test('adjustments show global and line discounts, ignore price overrides and report only credit documents as returns', () => {
  const text = reportText('ADJUSTMENTS', [sale({ status: 'REFUNDED', displayId: 'T-001', authorizedByName: 'Supervisor', items: [
    { id: 'a', name: 'Cafe', price: 50, originalPrice: 60, quantity: 2 },
    { id: 'b', name: 'Ajuste', price: 50, originalPrice: 100, quantity: 1, adjustmentSource: 'MANUAL_PRICE_OVERRIDE' },
  ] } as Partial<Transaction>),
    sale({ id: 'nc', displayId: 'NC-001', documentType: 'REFUND', total: -40, refundReason: 'Producto incorrecto', affectedInvoiceNumber: 'T-001' })]);
  assert.match(text, /Tickets con descuento: 1/);
  assert.match(text, /Descuentos globales: DOP 10.00/);
  assert.match(text, /Descuentos en lineas: DOP 20.00/);
  assert.match(text, /Total descuentos: DOP 30.00/);
  assert.match(text, /Devoluciones \(1\): DOP 40.00/);
  assert.match(text, /Autorizo: Supervisor/);
  assert.match(text, /Origen: T-001\nMotivo: Producto incorrecto/);
});
test('new reports explicitly describe empty periods', () => {
  for (const kind of ['CASHIERS', 'HOURS', 'ADJUSTMENTS'] as const) assert.match(reportText(kind, []), /Sin registros en el periodo/);
});


test('ticket preview wraps at 32 columns, preserves words and splits long identifiers', () => {
  const text = wrapPosReportText('Ventas tras descuentos: DOP 100.00\n\n' + 'X'.repeat(70));
  assert.ok(text.split('\n').every(line => line.length <= 32));
  assert.match(text, /Ventas tras descuentos:\n +DOP 100.00/);
  assert.equal(wrapPosReportText(text), text);
  assert.ok(text.includes('\n\n'));
  assert.equal(wrapPosReportText('Texto corto'), 'Texto corto');
});
