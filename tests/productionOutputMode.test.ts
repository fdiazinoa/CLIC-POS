import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeProductionOutputMode, resolveProductionOutputTargets } from '../utils/productionOutputMode';

test('modo AMBOS activa impresora y KDS', () => {
  assert.deepEqual(resolveProductionOutputTargets('AMBOS'), {
    mode: 'AMBOS',
    shouldPrint: true,
    shouldSendKds: true,
  });
});

test('acepta aliases legacy del contrato combinado', () => {
  assert.equal(normalizeProductionOutputMode('BOTH'), 'AMBOS');
  assert.equal(normalizeProductionOutputMode('KDS + PRINTER'), 'AMBOS');
  assert.equal(normalizeProductionOutputMode('Pantalla e impresora'), 'AMBOS');
});

test('mantiene salidas individuales', () => {
  assert.deepEqual(resolveProductionOutputTargets('IMPRESORA'), {
    mode: 'PRINTER',
    shouldPrint: true,
    shouldSendKds: false,
  });
  assert.deepEqual(resolveProductionOutputTargets('KDS'), {
    mode: 'KDS',
    shouldPrint: false,
    shouldSendKds: true,
  });
});
