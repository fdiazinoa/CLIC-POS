import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isRecoverableNetworkConnectivityMessage,
  isRecoverableStaleSyncDiagnostic,
} from '../services/sync/SyncErrorDiagnostic';

const installLocalStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
};

test('classifies CapacitorHttp connection failure after a network change as recoverable', () => {
  assert.equal(
    isRecoverableNetworkConnectivityMessage(
      'Failed to connect to clic-erp.vercel.app/64.29.17.3:443',
    ),
    true,
  );
});

test('classifies common temporary connection failures as recoverable', () => {
  assert.equal(isRecoverableNetworkConnectivityMessage('connect timed out'), true);
  assert.equal(isRecoverableNetworkConnectivityMessage('Network is unreachable'), true);
  assert.equal(isRecoverableNetworkConnectivityMessage('Failed to fetch'), true);
});

test('does not classify an ERP application error as a connectivity failure', () => {
  assert.equal(isRecoverableNetworkConnectivityMessage('HTTP 500 Internal Server Error'), false);
  assert.equal(isRecoverableNetworkConnectivityMessage('DEVICE_NOT_AUTHORIZED'), false);
});

test('discards a persisted native connection diagnostic when the terminal is already bound', () => {
  installLocalStorage({ active_terminal_id: 'POS-003' });

  assert.equal(
    isRecoverableStaleSyncDiagnostic({
      errorMessage: 'Failed to connect to clic-erp.vercel.app/64.29.17.3:443',
    } as any),
    true,
  );
});
