import test from 'node:test';
import assert from 'node:assert/strict';
import { recordConfigPushNativeDiagnostic } from '../services/sync/ConfigPushNativeDiagnostic';

test('native sync diagnostics emit only allowlisted correlation and outcome, never arbitrary data', () => {
  const prior = (globalThis as any).window;
  const calls: string[] = [];
  (globalThis as any).window = { AndroidPrinter: { debugLog: (value: string) => calls.push(value) } };
  try {
    recordConfigPushNativeDiagnostic('config_snapshot_apply_failed', {
      event_id: '00000000-0000-4000-8000-000000000001', snapshot_id: 'merchant-name',
      status: 'FAILED', reason: 'CONFIG_SCOPE', code: 'SYNC_V3_BINDING_CHANGED',
      http_status: 0, duration_ms: 15, count: -1, headers: { Authorization: 'secret' },
      token: 'secret', payload: { person: 'private' }, error: 'https://private/?token=secret',
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(calls[0]), { tag: 'ClicPOSSync',
      message: '[CLIC_SYNC_AUTHORITY] config_snapshot_apply_failed', data: {
        event_id: '00000000-0000-4000-8000-000000000001', status: 'FAILED', http_status: 0,
        duration_ms: 15, code: 'SYNC_V3_BINDING_CHANGED', reason: 'CONFIG_SCOPE',
      } });
    recordConfigPushNativeDiagnostic('untrusted-event-secret', { status: 'FAILED' });
    assert.equal(calls.length, 1);
    recordConfigPushNativeDiagnostic('OUTBOX_PULL_COMPLETED', { status: 'FAILED', reason: 'secret', code: 'secret', http_status: 0 });
    assert.deepEqual(JSON.parse(calls[1]).data, { status: 'FAILED', http_status: 0 });
  } finally { (globalThis as any).window = prior; }
});

test('missing or broken native diagnostic bridge never interrupts synchronization', () => {
  const prior = (globalThis as any).window;
  try {
    delete (globalThis as any).window;
    assert.doesNotThrow(() => recordConfigPushNativeDiagnostic('OUTBOX_PULL_STARTED', {}));
    (globalThis as any).window = { AndroidPrinter: { debugLog: () => { throw Error('bridge unavailable'); } } };
    assert.doesNotThrow(() => recordConfigPushNativeDiagnostic('OUTBOX_PULL_STARTED', {}));
  } finally { (globalThis as any).window = prior; }
});
