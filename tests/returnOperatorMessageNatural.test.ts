import test from 'node:test';
import assert from 'node:assert/strict';
import { returnOperatorMessage } from '../services/fiscal/FiscalReturnV1';

test('la NC parcial de una línea sin impuesto no expone el código técnico', () => {
  const message = returnOperatorMessage(new Error('FISCAL_RETURN_LINE_TAX_ATTRIBUTION_REQUIRED'));
  assert.doesNotMatch(message, /FISCAL_/);
  assert.match(message, /nota de crédito/i);
  assert.match(message, /Reintenta/i);
});

test('los mensajes de devolución no filtran códigos internos al cajero', () => {
  for (const code of ['FISCAL_RETURN_CUSTOMER_REQUIRED','FISCAL_RETURN_PAYMENT_ATTRIBUTION','FISCAL_RETURN_RECOVERY_REQUIRED','FISCAL_RETURN_REQUEST_TIMEOUT']) {
    const message = returnOperatorMessage(new Error(code));
    assert.doesNotMatch(message, /FISCAL_/, code);
    assert.ok(message.length > 20, code);
  }
});

test('cliente final explica la regla real, no un problema de conexión', () => {
  const message = returnOperatorMessage(new Error('FISCAL_RETURN_CONSUMER_FINAL_FULL_CASH_REQUIRED'));
  assert.doesNotMatch(message, /FISCAL_/);
  assert.doesNotMatch(message, /Conecta la caja/i);
  assert.match(message, /cliente final/i);
  assert.match(message, /completa/i);
});
test('un timeout sí habla de la conexión y no filtra el código', () => {
  const message = returnOperatorMessage(new Error('FISCAL_RETURN_REQUEST_TIMEOUT'));
  assert.doesNotMatch(message, /FISCAL_/);
  assert.match(message, /mismo intento/i);
  assert.equal(returnOperatorMessage(new DOMException('aborted', 'AbortError')), message);
});
