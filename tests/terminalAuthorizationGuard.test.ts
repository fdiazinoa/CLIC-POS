import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  clearPersistedTerminalAuthorizationBlock,
  isDeviceExplicitlyAuthorizedByBootstrap,
  isTerminalAuthorizationSuperseded,
  persistTerminalAuthorizationBlock,
  readPersistedTerminalAuthorizationBlock,
  TERMINAL_AUTHORIZATION_BLOCK_STORAGE_KEY,
} from '../utils/terminalAuthorizationGuard';

const createStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    values,
  };
};

test('el bloqueo DEVICE_SUPERSEDED sobrevive a una recarga y solo se elimina explícitamente', () => {
  const storage = createStorage();
  persistTerminalAuthorizationBlock({
    terminalId: 'terminal-1',
    terminalLabel: 'POS-001',
    message: 'La caja está activa en otro equipo.',
  }, storage);

  assert.deepEqual(readPersistedTerminalAuthorizationBlock(storage), {
    terminalId: 'terminal-1',
    terminalLabel: 'POS-001',
    message: 'La caja está activa en otro equipo.',
  });
  assert.ok(storage.values.has(TERMINAL_AUTHORIZATION_BLOCK_STORAGE_KEY));
  assert.equal(isTerminalAuthorizationSuperseded(storage), true);

  clearPersistedTerminalAuthorizationBlock(storage);
  assert.equal(readPersistedTerminalAuthorizationBlock(storage), null);
});

test('el último error DEVICE_SUPERSEDED impide la reautorización local aunque falte el bloque serializado', () => {
  const storage = createStorage();
  storage.setItem('clic_sync_last_auth_error', 'device_superseded');
  assert.equal(isTerminalAuthorizationSuperseded(storage), true);
});

test('un device_id de nivel superior no autoriza porque puede ser eco de la solicitud', () => {
  assert.equal(isDeviceExplicitlyAuthorizedByBootstrap({
    status: 'success',
    device_id: 'DEV-ANTERIOR',
    terminal: { id: 'terminal-1' },
  }, 'DEV-ANTERIOR'), false);
});

test('el dispositivo se autoriza únicamente cuando coincide con una identidad canónica', () => {
  assert.equal(isDeviceExplicitlyAuthorizedByBootstrap({
    status: 'success',
    device_authorized: true,
    authorized_device_id: 'DEV-NUEVO',
    terminal: { id: 'terminal-1' },
  }, 'dev-nuevo'), true);

  assert.equal(isDeviceExplicitlyAuthorizedByBootstrap({
    status: 'success',
    terminal: { id: 'terminal-1', device_id: 'DEV-NUEVO' },
  }, 'DEV-ANTERIOR'), false);
});

test('requires_reauth o device_authorized=false prevalecen sobre una identidad coincidente', () => {
  assert.equal(isDeviceExplicitlyAuthorizedByBootstrap({
    status: 'success',
    requires_reauth: true,
    authorized_device_id: 'DEV-ANTERIOR',
  }, 'DEV-ANTERIOR'), false);

  assert.equal(isDeviceExplicitlyAuthorizedByBootstrap({
    status: 'success',
    device_authorized: false,
    authorized_device_id: 'DEV-ANTERIOR',
  }, 'DEV-ANTERIOR'), false);
});

test('el botón reintentar valida con ERP y el lifecycle queda detenido mientras exista bloqueo', () => {
  const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const blockView = appSource.slice(
    appSource.indexOf('if (terminalAuthorizationBlock) {'),
    appSource.indexOf('if (licenseError) {'),
  );
  assert.match(blockView, /onClick=\{\(\) => void retryTerminalAuthorization\(\)\}/);
  assert.doesNotMatch(blockView, /window\.location\.reload\(\)/);
  assert.match(appSource, /setupPending \|\| !erpLifecycleReady \|\| terminalAuthorizationBlock/);
});

test('la sincronización no reconcilia ni registra automáticamente un dispositivo reemplazado', () => {
  const adapterSource = readFileSync(new URL('../services/sync/ApiSyncAdapter.ts', import.meta.url), 'utf8');
  assert.match(adapterSource, /isTerminalAuthorizationSuperseded\(\)/);
  assert.match(adapterSource, /!deviceWasSuperseded && this\.reconcileStaleOperationalAuthState/);
  assert.match(adapterSource, /!deviceWasSuperseded && this\.canAttemptOperationalReauth\(\)/);
});
