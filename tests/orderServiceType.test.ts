import assert from 'node:assert/strict';
import test from 'node:test';
import type { Transaction } from '../types';
import {
  buildServiceTypeReport,
  resolveTransactionServiceType,
  shouldApplyRestaurantServiceCharge,
} from '../utils/orderServiceType';
import { buildSalePostedSummary } from '../services/sync/SalePostedContract';
import { normalizeTransactionForSync } from '../services/sync/sourceIdentity';
import { buildEscPosZReportPayload } from '../services/printer/EscPosFormatter';
import { generateZReportReceipt } from '../services/printer/templates/ZReportReceipt';

const transaction = (patch: Partial<Transaction>): Transaction => ({
  id: patch.id || 'txn-1',
  displayId: patch.displayId || patch.id || 'TCK-1',
  documentType: 'TICKET',
  seriesId: 'ticket-series',
  date: '2026-09-01T12:00:00.000Z',
  items: [],
  total: 100,
  payments: [],
  userId: 'user-1',
  userName: 'Cajero',
  terminalId: 'terminal-1',
  device_id: 'device-1',
  status: 'COMPLETED',
  ...patch,
});

const serviceCharge = {
  enabled: true,
  percentage: 10,
  applyIfTotalOver: 0,
  applyIfGuestsOver: 0,
};

test('la propina legal solo aplica a consumo en mesa', () => {
  assert.equal(shouldApplyRestaurantServiceCharge({
    isRestaurantMode: true,
    serviceType: 'DINE_IN',
    serviceCharge,
    grossAfterDiscount: 100,
    guests: 1,
  }), true);

  for (const serviceType of ['TAKEOUT', 'DELIVERY'] as const) {
    assert.equal(shouldApplyRestaurantServiceCharge({
      isRestaurantMode: true,
      serviceType,
      serviceCharge,
      grossAfterDiscount: 100,
      guests: 1,
    }), false);
  }
});

test('el cierre resume tipos de servicio y detalla para llevar y delivery', () => {
  const report = buildServiceTypeReport([
    transaction({ id: 'dine', displayId: 'TCK-1', serviceType: 'DINE_IN', total: 110, serviceChargeAmount: 10 }),
    transaction({ id: 'takeout', displayId: 'TCK-2', serviceType: 'TAKEOUT', total: 200, serviceChargeAmount: 0 }),
    transaction({ id: 'delivery', displayId: 'TCK-3', serviceType: 'DELIVERY', total: 300, serviceChargeAmount: 0 }),
  ]);

  assert.deepEqual(report.summary.map(line => [line.serviceType, line.transactionCount, line.total]), [
    ['DINE_IN', 1, 110],
    ['TAKEOUT', 1, 200],
    ['DELIVERY', 1, 300],
  ]);
  assert.deepEqual(report.transactions.map(line => [line.displayId, line.serviceType]), [
    ['TCK-2', 'TAKEOUT'],
    ['TCK-3', 'DELIVERY'],
  ]);
});

test('una integración de marketplace se clasifica como delivery sin reclasificar ventas antiguas', () => {
  assert.equal(resolveTransactionServiceType(transaction({ marketplaceSourceChannel: 'UBER_EATS' })), 'DELIVERY');
  assert.equal(resolveTransactionServiceType(transaction({})), undefined);
});

test('el tipo de servicio viaja en la normalización y resumen de sincronización', () => {
  const takeout = transaction({
    serviceType: 'TAKEOUT',
    serviceChargeAmount: 0,
    serviceTaxPolicySnapshot: {
      serviceType: 'TAKEOUT',
      source: 'TERMINAL',
      taxIds: ['tax-18'],
      legalTip: { enabled: false, percentage: 0 },
    },
  });
  const normalized = normalizeTransactionForSync(takeout);
  const summary = buildSalePostedSummary(takeout);

  assert.equal(normalized.serviceType, 'TAKEOUT');
  assert.equal(normalized.service_type, 'TAKEOUT');
  assert.equal(summary.service_type, 'TAKEOUT');
  assert.equal(summary.service_charge_amount, 0);
  assert.deepEqual(normalized.service_tax_policy_snapshot, takeout.serviceTaxPolicySnapshot);
  assert.deepEqual(summary.service_tax_policy_snapshot, takeout.serviceTaxPolicySnapshot);
});

test('la impresión histórica del cierre conserva cada factura para llevar o delivery', () => {
  const serviceReport = buildServiceTypeReport([
    transaction({ id: 'takeout', displayId: 'TCK-20', serviceType: 'TAKEOUT', total: 200, taxAmount: 18 }),
    transaction({ id: 'delivery', displayId: 'TCK-21', serviceType: 'DELIVERY', total: 300, taxAmount: 36, serviceChargeAmount: 15 }),
  ]);
  const report = {
    id: 'z-service',
    terminalId: 'terminal-1',
    sequenceNumber: 'Z-0002',
    openedAt: '2026-09-01T10:00:00.000Z',
    closedAt: '2026-09-01T13:00:00.000Z',
    closedByUserId: 'user-1',
    closedByUserName: 'Cajero',
    baseCurrency: 'DOP',
    totalsByMethod: {},
    cashExpected: {},
    cashCounted: {},
    cashDiscrepancy: {},
    cashSales: 0,
    cashIn: 0,
    cashOut: 0,
    transactionCount: 2,
    notes: '',
    serviceTypeSummary: serviceReport.summary,
    serviceTypeTransactions: serviceReport.transactions,
  } as any;
  const config = { companyInfo: { name: 'CLIC POS' }, currencySymbol: 'RD$' } as any;

  const html = generateZReportReceipt(report, [], config);
  assert.match(html, /VENTAS POR TIPO DE SERVICIO/);
  assert.match(html, /TCK-20/);
  assert.match(html, /TCK-21/);
  assert.match(html, /Impuestos/);
  assert.match(html, /Propina legal/);

  const escPos = buildEscPosZReportPayload(report, [], config);
  const decoded = Buffer.from(escPos!, 'base64').toString('latin1');
  assert.match(decoded, /PARA LLEVAR \/ DELIVERY/);
  assert.match(decoded, /TCK-20/);
  assert.match(decoded, /TCK-21/);
  assert.match(decoded, /Impuestos/);
  assert.match(decoded, /Propina legal/);
});
