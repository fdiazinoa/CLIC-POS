import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createMasterAuthorityFingerprint,
  persistClientBindingRecovery,
  readClientBindingRecovery,
  validateClientBindingAck,
} from '../services/setup/clientBindingRecovery';
import { validateOperationalMasterEndpoint, type OperationalMasterContract } from '../utils/masterOperationalApi';

const masterId = 'master-001';
const clientId = 'client-001';
const deviceId = 'DEV-CLIENT';
const remote = (role = 'STANDARD_POS') => ({
  runtimeTerminalId: masterId,
  masterSetupContext: { tenantId: 'tenant-1', companyId: 'company-1', storeId: 'store-1' },
  terminals: [{
    id: masterId,
    tenantId: 'tenant-1',
    companyId: 'company-1',
    storeId: 'store-1',
    config: { isPrimaryNode: true, governedByMaster: false, terminalType: role, currentDeviceId: 'DEV-MASTER' },
  }],
});
const contract: OperationalMasterContract = {
  erpManaged: false,
  terminalId: clientId,
  masterTerminalId: masterId,
  tenantId: 'tenant-1',
  companyId: 'company-1',
  storeId: 'store-1',
  deviceId,
  localIps: ['10.0.0.20'],
};

test('pairing estricto rechaza identidad ausente/ambigua, KDS, self y scope ajeno', () => {
  assert.equal(
    validateOperationalMasterEndpoint('10.0.0.10', remote(), contract, { strictPairing: true }),
    'http://10.0.0.10:3001',
  );
  assert.throws(() => validateOperationalMasterEndpoint('10.0.0.20', remote(), contract, { strictPairing: true }), /SELF_ENDPOINT/);
  assert.throws(() => validateOperationalMasterEndpoint('10.0.0.10', { terminals: [] }, contract, { strictPairing: true }), /IDENTITY_MISSING/);
  const ambiguous = remote();
  ambiguous.runtimeTerminalId = 'master-stale';
  assert.throws(() => validateOperationalMasterEndpoint('10.0.0.10', ambiguous, contract, { strictPairing: true }), /IDENTITY_(MISSING|AMBIGUOUS|MISMATCH)/);
  assert.throws(() => validateOperationalMasterEndpoint('10.0.0.10', remote('KITCHEN_DISPLAY'), contract, { strictPairing: true }), /ROLE_INVALID/);
  const foreign = remote();
  foreign.masterSetupContext.companyId = 'company-foreign';
  assert.throws(() => validateOperationalMasterEndpoint('10.0.0.10', foreign, contract, { strictPairing: true }), /SCOPE_MISMATCH/);
});

test('ACK cliente exige device, rol gobernado y masterTerminalId exactos', () => {
  const config = {
    terminals: [{
      id: clientId,
      config: { currentDeviceId: deviceId, isPrimaryNode: false, governedByMaster: true, masterTerminalId: masterId },
    }],
  } as any;
  assert.equal(validateClientBindingAck({ response: { current_device_id: deviceId, config }, terminalId: clientId, deviceId, masterTerminalId: masterId }), config);
  assert.throws(() => validateClientBindingAck({ response: { current_device_id: 'OTHER', config }, terminalId: clientId, deviceId, masterTerminalId: masterId }), /DEVICE_MISMATCH/);
  assert.throws(() => validateClientBindingAck({ response: { current_device_id: deviceId, config: { terminals: [{ id: clientId, config: { ...config.terminals[0].config, governedByMaster: false } }] } }, terminalId: clientId, deviceId, masterTerminalId: masterId }), /ROLE_INVALID/);
  assert.throws(() => validateClientBindingAck({ response: { current_device_id: deviceId, config: { terminals: [{ id: clientId, config: { ...config.terminals[0].config, masterTerminalId: 'OTHER' } }] } }, terminalId: clientId, deviceId, masterTerminalId: masterId }), /MASTER_MISMATCH/);
});

test('estado ACK pendiente sobrevive restart, no contiene secretos y conserva autoridad exacta', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const fingerprint = createMasterAuthorityFingerprint(remote());
  persistClientBindingRecovery({
    authorityUrl: 'http://10.0.0.10:3001', authorityFingerprint: fingerprint,
    masterTerminalId: masterId, terminalId: clientId, deviceId,
    tenantId: 'tenant-1', companyId: 'company-1', storeId: 'store-1',
  }, storage as Storage);
  const restarted = readClientBindingRecovery(storage as Storage);
  assert.equal(restarted?.status, 'BIND_ACKED_RESTORE_PENDING');
  assert.equal(restarted?.authorityFingerprint, fingerprint);
  assert.doesNotMatch(JSON.stringify(restarted), /token|secret|credential/i);
});

test('cliente usa un solo POST bind, reanuda restore sin POST y no publica PUT config global', () => {
  const selector = readFileSync(new URL('../components/TerminalSelector.tsx', import.meta.url), 'utf8');
  const screen = readFileSync(new URL('../components/TerminalBindingScreen.tsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const bindCalls = selector.match(/`\$\{apiBase\}\/bind-terminal`/g) || [];
  assert.equal(bindCalls.length, 1);
  assert.match(screen, /readClientBindingRecovery\(\)[\s\S]*\/api\/setup\/initial-config/);
  assert.doesNotMatch(screen.slice(screen.indexOf('const applyMasterConnection'), screen.indexOf('const handleModeSelect')), /onConfigUpdate|onUsersUpdate|CLIC_POS_MASTER_URL|pos_master_ip/);
  assert.match(app, /if \(configSyncUrl && !isSlave\)/);
  assert.match(app, /clientMasterAuthority:[\s\S]*status: 'VALIDATED'/);
  assert.match(app, /if \(isSlave\) clearClientBindingRecovery\(\)/);
});

test('Express y servidor nativo conservan identidad/contrato de bind autoritativo', () => {
  const server = readFileSync(new URL('../server/index.ts', import.meta.url), 'utf8');
  const setup = readFileSync(new URL('../server/routes/setupRoutes.ts', import.meta.url), 'utf8');
  const nativeServer = readFileSync(new URL('../native-stubs/android/ClicPOSMasterHttpServer.kt', import.meta.url), 'utf8');
  assert.match(server, /collection === 'config'[\s\S]*runtimeTerminalId/);
  assert.match(setup, /router\.post\('\/bind-terminal'/);
  assert.match(setup, /masterTerminalId[\s\S]*governedByMaster/);
  assert.match(nativeServer, /\/api\/setup\/bind-terminal/);
});
