import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  CanonicalErpTerminalIdError,
  isCanonicalErpTerminalId,
  requireCanonicalErpTerminalId,
  resolveCanonicalErpTerminalId,
  separateTerminalIdentity,
} from '../services/sync/terminalIdentity';
import {
  normalizeTerminalCredentialsIdentity,
  readTerminalCredentialsSync,
} from '../services/sync/TerminalCredentialStore';
import { resolveRegisterErpTerminalId } from '../services/sync/erpRegisterResponse';

const ERP_UUID = '3d927d44-cdb7-48c1-924d-d2d053871234';
const CLOUD_CATALOG_GHOST_UUID = 'efdc61ae-f485-41ea-b50e-3ca4e08123e2';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
}

test('acepta UUID ERP en snake_case, camelCase y dentro de auth', () => {
  assert.equal(resolveRegisterErpTerminalId({ erp_terminal_id: ERP_UUID }), ERP_UUID);
  assert.equal(resolveRegisterErpTerminalId({ erpTerminalId: ERP_UUID }), ERP_UUID);
  assert.equal(resolveRegisterErpTerminalId({ auth: { erp_terminal_id: ERP_UUID } }), ERP_UUID);
  assert.equal(resolveRegisterErpTerminalId({ auth: { erpTerminalId: ERP_UUID } }), ERP_UUID);
  assert.equal(resolveRegisterErpTerminalId({ terminal_id: ERP_UUID }), ERP_UUID);
  assert.equal(resolveRegisterErpTerminalId({ terminalId: ERP_UUID }), ERP_UUID);
});

test('POS-001, Slav-01 y DEV-* nunca pasan como UUID técnico', () => {
  for (const invalid of ['POS-001', 'Slav-01', '1', 'DEV-R9CUIS87']) {
    assert.equal(isCanonicalErpTerminalId(invalid), false);
    assert.equal(resolveCanonicalErpTerminalId(invalid), undefined);
  }
  assert.throws(() => requireCanonicalErpTerminalId({ terminal_id: 'POS-001' }), CanonicalErpTerminalIdError);
});

test('mantiene UUID, código, estación, nombre y device separados', () => {
  assert.deepEqual(separateTerminalIdentity({
    erpTerminalId: ERP_UUID,
    terminalId: 'POS-001',
    terminalCode: 'POS-001',
    stationNumber: '1',
    terminalName: 'Slav-01',
    deviceId: 'DEV-R9CUIS87',
  }), {
    erpTerminalId: ERP_UUID,
    terminalId: ERP_UUID,
    terminalCode: 'POS-001',
    stationNumber: '1',
    terminalName: 'Slav-01',
    deviceId: 'DEV-R9CUIS87',
    requiresPairing: false,
    migratedLegacyIdentity: false,
  });
});

test('migración histórica POS-001 conserva datos y exige pairing sin fabricar UUID', () => {
  const storage = new MemoryStorage();
  storage.setItem('clic_erp_sync_terminal_id', 'POS-001');
  storage.setItem('CLIC_POS_TERMINAL_ID', 'POS-001');
  storage.setItem('clic_erp_sync_terminal_name', 'Slav-01');
  storage.setItem('CLIC_POS_DEVICE_ID', 'DEV-R9CUIS87');
  storage.setItem('sales', JSON.stringify([{ id: 'sale-1' }]));
  storage.setItem('payments', JSON.stringify([{ id: 'payment-1' }]));
  storage.setItem('erp_outbox', JSON.stringify([{ id: 'event-1' }]));
  storage.setItem('documents', JSON.stringify([{ id: 'doc-1' }]));
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });

  const credentials = readTerminalCredentialsSync();
  assert.equal(credentials.terminalId, null);
  assert.equal(credentials.erpTerminalId, null);
  assert.equal(credentials.terminalCode, 'POS-001');
  assert.equal(credentials.terminalName, 'Slav-01');
  assert.equal(credentials.deviceId, 'DEV-R9CUIS87');
  assert.equal(credentials.authStatus, 'PAIRING_REQUIRED');
  assert.equal(storage.getItem('clic_erp_sync_terminal_id'), null);
  assert.equal(storage.getItem('sales'), JSON.stringify([{ id: 'sale-1' }]));
  assert.equal(storage.getItem('payments'), JSON.stringify([{ id: 'payment-1' }]));
  assert.equal(storage.getItem('erp_outbox'), JSON.stringify([{ id: 'event-1' }]));
  assert.equal(storage.getItem('documents'), JSON.stringify([{ id: 'doc-1' }]));
});

test('reinicio conserva un UUID ERP persistido y no lo reconstruye desde estación', () => {
  const first = normalizeTerminalCredentialsIdentity({
    terminalId: ERP_UUID,
    erpTerminalId: ERP_UUID,
    terminalCode: 'POS-001',
    stationNumber: '1',
    terminalName: 'Slav-01',
    deviceId: 'DEV-R9CUIS87',
  });
  const restarted = normalizeTerminalCredentialsIdentity(first);
  assert.equal(restarted.terminalId, ERP_UUID);
  assert.equal(restarted.erpTerminalId, ERP_UUID);
  assert.equal(restarted.terminalCode, 'POS-001');

  const clearedSession = normalizeTerminalCredentialsIdentity({
    terminalCode: 'POS-001',
    stationNumber: '1',
    terminalName: 'Slav-01',
    deviceId: 'DEV-R9CUIS87',
  });
  assert.equal(clearedSession.terminalId, null);
  assert.equal(clearedSession.erpTerminalId, null);
  assert.equal(clearedSession.deviceId, 'DEV-R9CUIS87');
});

test('UUID fantasma solo se reconoce cuando aparece explícitamente en una respuesta ERP', () => {
  const historical = separateTerminalIdentity({
    terminalId: 'POS-001',
    terminalCode: 'POS-001',
    terminalName: 'Slav-01',
  });
  assert.equal(historical.erpTerminalId, null);
  assert.notEqual(historical.erpTerminalId, CLOUD_CATALOG_GHOST_UUID);
  assert.equal(
    resolveRegisterErpTerminalId({ erp_terminal_id: CLOUD_CATALOG_GHOST_UUID }),
    CLOUD_CATALOG_GHOST_UUID,
  );
});

test('register, heartbeat, outbox y sync usan el binding UUID y mantienen el código aparte', () => {
  const lifecycleSource = readFileSync(new URL('../utils/erpSyncLifecycle.ts', import.meta.url), 'utf8');
  const register = lifecycleSource.slice(
    lifecycleSource.indexOf('export const registerErpSyncTerminal'),
    lifecycleSource.indexOf('export const heartbeatErpSyncTerminal'),
  );
  const heartbeat = lifecycleSource.slice(
    lifecycleSource.indexOf('export const heartbeatErpSyncTerminal'),
    lifecycleSource.indexOf('export const processErpSyncOutbox'),
  );
  const outbox = lifecycleSource.slice(
    lifecycleSource.indexOf('const pullErpOutbox'),
    lifecycleSource.indexOf('export const getConfigPushV2PendingEventCount'),
  );

  assert.match(register, /terminal_id:\s*existingCanonicalTerminalId/);
  assert.match(register, /terminal_code:\s*params\.localTerminalId/);
  assert.match(register, /resolveCanonicalErpTerminalId\(payload\)/);
  assert.match(heartbeat, /terminal_id:\s*terminalRef/);
  assert.match(heartbeat, /if \(!terminalRef\)/);
  assert.match(outbox, /terminal_id:\s*bindingTerminalId/);
  assert.doesNotMatch(heartbeat, /terminal_id:\s*params\.localTerminalId/);
});

test('dos resoluciones consecutivas conservan exactamente el mismo UUID', () => {
  const payload = { terminal: { id: ERP_UUID }, terminal_code: 'POS-001', terminal_name: 'Slav-01' };
  assert.equal(resolveCanonicalErpTerminalId(payload), ERP_UUID);
  assert.equal(resolveCanonicalErpTerminalId(payload), ERP_UUID);
});
