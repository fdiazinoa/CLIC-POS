import assert from 'node:assert/strict';
import test from 'node:test';
import { validate as isUuid } from 'uuid';

import {
  parseReceiptEmailResponse,
  withReceiptDeliveryRequestId,
} from '../services/email/receiptEmailService';

test('genera una identidad nueva para cada intento de reenvío', () => {
  const payload = { email: 'cliente@example.com', cart: [{ name: 'Producto' }] };
  const first = withReceiptDeliveryRequestId(payload);
  const second = withReceiptDeliveryRequestId(payload);

  assert.equal(isUuid(first.deliveryRequestId || ''), true);
  assert.equal(isUuid(second.deliveryRequestId || ''), true);
  assert.notEqual(first.deliveryRequestId, second.deliveryRequestId);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'deliveryRequestId'), false);
});

test('rechaza HTTP 200 que contiene HTML de la aplicacion', async () => {
  const response = {
    ok: true,
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    data: null,
    text: '<!doctype html><html></html>',
  };

  const result = parseReceiptEmailResponse(response);

  assert.equal(result.success, false);
  assert.match(result.message || '', /no devolvio JSON/i);
});

test('rechaza success true sin identificador de Resend', async () => {
  const response = {
    ok: true,
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    data: { success: true, status: 'accepted' },
    text: JSON.stringify({ success: true, status: 'accepted' }),
  };

  const result = parseReceiptEmailResponse(response);

  assert.equal(result.success, false);
  assert.match(result.message || '', /identificador/i);
});

test('rechaza un HTTP exitoso cuando success no es true', async () => {
  const response = {
    ok: true,
    status: 200,
    headers: { 'content-type': 'application/json' },
    data: { message: 'simulation mode' },
    text: JSON.stringify({ message: 'simulation mode' }),
  };

  const result = parseReceiptEmailResponse(response);

  assert.equal(result.success, false);
  assert.equal(result.message, 'simulation mode');
});

test('acepta solo la confirmacion JSON con success e id de Resend', async () => {
  const data = {
      success: true,
      id: 're_123456',
      status: 'accepted',
      message: 'Receipt accepted by Resend',
  };
  const response = {
    ok: true,
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    data,
    text: JSON.stringify(data),
  };

  const result = parseReceiptEmailResponse(response);

  assert.deepEqual(result, {
    success: true,
    id: 're_123456',
    status: 'accepted',
    message: 'Receipt accepted by Resend',
  });
});
