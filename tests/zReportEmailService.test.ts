import assert from 'node:assert/strict';
import test from 'node:test';
import { parseZReportEmailResponse } from '../services/email/zReportEmailService';

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
