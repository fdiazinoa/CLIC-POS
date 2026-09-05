import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildZReportEmailContractReport,
  parseZReportEmailResponse,
  sendZReportEmailViaErp,
} from '../services/email/zReportEmailService';
import type { BusinessConfig, ZReport } from '../types';

const contractConfig = (declaredIds: string[] = ['card-id']): BusinessConfig => ({
  companyInfo: { name: 'PANCUVI SRL' },
  currencySymbol: 'RD$',
  currencies: [{ code: 'DOP', name: 'Peso dominicano', symbol: 'RD$', rate: 1, isEnabled: true, isBase: true }],
  paymentMethods: [
    { id: 'cash-id', name: 'Efectivo', type: 'CASH', isEnabled: true },
    { id: 'card-id', name: 'Tarjeta', type: 'CARD', isEnabled: true },
    { id: 'qr-id', name: 'Pago QR', type: 'QR', isEnabled: true },
    { id: 'pending-id', name: 'Pendiente', type: 'CREDIT', isEnabled: true },
  ],
  terminals: [{
    id: 'T1',
    config: { workflow: { session: { zReportDeclaredPaymentMethodIds: declaredIds } } },
  }],
} as unknown as BusinessConfig);

const contractReport = (overrides: Partial<ZReport> = {}): ZReport => ({
  id: 'z-contract-v2',
  terminalId: 'T1',
  sequenceNumber: 'Z-000001',
  openedAt: '2026-09-04T08:00:00-04:00',
  closedAt: '2026-09-04T18:00:00-04:00',
  closedByUserId: 'u1',
  closedByUserName: 'Ana',
  baseCurrency: 'DOP',
  totalsByMethod: { CASH: 1500, CARD: 3125, CREDIT: 375 },
  paymentMethodSummary: [
    { methodId: 'card-id', methodType: 'CARD', name: 'Tarjeta', amount: 3125 },
    { methodId: 'pending-id', methodType: 'PENDING', name: 'Pendiente', amount: 375, isPending: true },
  ],
  paymentMethodDeclarations: [
    { methodId: 'card-id', methodType: 'CARD', name: 'Tarjeta', amount: 3125, expected: 3125, declared: 2500, difference: -625 },
    { methodId: 'pending-id', methodType: 'PENDING', name: 'Pendiente', amount: 375, isPending: true, expected: 375, declared: 375, difference: 0 },
  ],
  cashExpected: { DOP: 1500 },
  cashCounted: { DOP: 2500 },
  cashDiscrepancy: { DOP: 1000 },
  cashSales: 1500,
  cashIn: 0,
  cashOut: 0,
  transactionCount: 18,
  notes: '',
  stats: {
    grossSales: 5250,
    returnsTotal: 250,
    netSales: 5000,
  } as ZReport['stats'],
  ...overrides,
});

test('contrato v2 agrega Efectivo cuando cashSales es mayor que cero', () => {
  const contract = buildZReportEmailContractReport(contractReport(), contractConfig()) as any;
  assert.deepEqual(contract.paymentMethodSummary[0], {
    methodId: 'cash-id', methodType: 'CASH', name: 'Efectivo', amount: 1500,
  });
  assert.equal(contract.cashSales, 1500);
});

test('Efectivo, Tarjeta y Pendiente concilian exactamente con ventas netas', () => {
  const contract = buildZReportEmailContractReport(contractReport(), contractConfig()) as any;
  const summaryTotal = contract.paymentMethodSummary.reduce((sum: number, line: any) => sum + line.amount, 0);
  assert.equal(summaryTotal, contract.stats.netSales);
});

test('el efectivo recibido antes del cambio nunca aumenta cashSales', () => {
  const report = contractReport({
    paymentMethodSummary: [
      { methodId: 'cash-id', methodType: 'CASH', name: 'Efectivo', amount: 2500 },
      { methodId: 'card-id', methodType: 'CARD', name: 'Tarjeta', amount: 3125 },
      { methodId: 'pending-id', methodType: 'PENDING', name: 'Pendiente', amount: 375, isPending: true },
    ],
  });
  const contract = buildZReportEmailContractReport(report, contractConfig()) as any;
  assert.equal(contract.paymentMethodSummary.find((line: any) => line.methodType === 'CASH').amount, 1500);
  assert.equal(contract.paymentMethodSummary.reduce((sum: number, line: any) => sum + line.amount, 0), 5000);
});

test('Pendiente aparece separado y nunca genera declaración', () => {
  const contract = buildZReportEmailContractReport(
    contractReport(),
    contractConfig(['card-id', 'pending-id']),
  ) as any;
  const pending = contract.paymentMethodSummary.find((line: any) => line.methodType === 'PENDING');
  assert.equal(pending.name, 'Pendiente');
  assert.equal(pending.isPending, true);
  assert.equal(contract.paymentMethodDeclarations.some((line: any) => line.methodId === 'pending-id'), false);
});

test('solo declara las formas cuyos IDs están configurados', () => {
  const report = contractReport({
    paymentMethodSummary: [
      { methodId: 'card-id', methodType: 'CARD', name: 'Tarjeta', amount: 3000 },
      { methodId: 'qr-id', methodType: 'QR', name: 'Pago QR', amount: 125 },
      { methodId: 'other-id', methodType: 'OTHER', name: 'Otro', amount: 0 },
      { methodId: 'pending-id', methodType: 'PENDING', name: 'Pendiente', amount: 375, isPending: true },
    ],
    paymentMethodDeclarations: [
      { methodId: 'card-id', methodType: 'CARD', name: 'Tarjeta', amount: 3000, expected: 3000, declared: 2900, difference: -100 },
      { methodId: 'qr-id', methodType: 'QR', name: 'Pago QR', amount: 125, expected: 125, declared: 100, difference: -25 },
    ],
  });
  const contract = buildZReportEmailContractReport(report, contractConfig(['qr-id'])) as any;
  assert.deepEqual(contract.paymentMethodDeclarations.map((line: any) => line.methodId), ['qr-id']);
});

test('acepta z_report_declared_payment_method_ids en snake_case', () => {
  const config = contractConfig([]) as any;
  config.terminals[0].config.workflow.session = {
    z_report_declared_payment_method_ids: ['card-id'],
  };
  const contract = buildZReportEmailContractReport(contractReport(), config) as any;
  assert.deepEqual(contract.paymentMethodDeclarations.map((line: any) => line.methodId), ['card-id']);
});

test('una configuración declarable vacía produce declaraciones vacías', () => {
  const contract = buildZReportEmailContractReport(contractReport(), contractConfig([])) as any;
  assert.deepEqual(contract.paymentMethodDeclarations, []);
});

test('los descuadres usan siempre declarado menos esperado', () => {
  const contract = buildZReportEmailContractReport(contractReport(), contractConfig(['card-id'])) as any;
  assert.equal(contract.cashExpected, 1500);
  assert.equal(contract.cashCounted, 2500);
  assert.equal(contract.cashDiscrepancy, 1000);
  assert.equal(contract.paymentMethodDeclarations[0].difference, -625);
});

test('rechaza HTML aunque la respuesta sea HTTP 200', () => {
  const result = parseZReportEmailResponse({
    ok: true,
    status: 200,
    headers: { 'content-type': 'text/html' },
    data: null,
    text: '<!doctype html>',
  });
  assert.equal(result.success, false);
  assert.match(result.message || '', /no está disponible/i);
});

test('propaga el mensaje JSON de error del ERP', () => {
  const result = parseZReportEmailResponse({
    ok: false,
    status: 502,
    headers: { 'content-type': 'application/json' },
    data: { success: false, message: 'Resend rechazó el envío del cierre Z.' },
    text: '',
  });
  assert.deepEqual(result, { success: false, message: 'Resend rechazó el envío del cierre Z.' });
});

test('solo confirma respuestas con identificador de Resend', () => {
  const result = parseZReportEmailResponse({
    ok: true,
    status: 200,
    headers: { 'content-type': 'application/json' },
    data: { success: true, id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794', status: 'accepted' },
    text: '',
  });
  assert.deepEqual(result, {
    success: true,
    id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794',
    status: 'accepted',
    message: undefined,
  });
});

test('renueva la autorización y reintenta una sola vez ante HTTP 401', async () => {
  const tokens: string[] = [];
  const deliveryIds: string[] = [];
  let currentToken = 'expired-token';
  let refreshCount = 0;
  const result = await sendZReportEmailViaErp({
    recipients: 'cierres@example.com',
    report: { id: 'z-001' } as never,
    config: { companyInfo: {}, currencySymbol: 'RD$' } as never,
  }, {
    readCredentials: () => ({
      syncToken: currentToken,
      erpTerminalId: 'terminal-1',
      deviceId: 'device-1',
      deviceToken: 'device-token',
      erpTenantId: 'tenant-1',
    }),
    refreshAuthorization: async () => {
      refreshCount += 1;
      currentToken = 'fresh-token';
    },
    request: async (input) => {
      tokens.push(String(input.headers?.['X-Sync-Token']));
      deliveryIds.push(String((input.body as { deliveryId: string }).deliveryId));
      const authorized = tokens.length > 1;
      return {
        ok: authorized,
        status: authorized ? 200 : 401,
        headers: { 'content-type': 'application/json' },
        data: authorized
          ? { success: true, id: 'resend-id', status: 'accepted' }
          : { success: false, message: 'The terminal authorization has expired.' },
        text: '',
        networkEngine: 'fetch',
        fetchStage: 'response',
      };
    },
  });

  assert.equal(result.success, true);
  assert.equal(refreshCount, 1);
  assert.deepEqual(tokens, ['expired-token', 'fresh-token']);
  assert.equal(deliveryIds[0], deliveryIds[1]);
});

test('muestra un error en español cuando no puede renovar la autorización', async () => {
  const result = await sendZReportEmailViaErp({
    recipients: 'cierres@example.com',
    report: { id: 'z-002' } as never,
    config: { companyInfo: {}, currencySymbol: 'RD$' } as never,
  }, {
    readCredentials: () => ({ syncToken: 'expired-token' }),
    refreshAuthorization: async () => {
      throw new Error('refresh failed');
    },
    request: async () => ({
      ok: false,
      status: 401,
      headers: { 'content-type': 'application/json' },
      data: { success: false, message: 'The terminal authorization has expired.' },
      text: '',
      networkEngine: 'fetch',
      fetchStage: 'response',
    }),
  });

  assert.deepEqual(result, {
    success: false,
    message: 'La autorización de la terminal venció y no pudo renovarse automáticamente.',
  });
});

test('envía al ERP los anexos seleccionados y calculados del cierre Z', async () => {
  let sentBody: any;
  const report = {
    id: 'z-003',
    enabledSections: ['SELLER_SUMMARY', 'ITEM_SUMMARY'],
    reportDetails: {
      sellerSummary: [{ userName: 'Ana', transactionCount: 2, netSales: 500 }],
      itemSummary: [{ productName: 'Café', quantity: 2, netSales: 500 }],
    },
    denominationBreakdown: { DOP: [{ denomination: 500, quantity: 1, total: 500 }] },
  } as never;

  const result = await sendZReportEmailViaErp({
    recipients: 'cierres@example.com',
    report,
    config: { companyInfo: { name: 'Mercasend' }, currencySymbol: 'RD$' } as never,
  }, {
    readCredentials: () => ({ syncToken: 'valid-token' }),
    request: async (input) => {
      sentBody = input.body;
      return {
        ok: true,
        status: 200,
        headers: { 'content-type': 'application/json' },
        data: { success: true, id: 'resend-id', status: 'accepted' },
        text: '',
        networkEngine: 'fetch',
        fetchStage: 'response',
      };
    },
  });

  assert.equal(result.success, true);
  assert.equal(sentBody.reportSchemaVersion, 2);
  assert.deepEqual(sentBody.report.enabledSections, ['SELLER_SUMMARY', 'ITEM_SUMMARY']);
  assert.equal(sentBody.report.reportDetails.sellerSummary[0].userName, 'Ana');
  assert.equal(sentBody.report.denominationBreakdown.DOP[0].total, 500);
});
