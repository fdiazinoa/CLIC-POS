import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../components/ZReportDashboard.tsx', import.meta.url), 'utf8');

test('el cierre no ciego muestra solo el resumen financiero y las formas de pago', () => {
  assert.match(source, /const isBlindClose = Boolean/);
  assert.match(source, /\{!isBlindClose && \(/);
  assert.match(source, /Resumen\s*</);
  assert.match(source, />Ventas brutas</);
  assert.match(source, />Devoluciones</);
  assert.match(source, />Ventas netas</);
  assert.match(source, />Transacciones</);
  assert.match(source, /Formas de pago\s*</);
  assert.match(source, />Total formas de pago</);
});

test('la captura prioriza formas declarables y luego el efectivo multimoneda', () => {
  assert.match(source, /className="order-1 bg-white[^\"]+"/);
  assert.match(source, /className=\{`order-2 bg-white/);
  assert.match(source, /Formas de pago a declarar/);
  assert.match(source, /Desglose de efectivo/);
  assert.match(source, /currenciesRequiringCashCount\.map/);
  assert.match(source, /getDenominationsForCurrency\(currencyCode\)/);
});

test('el cierre ciego no revela esperados ni diferencias durante la captura', () => {
  assert.match(source, /!isBlindClose && hasValue && !useDenominationCount/);
  assert.match(source, /\{!isBlindClose && \(\s*<div className="flex items-center justify-between text-xs">/);
  assert.match(source, /isBlindClose \? 'grid-cols-1' : 'grid-cols-2'/);
});
