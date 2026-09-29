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
import { canPublishGlobalConfigMutation } from '../utils/masterOperationalApi';
import { dispatchClientBindingMutation } from '../services/setup/clientBindingMutation';
import {
  LegacyMutationJournal,
  type LegacyMutationJournalEntry,
  type LegacyMutationJournalStore,
} from '../services/sync/LegacyMutationJournal';

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
      config: {
        currentDeviceId: deviceId, isPrimaryNode: false, governedByMaster: true, masterTerminalId: masterId,
        erpBinding: { tenantId: 'tenant-1', companyId: 'company-1', storeId: 'store-1' },
      },
    }],
  } as any;
  const response = { success: true, terminal_id: clientId, master_terminal_id: masterId, current_device_id: deviceId, tenant_id: 'tenant-1', company_id: 'company-1', store_id: 'store-1', config };
  const input = { terminalId: clientId, deviceId, masterTerminalId: masterId, tenantId: 'tenant-1', companyId: 'company-1', storeId: 'store-1' };
  assert.equal(validateClientBindingAck({ response, ...input }), config);
  assert.throws(() => validateClientBindingAck({ response: { ...response, success: false }, ...input }), /SUCCESS_REQUIRED/);
  assert.throws(() => validateClientBindingAck({ response: { ...response, terminal_id: 'OTHER' }, ...input }), /TERMINAL_MISMATCH/);
  assert.throws(() => validateClientBindingAck({ response: { ...response, master_terminal_id: 'OTHER' }, ...input }), /MASTER_MISMATCH/);
  assert.throws(() => validateClientBindingAck({ response: { ...response, current_device_id: 'OTHER' }, ...input }), /DEVICE_MISMATCH/);
  assert.throws(() => validateClientBindingAck({ response: { ...response, config: { terminals: [{ id: 'OTHER', config: config.terminals[0].config }] } }, ...input }), /TERMINAL_MISSING/);
  assert.throws(() => validateClientBindingAck({ response: { ...response, config: { terminals: [{ id: clientId, config: { ...config.terminals[0].config, governedByMaster: false } }] } }, ...input }), /ROLE_INVALID/);
  assert.throws(() => validateClientBindingAck({ response: { ...response, config: { terminals: [{ id: clientId, config: { ...config.terminals[0].config, masterTerminalId: 'OTHER' } }] } }, ...input }), /MASTER_MISMATCH/);
});

test('guard central impide publicar config global desde CLIENT y ORDER_TAKER', () => {
  const storage = (mode: string) => ({ getItem: (key: string) => key === 'clic_pos_terminal_setup_mode' ? mode : null });
  assert.equal(canPublishGlobalConfigMutation(storage('CLIENT') as Storage), false);
  assert.equal(canPublishGlobalConfigMutation(storage('ORDER_TAKER') as Storage), false);
  assert.equal(canPublishGlobalConfigMutation(storage('SERVER_LOCAL') as Storage), true);
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const units = readFileSync(new URL('../components/UnitSelector.tsx', import.meta.url), 'utf8');
  assert.match(app, /const syncConfigToLocalServer[\s\S]*if \(!canPublishGlobalConfigMutation\(\)\)/);
  assert.match(app, /window\.addEventListener\('configUpdated'[\s\S]*syncConfigToLocalServer/);
  assert.match(app, /const handleConfigUpdate[\s\S]*syncConfigToLocalServer\(newConfig\)/);
  assert.match(app, /if \(configSyncUrl && canPublishGlobalConfigMutation\(\)\)/);
  assert.match(units, /if \(!canPublishGlobalConfigMutation\(\)\)[\s\S]*return;[\s\S]*resolveValidatedOperationalApiUrl\('\/api\/config'\)/);
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
  assert.match(selector, /dispatchClientBindingMutation/);
  assert.match(screen, /readClientBindingRecovery\(\)[\s\S]*\/api\/setup\/initial-config/);
  assert.doesNotMatch(screen.slice(screen.indexOf('const applyMasterConnection'), screen.indexOf('const handleModeSelect')), /onConfigUpdate|onUsersUpdate|CLIC_POS_MASTER_URL|pos_master_ip/);
  assert.match(app, /if \(configSyncUrl && canPublishGlobalConfigMutation\(\)\)/);
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
  assert.match(setup, /nextConfig\.masterTerminalId = masterTerminalId/);
  assert.match(setup, /nextConfig\.master_terminal_id = masterTerminalId/);
  assert.match(setup, /master_terminal_id: bindingMode === 'SLAVE'/);
  assert.match(setup, /terminal_id: targetErpTerminalId/);
  assert.match(nativeServer, /\/api\/setup\/bind-terminal/);
});

class JournalStore implements LegacyMutationJournalStore {
  rows = new Map<string, LegacyMutationJournalEntry>();
  async getCollection<T>(): Promise<T[]> { return [...this.rows.values()] as T[]; }
  async saveDocument<T extends { id: string }>(_name: string, doc: T): Promise<void> { this.rows.set(doc.id, { ...doc } as any); }
  async deleteDocument(_name: string, id: string): Promise<void> { this.rows.delete(id); }
}

const boundConfig = {
  runtimeTerminalId: masterId,
  masterSetupContext: { tenantId: 'tenant-1', companyId: 'company-1', storeId: 'store-1' },
  terminals: [
    { id: masterId, config: { isPrimaryNode: true, governedByMaster: false, currentDeviceId: 'DEV-MASTER' } },
    { id: clientId, config: { currentDeviceId: deviceId, isPrimaryNode: false, governedByMaster: true, masterTerminalId: masterId, erpBinding: { tenantId: 'tenant-1', companyId: 'company-1', storeId: 'store-1' } } },
  ],
} as any;

test('bind ambiguo se reconcilia por readback y restart no repite takeover', async () => {
  const originalStorage = globalThis.localStorage;
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } });
  const store = new JournalStore();
  const first = new LegacyMutationJournal(store);
  await first.initializeForStartup();
  const contractInput = { authorityUrl: 'http://10.0.0.10:3001', authorityFingerprint: createMasterAuthorityFingerprint(remote()), terminalId: clientId, deviceId, masterTerminalId: masterId, tenantId: 'tenant-1', companyId: 'company-1', storeId: 'store-1' };
  const originalFetch = globalThis.fetch;
  let postCount = 0;
  globalThis.fetch = (async () => { postCount += 1; throw new TypeError('response lost after remote commit'); }) as any;
  await assert.rejects(() => dispatchClientBindingMutation({ contract: contractInput, endpointUrl: 'http://10.0.0.10:3001/api/setup/bind-terminal', body: {}, journal: first, request: async () => ({ ok: false, status: 503, data: null, text: '', headers: {}, networkEngine: 'fetch', fetchStage: 'test' }) }), /response lost/);
  const restarted = new LegacyMutationJournal(store);
  await restarted.initializeForStartup();
  const result = await dispatchClientBindingMutation({ contract: contractInput, endpointUrl: 'http://10.0.0.10:3001/api/setup/bind-terminal', body: {}, journal: restarted, request: async () => ({ ok: true, status: 200, data: boundConfig, text: '{}', headers: {}, networkEngine: 'fetch', fetchStage: 'test' }) });
  assert.equal(result.ok, true);
  assert.equal(postCount, 1);
  assert.equal(restarted.hasOutcomeUnknown(), false);
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalStorage });
});
