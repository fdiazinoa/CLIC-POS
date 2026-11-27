import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FISCAL_PRINT_WARMUP_INTERVAL_MS,
  FISCAL_PRINT_WARMUP_RECENT_MS,
  FISCAL_PRINT_WARMUP_TIMEOUT_MS,
  needsFiscalPrintWarmup,
  resetFiscalPrintWarmupForTests,
  warmFiscalPrintEvidence,
} from '../services/fiscal/FiscalPrintEvidenceWarmup';

const sale = (overrides: Record<string, unknown> = {}) => ({
  id: 'sale-1', date: new Date().toISOString(), fiscalProvider: 'MSELLER', ncfType: 'E32', documentType: 'SALE',
  ...overrides,
} as any);
const immediate = async () => {};
const client = (states: Array<any>, calls = { count: 0 }) => ({
  enabled: () => true,
  consult: async () => { calls.count += 1; const next = states.length > 1 ? states.shift() : states[0]; return next; },
  calls,
});

test('cuando la firma llega después de la venta, el warm-up la persiste por el cliente y devuelve true', async () => {
  resetFiscalPrintWarmupForTests();
  const calls = { count: 0 };
  const fake = client([{ signature: null }, { signature: null }, { signature: { securityCode: 'ABC123' } }], calls);
  const signed = await warmFiscalPrintEvidence(sale(), { client: fake as any, timeoutMs: 5000, delay: immediate });
  assert.equal(signed, true);
  assert.ok(calls.count >= 3, 'consulta hasta que el ERP publica la firma, no una sola vez');
});

test('sin firma dentro del presupuesto devuelve false sin lanzar (fallback genérica actual)', async () => {
  resetFiscalPrintWarmupForTests();
  const fake = client([{ signature: null }]);
  const result = await warmFiscalPrintEvidence(sale(), { client: fake as any, timeoutMs: 0, delay: immediate });
  assert.equal(result, false);
});

test('un error transitorio del ERP no detiene el warm-up', async () => {
  resetFiscalPrintWarmupForTests();
  let calls = 0;
  const fake = {
    enabled: () => true,
    consult: async () => { calls += 1; if (calls === 1) throw Error('NETWORK'); return { signature: { code: 'XYZ' } }; },
  };
  assert.equal(await warmFiscalPrintEvidence(sale(), { client: fake as any, timeoutMs: 5000, delay: immediate }), true);
  assert.equal(calls, 2);
});

test('una llamada concurrente se deduplica: un solo hilo de consulta por venta', async () => {
  resetFiscalPrintWarmupForTests();
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fake = {
    enabled: () => true,
    consult: async () => { calls += 1; await gate; return { signature: { code: 'OK' } }; },
  };
  const first = warmFiscalPrintEvidence(sale(), { client: fake as any, timeoutMs: 5000, delay: immediate });
  const second = warmFiscalPrintEvidence(sale(), { client: fake as any, timeoutMs: 5000, delay: immediate });
  release();
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.equal(calls, 1);
});

test('solo ventas MSELLER recientes y no nota de crédito se calientan', async () => {
  resetFiscalPrintWarmupForTests();
  const now = Date.now();
  assert.equal(needsFiscalPrintWarmup(sale({ fiscalProvider: 'OTHER' }) as any, now), false);
  assert.equal(needsFiscalPrintWarmup(sale({ ncfType: 'B04' }) as any, now), false);
  assert.equal(needsFiscalPrintWarmup(sale({ ncfType: 'E34' }) as any, now), false);
  assert.equal(needsFiscalPrintWarmup(sale({ date: new Date(now - FISCAL_PRINT_WARMUP_RECENT_MS - 1000).toISOString() }) as any, now), false);
  assert.equal(needsFiscalPrintWarmup(sale() as any, now), true);
  let consulted = 0;
  const fake = { enabled: () => true, consult: async () => { consulted += 1; return { signature: {} }; } };
  assert.equal(await warmFiscalPrintEvidence(sale({ fiscalProvider: 'OTHER' }), { client: fake as any, timeoutMs: 5, delay: immediate }), false);
  assert.equal(await warmFiscalPrintEvidence(sale({ ncfType: 'B04' }), { client: fake as any, timeoutMs: 5, delay: immediate }), false);
  assert.equal(consulted, 0);
});

test('un flujo fiscal deshabilitado no consulta ni retiene la venta', async () => {
  resetFiscalPrintWarmupForTests();
  let consulted = 0;
  const fake = { enabled: () => false, consult: async () => { consulted += 1; return { signature: {} }; } };
  assert.equal(await warmFiscalPrintEvidence(sale(), { client: fake as any, timeoutMs: 5000, delay: immediate }), false);
  assert.equal(consulted, 0);
});

test('App.tsx inicia el warm-up al finalizar la venta en lugar de depender del sync periódico', () => {
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.match(app, /import \{ warmFiscalPrintEvidence \} from '\.\/services\/fiscal\/FiscalPrintEvidenceWarmup';/);
  assert.match(app, /void warmFiscalPrintEvidence\(transaction\)\.catch\(\(\) => false\);/);
  assert.match(app, /await fiscalWorkflowV2Client\.consult\(transaction\.id\);void warmFiscalPrintEvidence\(transaction\)/);
});

test('constantes de presupuesto: ventana acotada y consulta cada 1,5 s', () => {
  assert.equal(FISCAL_PRINT_WARMUP_TIMEOUT_MS, 20000);
  assert.equal(FISCAL_PRINT_WARMUP_INTERVAL_MS, 1500);
  assert.equal(FISCAL_PRINT_WARMUP_RECENT_MS, 300000);
});
