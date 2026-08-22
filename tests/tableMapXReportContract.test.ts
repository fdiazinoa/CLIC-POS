import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const tableMapSource = readFileSync(new URL('../components/TableMap.tsx', import.meta.url), 'utf8');
const financeSource = readFileSync(new URL('../components/FinanceDashboard.tsx', import.meta.url), 'utf8');

test('el mapa de mesas no muestra Cierre X y el flujo permanece disponible en Finanzas', () => {
  assert.doesNotMatch(tableMapSource, /Cierre X/);
  assert.doesNotMatch(tableMapSource, /onOpenXReport/);
  assert.match(financeSource, /Hacer Cierre X/);
});
