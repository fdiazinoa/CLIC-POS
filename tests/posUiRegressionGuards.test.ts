import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

test('an unmigrated V3 baseline explains itself instead of leaking its code', () => {
  const messages = source('utils/v3ErrorMessages.ts');
  // El cajero no puede hacer nada con el código crudo: los cuatro rechazos del baseline
  // tienen que llegar traducidos, tanto en la nota de crédito como en el cobro.
  assert.match(messages, /SYNC_V3_BASELINE_MIGRATION_REQUIRED:\s*\n\s*'/);
  assert.match(messages, /SYNC_V3_INVENTORY_COVERAGE_REQUIRED:\s*\n\s*'/);
  assert.match(messages, /SYNC_V3_CATALOG_SEMANTICS_CHANGED:\s*\n\s*'/);
  assert.match(messages, /SYNC_V3_STOCK_AUTHORITY_INVALID:\s*\n\s*'/);
  assert.match(source('components/RefundModal.tsx'), /setSubmitError\(describeV3Error\(error\)\)/);
  assert.doesNotMatch(source('components/RefundModal.tsx'), /setSubmitError\(error instanceof Error \? error\.message/);
  assert.match(source('components/TicketHistory.tsx'), /catch\(error\) \{ alert\(describeV3Error\(error\)\); return; \}/);
  assert.match(source('App.tsx'), /Error procesando devolución: \$\{refundDetail\}/);
  assert.doesNotMatch(source('App.tsx'), /Error procesando devolución: \$\{refundError\?\.message/);
});

test('describeV3Error maps the known codes and never hides an unknown one', async () => {
  const { describeV3Error } = await import('../utils/v3ErrorMessages');
  assert.match(describeV3Error(new Error('SYNC_V3_BASELINE_MIGRATION_REQUIRED')), /inventario/);
  assert.equal(describeV3Error(new Error('SYNC_V3_SOMETHING_NEW')), 'SYNC_V3_SOMETHING_NEW');
  assert.match(describeV3Error(new Error('SYNC_V3_STOCK_INSUFFICIENT: detalle del ERP')), /^No hay existencia suficiente/);
  assert.equal(describeV3Error(undefined), 'No se pudo completar la operación.');
});

test('every rejection the refund surface can actually raise is translated', async () => {
  const { describeV3Error } = await import('../utils/v3ErrorMessages');
  // Los códigos que de verdad aparecen en handleProcessRefund -> persistStandaloneRefundTransaction.
  for (const code of ['SYNC_V3_RUNTIME_VERSION_CHANGED', 'SYNC_V3_REFUND_ORIGINAL_CHANGED',
    'SYNC_V3_REFUND_ORIGINAL_NOT_REFUNDABLE', 'SYNC_V3_FROZEN_FISCAL_SOURCE_CHANGED',
    'SYNC_V3_DUPLICATE_TRANSACTION_MISMATCH', 'SYNC_V3_CONFIG_REQUIRED', 'SYNC_V3_CART_MIXED_VERSION']) {
    assert.notEqual(describeV3Error(new Error(code)), code, `${code} debe tener mensaje humano`);
  }
  // El texto no puede prometer que la NC también está bloqueada: se emite con la foto del ticket.
  assert.doesNotMatch(describeV3Error(new Error('SYNC_V3_BASELINE_MIGRATION_REQUIRED')),
    /ni emitir notas de crédito/i);
  // Y no debe mandar a una acción que no existe.
  assert.doesNotMatch(describeV3Error(new Error('SYNC_V3_STOCK_AUTHORITY_INVALID')), /diagnóstico/i);
});

test('refund errors never assert issuance outcome or instruct replacing the original snapshot', async () => {
  const { describeV3Error } = await import('../utils/v3ErrorMessages');
  assert.doesNotMatch(describeV3Error(new Error('SYNC_V3_FROZEN_FISCAL_SOURCE_CHANGED')), /No se emitió ningún documento/i);
  assert.doesNotMatch(describeV3Error(new Error('SYNC_V3_DUPLICATE_TRANSACTION_MISMATCH')), /Ya existe una nota de crédito/i);
  assert.doesNotMatch(describeV3Error(new Error('SYNC_V3_RETAINED_OWNER_REQUIRED')), /inventario de hoy/i);
  assert.doesNotMatch(describeV3Error(new Error('SYNC_V3_BASELINE_MIGRATION_REQUIRED')), /sí se pueden emitir/i);
});
