import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { Transaction } from '../types';
import {
  extractInvoiceScanReferences,
  isRecognizedInvoiceScan,
  resolveInvoiceScan,
  resolveInvoiceSearchReference,
  shouldRouteInvoiceScan,
  transactionInvoiceScanAliases,
} from '../utils/invoiceScan';

const transaction = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: 'tx-actual-1',
  displayId: 'TCK01-000123',
  date: '2026-09-28T12:00:00.000Z',
  items: [], total: 100, payments: [], userId: 'user', userName: 'Caja', status: 'COMPLETED',
  ncf: 'B0200000011',
  electronicNcf: 'E320000000001',
  fiscalReferenceId: 'TRACK-123',
  source_transaction_id: 'ERP-SOURCE-1',
  ...overrides,
});

test('receipt display id, NCF, eNCF, fiscal reference, DGII URL and JSON resolve the real Transaction.id', () => {
  const rows = [transaction()];
  for (const scan of [
    'TCK01-000123',
    'b0200000011',
    'E320000000001',
    'TRACK-123',
    'https://dgii.gov.do/check?ncf=B0200000011&trackId=TRACK-123',
    JSON.stringify({ type: 'INVOICE_RETURN', displayId: 'TCK01-000123' }),
    JSON.stringify({ type: 'FISCAL_INVOICE', fiscalReferenceId: 'TRACK-123' }),
  ]) {
    assert.deepEqual(resolveInvoiceScan(scan, rows), { status: 'MATCH', transactionId: 'tx-actual-1', transaction: rows[0] });
  }
});

test('malformed, missing and ambiguous scans never select a transaction', () => {
  assert.deepEqual(resolveInvoiceScan('{bad json}', [transaction()]), { status: 'INVALID' });
  assert.deepEqual(resolveInvoiceScan('TCK01-404', [transaction()]), { status: 'NOT_FOUND' });
  const ambiguous = resolveInvoiceScan('B0200000011', [transaction(), transaction({ id: 'tx-actual-2' })]);
  assert.equal(ambiguous.status, 'AMBIGUOUS');
});

test('recognition excludes products/coupons/reservations and parses valid DGII/JSON invoice payloads', () => {
  assert.equal(isRecognizedInvoiceScan('74000171'), false);
  assert.equal(isRecognizedInvoiceScan('CUPON-PRUEBA-10'), false);
  assert.equal(isRecognizedInvoiceScan(JSON.stringify({ type: 'RESERVATION_NOTE', id: 'R1' })), false);
  assert.equal(isRecognizedInvoiceScan('bad dgii.gov.do'), false);
  assert.equal(isRecognizedInvoiceScan('https://dgii.gov.do/check?ncf=B0200000011'), true);
  assert.deepEqual(extractInvoiceScanReferences(JSON.stringify({ type: 'INVOICE_RETURN', id: 'tx-actual-1' })), ['TX-ACTUAL-1']);
});

test('invoice-like product codes keep catalog priority in HID and camera routing', () => {
  for (const barcode of ['INV001', 'NC-SODA', 'B01ABC', 'E31001', 'TXN-PRODUCT']) {
    assert.equal(isRecognizedInvoiceScan(barcode), true);
    assert.equal(shouldRouteInvoiceScan(barcode, { product: true }), false);
    assert.equal(shouldRouteInvoiceScan(barcode), true);
  }
  assert.equal(shouldRouteInvoiceScan('TCK01-000123'), true);
});

test('search reference and aliases normalize JSON/DGII input for local ambiguity and ERP lookup', () => {
  assert.equal(resolveInvoiceSearchReference('{"type":"INVOICE_RETURN","ncf":"b0200000011"}'), 'B0200000011');
  assert.equal(resolveInvoiceSearchReference('https://dgii.gov.do/check?ncf=B0200000011&trackId=TRACK-123'), 'B0200000011');
  assert.deepEqual(transactionInvoiceScanAliases(transaction()), [
    'TX-ACTUAL-1', 'TCK01-000123', 'B0200000011', 'E320000000001', 'TRACK-123', 'ERP-SOURCE-1',
  ]);
  const fiscalUrlOnly = transaction({ ncf: undefined, fiscalReferenceId: undefined, fiscalQrUrl: 'https://dgii.gov.do/check?ncf=B0200000099' });
  assert.equal(resolveInvoiceScan('B0200000099', [fiscalUrlOnly]).status, 'MATCH');
});

test('POS keeps coupon precedence and delegates invoice actions to the secured TicketHistory flow', () => {
  const pos = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
  const process = pos.slice(pos.indexOf('const processBarcode ='), pos.indexOf('const isAnyModalOpen'));
  assert.ok(process.indexOf('routeScannedCoupon(trimmed)') < process.indexOf('shouldRouteInvoiceScan(trimmed)'));
  assert.ok(process.indexOf('findProductByAnyCode(trimmed)') < process.indexOf('shouldRouteInvoiceScan(trimmed)'));
  assert.match(process, /activeReservationByScanCode\.get/);
  const camera = pos.slice(pos.indexOf('<BarcodeScannerModal'), pos.indexOf('quickActionData &&'));
  assert.match(camera, /onScan=\{async \(code\) => processBarcode\(code\)\}/);
  assert.doesNotMatch(camera, /reservations \|\||products \|\||parseScaleBarcode|shouldRouteInvoiceScan/);
  const hid = pos.slice(pos.indexOf('const handleCentralBarcodeScan'), pos.indexOf("window.addEventListener('barcodeScanned'"));
  assert.match(hid, /processBarcode\(barcode\)/);
  assert.doesNotMatch(pos, /<ReturnModal|handleProcessReturn/);

  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.match(app, /onTicketScan: currentView === 'HISTORY'/);

  const history = readFileSync(new URL('../components/TicketHistory.tsx', import.meta.url), 'utf8');
  assert.match(history, /setSelectedTxId\(resolution\.transactionId\)/);
  assert.match(history, /setSearchTerm\(normalizedReference\)/);
  assert.match(history, /transactionInvoiceScanAliases\(t\)/);
  assert.match(history, /setRefundTx\(tx\);\s*setIsRefundModalOpen\(true\)/);
  assert.match(history, /requestApproval\(/);
});
