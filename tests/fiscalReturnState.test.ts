import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RETURN_PENDING_ACK_FIELD,
  RETURN_PENDING_STATUS_FIELD,
  decideFiscalReturnPrint,
  markOriginalReturnPending,
  settleOriginalReturnAnnulment,
} from '../services/fiscal/ReturnFiscalState';

const sale = (overrides: Record<string, unknown> = {}) => ({
  id: 'sale-1', status: 'COMPLETED', documentType: 'SALE', ncfType: 'E32', ncf: 'E320000006015',
  total: 352, ...overrides,
} as any);

test('la devolución no anula la venta original: sólo registra la intención hasta el ACK del ERP', () => {
  const pending = markOriginalReturnPending(sale(), 'REFUNDED') as any;
  assert.equal(pending.status, 'COMPLETED', 'la venta no queda ANULADA antes de que el ERP confirme');
  assert.equal(pending[RETURN_PENDING_ACK_FIELD], true);
  assert.equal(pending[RETURN_PENDING_STATUS_FIELD], 'REFUNDED');
  const settled = settleOriginalReturnAnnulment(pending) as any;
  assert.equal(settled.status, 'REFUNDED');
  assert.equal(settled[RETURN_PENDING_ACK_FIELD], undefined);
  assert.equal(settled[RETURN_PENDING_STATUS_FIELD], undefined);
});

test('la anulación se aplica únicamente con el ACK; es idempotente y conserva parciales', () => {
  const partial = markOriginalReturnPending(sale(), 'PARTIAL_REFUND') as any;
  assert.equal(settleOriginalReturnAnnulment(partial).status, 'PARTIAL_REFUND');
  const alreadySettled = settleOriginalReturnAnnulment(sale()) as any;
  assert.equal(alreadySettled.status, 'COMPLETED', 'sin intención pendiente no cambia nada');
  assert.equal(settleOriginalReturnAnnulment(alreadySettled), alreadySettled);
});

test('impresión: NC electrónica sin evidencia firmada se bloquea (nunca QR genérico como fiscal)', () => {
  // Refund E34: blocked without validated signed evidence.
  const refund = sale({ documentType: 'REFUND', ncfType: 'E34', ncf: 'E340000000012' });
  assert.deepEqual(decideFiscalReturnPrint(refund, false), { allowed: false, code: 'FISCAL_RETURN_SIGNED_QR_REQUIRED' });
  assert.equal(decideFiscalReturnPrint(refund, true).allowed, true);
  // Legacy B04 credit note is not an electronic signed QR: unchanged.
  assert.equal(decideFiscalReturnPrint(sale({ documentType: 'REFUND', ncfType: 'B04', ncf: 'B040000000001' }), false).allowed, true);
  // Normal sale keeps its existing generic fallback.
  assert.equal(decideFiscalReturnPrint(sale(), false).allowed, true);
});

test('cableado: App marca pendiente, el store anula sólo con APPLIED_ERP y printer bloquea la NC', () => {
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.match(app, /markOriginalReturnPending\(fresh,returned>=remaining\?'REFUNDED':'PARTIAL_REFUND'\)/);
  const store = readFileSync(new URL('../services/db/NativeFiscalReturnStore.ts', import.meta.url), 'utf8');
  assert.match(store, /settleOriginalReturnAnnulment\(original\)/);
  assert.match(store, /APPLIED_ERP/);
  const printer = readFileSync(new URL('../utils/printer.ts', import.meta.url), 'utf8');
  assert.match(printer, /decideFiscalReturnPrint\(transaction,\s*isVerifiedFiscalPrintDisplay\(fiscalPrint\)\)/);
  assert.match(printer, /FISCAL_RETURN_SIGNED_QR_REQUIRED/);
  const consumer = readFileSync(new URL('../services/fiscal/FiscalReturnConsumer.ts', import.meta.url), 'utf8');
  assert.match(consumer, /active\?\.phase === 'COMMITTED' && active\.committedSource/, 'el reintento devuelve la NC archivada, nunca crea una segunda');
});
