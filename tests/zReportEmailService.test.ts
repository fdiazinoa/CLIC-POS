import assert from 'node:assert/strict';
import test from 'node:test';
import { parseZReportEmailResponse, sendZReportEmailViaErp } from '../services/email/zReportEmailService';

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
