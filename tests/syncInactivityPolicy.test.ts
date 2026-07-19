import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canEnterReducedSyncMode,
  resolveReducedSyncAfterMinutes,
} from '../utils/syncInactivityPolicy';

test('lee el tiempo independiente desde seguridad y acepta contrato snake_case', () => {
  assert.equal(resolveReducedSyncAfterMinutes({ config: { security: { reduceSyncAfterMinutes: 20 } } }), 20);
  assert.equal(resolveReducedSyncAfterMinutes({ config: { security: { reduce_sync_after_minutes: 12 } } }), 12);
  assert.equal(resolveReducedSyncAfterMinutes({ config: {} }), 0);
});

test('entra en modo reducido solo después del umbral sin actividad crítica', () => {
  assert.equal(canEnterReducedSyncMode({
    idleMs: 600_000,
    thresholdMs: 600_000,
    saleActive: false,
    pendingCriticalCount: 0,
    criticalSyncInProgress: false,
  }), true);
});

test('una venta, cola pendiente o sincronización crítica bloquean el modo reducido', () => {
  const base = { idleMs: 600_000, thresholdMs: 300_000 };
  assert.equal(canEnterReducedSyncMode({ ...base, saleActive: true, pendingCriticalCount: 0, criticalSyncInProgress: false }), false);
  assert.equal(canEnterReducedSyncMode({ ...base, saleActive: false, pendingCriticalCount: 1, criticalSyncInProgress: false }), false);
  assert.equal(canEnterReducedSyncMode({ ...base, saleActive: false, pendingCriticalCount: 0, criticalSyncInProgress: true }), false);
});
