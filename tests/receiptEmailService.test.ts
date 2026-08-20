import assert from 'node:assert/strict';
import test from 'node:test';

import { parseReceiptEmailResponse } from '../services/email/receiptEmailService';

test('rechaza HTTP 200 que contiene HTML de la aplicacion', async () => {
  const response = new Response('<!doctype html><html></html>', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

  const result = await parseReceiptEmailResponse(response);

  assert.equal(result.success, false);
  assert.match(result.message || '', /no devolvio JSON/i);
});

test('rechaza success true sin identificador de Resend', async () => {
  const response = Response.json({ success: true, status: 'accepted' });

  const result = await parseReceiptEmailResponse(response);

  assert.equal(result.success, false);
  assert.match(result.message || '', /identificador/i);
});

test('rechaza un HTTP exitoso cuando success no es true', async () => {
  const response = Response.json({ message: 'simulation mode' });

  const result = await parseReceiptEmailResponse(response);

  assert.equal(result.success, false);
  assert.equal(result.message, 'simulation mode');
});

test('acepta solo la confirmacion JSON con success e id de Resend', async () => {
  const response = Response.json({
    success: true,
    id: 're_123456',
    status: 'accepted',
    message: 'Receipt accepted by Resend',
  });

  const result = await parseReceiptEmailResponse(response);

  assert.deepEqual(result, {
    success: true,
    id: 're_123456',
    status: 'accepted',
    message: 'Receipt accepted by Resend',
  });
});
