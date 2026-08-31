import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isRecoverableNetworkConnectivityMessage,
  isRecoverableStaleSyncDiagnostic,
  isNonBlockingBoundLocalMasterDiagnostic,
  isTerminalAuthorizationLossDiagnostic,
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
      'Failed to connect to clic-erp.clicsuite.com/64.29.17.3:443',
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
      errorMessage: 'Failed to connect to clic-erp.clicsuite.com/64.29.17.3:443',
    } as any),
    true,
  );
});

test('detects a rejected sync token as a possible terminal authorization loss', () => {
  assert.equal(
    isTerminalAuthorizationLossDiagnostic({
      httpStatus: 401,
      responseBody: JSON.stringify({ code: 'SYNC_TOKEN_INVALID', message: 'Invalid or missing sync token' }),
      errorMessage: 'SYNC_TOKEN_REJECTED: El ERP rechazó el token de sincronización.',
      backendCode: null,
    }),
    true,
  );
  assert.equal(
    isTerminalAuthorizationLossDiagnostic({
      httpStatus: null,
      responseBody: null,
      errorMessage: 'SYNC_TOKEN_REJECTED: El ERP rechazó el token de sincronización.',
      backendCode: null,
    }),
    true,
  );
  assert.equal(
    isTerminalAuthorizationLossDiagnostic({
      httpStatus: 500,
      responseBody: 'Internal Server Error',
      errorMessage: 'Metadata failed',
      backendCode: null,
    }),
    false,
  );
});

test('detects an invalid device token before showing a technical sync diagnostic', () => {
  assert.equal(
    isTerminalAuthorizationLossDiagnostic({
      httpStatus: 401,
      responseBody: JSON.stringify({
        code: 'DEVICE_TOKEN_INVALID',
        nextAction: 'ROTATE_DEVICE_TOKEN_OR_REBIND',
      }),
      errorMessage: 'DEVICE_TOKEN_INVALID: El token de esta terminal no coincide con el registrado en el ERP.',
      backendCode: 'DEVICE_TOKEN_INVALID',
    }),
    true,
  );
});

test('keeps device-not-authorized classified after a background retry loses the HTTP status', () => {
  assert.equal(
    isTerminalAuthorizationLossDiagnostic({
      httpStatus: null,
      responseBody: null,
      errorMessage: 'DEVICE_NOT_AUTHORIZED: Esta Caja esta vinculada, pero este equipo no esta autorizado.',
      backendCode: 'DEVICE_NOT_AUTHORIZED',
    }),
    true,
  );
});

const boundLocalMasterDiagnostic = (overrides: Record<string, unknown> = {}) => ({
  operation: 'PULL_MASTERS',
  collection: 'customers',
  resolvedTargetKind: 'POS_MASTER',
  terminalBindingStatus: 'BOUND',
  isCriticalMaster: false,
  backendCode: null,
  httpStatus: null,
  responseBody: null,
  errorMessage: 'Authentication failed. Please check connection to Master.',
  ...overrides,
}) as any;

test('keeps a transient non-critical local Master pull silent on a bound terminal', () => {
  assert.equal(
    isNonBlockingBoundLocalMasterDiagnostic(boundLocalMasterDiagnostic()),
    true,
  );
});

test('does not silence products, critical masters, or unbound terminal failures', () => {
  assert.equal(
    isNonBlockingBoundLocalMasterDiagnostic(boundLocalMasterDiagnostic({ collection: 'products' })),
    false,
  );
  assert.equal(
    isNonBlockingBoundLocalMasterDiagnostic(boundLocalMasterDiagnostic({ isCriticalMaster: true })),
    false,
  );
  assert.equal(
    isNonBlockingBoundLocalMasterDiagnostic(boundLocalMasterDiagnostic({ terminalBindingStatus: 'UNBOUND' })),
    false,
  );
});

test('does not silence local Master authorization loss', () => {
  assert.equal(
    isNonBlockingBoundLocalMasterDiagnostic(boundLocalMasterDiagnostic({
      backendCode: 'DEVICE_NOT_AUTHORIZED',
      errorMessage: 'DEVICE_NOT_AUTHORIZED: este equipo no está autorizado.',
    })),
    false,
  );
});
