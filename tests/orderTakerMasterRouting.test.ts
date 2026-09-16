import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildOperationalMasterContract, canUseLocalOperationalTableStore, createOperationalMasterResolver,
  isClientTerminalMode, resolveOperationalApiUrl, resolveValidatedOperationalApiUrl,
  setOperationalMasterResolver, setOperationalTerminalReader, validateOperationalMasterEndpoint, type OperationalMasterContract } from '../utils/masterOperationalApi';

const contract: OperationalMasterContract = { erpManaged: true,
  terminalId: '0efd23be-d73f-42aa-ab7d-5895b56edee0', masterTerminalId: '0f77877f-66b2-4820-b956-997cd5b4b575',
  tenantId: '9eda7d73-76e4-4432-ad13-4934fefe8f69', companyId: '6b6153ce-501e-4702-9ae9-34a3f1ab9042',
  storeId: 'de8dd318-12e7-4a3f-b0e8-4ea1bdb70c07', deviceId: 'DEV-CLIENT01', localIps: ['10.0.0.123'] };
const remote = (identity = contract.masterTerminalId): Record<string, any> => ({ runtimeTerminalId: identity,
  masterSetupContext: { erpEnabled: true, tenantId: contract.tenantId, companyId: contract.companyId, storeId: contract.storeId },
  terminals: [{ id: identity, config: { isPrimaryNode: true, terminalType: 'STANDARD_POS', currentDeviceId: 'DEV-MASTER01' } }] });

test('ORDER_TAKER/SLAVE no usa SQLite local ni loopback al perder puntero; SERVER explícito gana', () => {
  setOperationalMasterResolver(null);
  for (const setup of ['CLIENT', 'ORDER_TAKER']) {
    const source = { getItem: (key: string) => key === 'clic_pos_terminal_setup_mode' ? setup : null };
    assert.equal(isClientTerminalMode(source), true);
    assert.equal(canUseLocalOperationalTableStore(source), false);
    assert.throws(() => resolveOperationalApiUrl('/api/mesas', source, true), /NOT_VALIDATED/);
  }
  assert.equal(isClientTerminalMode({ getItem: key => key === 'clic_sync_mode' ? 'POS_SLAVE' : null }), true);
  for (const setup of ['SERVER_LOCAL', 'SERVER_ERP', 'SERVER']) {
    const source = { getItem: key => key === 'clic_pos_terminal_setup_mode' ? setup : 'POS_SLAVE' };
    assert.equal(isClientTerminalMode(source), false);
    assert.equal(resolveOperationalApiUrl('/api/mesas', source, true), 'http://127.0.0.1:3001/api/mesas');
  }
});

test('contrato ORDER_TAKER migrado gana a primary=true aun sin modo/puntero persistido', () => {
  const oldWindow = (globalThis as any).window;
  (globalThis as any).window = { localStorage: { getItem: () => null } };
  setOperationalTerminalReader(() => ({ config: { isPrimaryNode: true, deviceRole: { role: 'ORDER_TAKER' } } }));
  try { assert.equal(isClientTerminalMode(), true); assert.equal(canUseLocalOperationalTableStore(), false); }
  finally { setOperationalTerminalReader(null); (globalThis as any).window = oldWindow; }
});

test('rechaza self IP/loopback/UUID/device y roles auxiliares también LOCAL_ONLY', () => {
  for (const erpManaged of [true, false]) {
    const active = { ...contract, erpManaged };
    for (const host of ['10.0.0.123', '127.0.0.1', '127.0.0.2', 'localhost', '[::1]', '0.0.0.0'])
      assert.throws(() => validateOperationalMasterEndpoint(`http://${host}:3001`, remote(), active), /SELF_ENDPOINT/);
    assert.throws(() => validateOperationalMasterEndpoint('10.0.0.101', remote(contract.terminalId), active), /SELF_IDENTITY/);
    const own = remote(); own.terminals[0].config.currentDeviceId = contract.deviceId;
    assert.throws(() => validateOperationalMasterEndpoint('10.0.0.101', own, active), /SELF_IDENTITY/);
    for (const role of ['ORDER_TAKER', 'KITCHEN_DISPLAY']) {
      const invalid = remote(); invalid.terminals[0].config.terminalType = role;
      assert.throws(() => validateOperationalMasterEndpoint('10.0.0.101', invalid, active), /ROLE_INVALID/);
    }
  }
});

test('ERP exige UUID master y los tres scopes; registros ajenos/missing nunca se aceptan', () => {
  assert.equal(validateOperationalMasterEndpoint('https://10.0.0.101:3001/api/', remote(), contract), 'http://10.0.0.101:3001');
  assert.throws(() => validateOperationalMasterEndpoint('10.0.0.101', remote('9ffc6771-7845-4976-afd3-20cebc3cc6e8'), contract), /IDENTITY_MISMATCH/);
  assert.throws(() => validateOperationalMasterEndpoint('10.0.0.101', {}, contract), /IDENTITY_MISMATCH/);
  const staleToken = remote();
  staleToken.runtimeTerminalId = '9ffc6771-7845-4976-afd3-20cebc3cc6e8';
  staleToken.metadata = { deviceToken: `token-${contract.masterTerminalId.replaceAll('-', '').slice(0, 24)}` };
  assert.throws(() => validateOperationalMasterEndpoint('10.0.0.101', staleToken, contract), /IDENTITY_MISMATCH/);
  for (const field of ['tenantId', 'companyId', 'storeId'] as const) {
    assert.throws(() => validateOperationalMasterEndpoint('10.0.0.101', remote(), { ...contract, [field]: '' }), /CONTRACT_MISSING/);
    const foreign = remote(); foreign.masterSetupContext[field] = '7cdae43b-eded-44d7-8f1f-89fd79da28b3';
    assert.throws(() => validateOperationalMasterEndpoint('10.0.0.101', foreign, contract), /SCOPE_MISMATCH/);
    const missing = remote(); delete missing.masterSetupContext[field];
    assert.throws(() => validateOperationalMasterEndpoint('10.0.0.101', missing, contract), /SCOPE_MISMATCH/);
  }
});

test('LOCAL_ONLY explícito no exige ERP aun con IDs viejos; ORDER_TAKER primary=true conserva master', () => {
  const input = { terminal: { id: 'POS-003', config: { erpTerminalId: contract.terminalId } }, businessConfig: { masterSetupContext: { erpEnabled: false } },
    binding: { terminalId: contract.terminalId }, profile: {}, deviceId: contract.deviceId, localIps: contract.localIps };
  const local = buildOperationalMasterContract(input);
  assert.equal(local.erpManaged, false);
  assert.equal(validateOperationalMasterEndpoint('10.0.0.101', { terminals: [] }, local), 'http://10.0.0.101:3001');
  assert.throws(() => validateOperationalMasterEndpoint('10.0.0.101', { terminalType: 'ORDER_TAKER' }, local), /ROLE_INVALID/);
  assert.throws(() => validateOperationalMasterEndpoint('10.0.0.101', { masterSetupContext: { role: 'ORDER_TAKER' } }, local), /ROLE_INVALID/);
  assert.throws(() => validateOperationalMasterEndpoint('10.0.0.101', { runtimeTerminalId: 'OTHER-LOCAL-MASTER' }, { ...local, masterTerminalId: 'LINKED-LOCAL-MASTER' }), /IDENTITY_MISMATCH/);
  const erp = buildOperationalMasterContract({ ...input, terminal: { id: contract.terminalId, config: { isPrimaryNode: true, terminalType: 'ORDER_TAKER', master_terminal_id: contract.masterTerminalId } },
    businessConfig: { masterSetupContext: { erpEnabled: true } }, binding: contract });
  assert.equal(erp.masterTerminalId, contract.masterTerminalId);
  assert.equal(erp.erpManaged, true);
  const scopedContext = buildOperationalMasterContract({ ...input,
    terminal: { config: { erpBinding: { terminalId: contract.terminalId }, masterTerminalId: contract.masterTerminalId } },
    binding: {}, businessConfig: { masterSetupContext: { erpEnabled: true, tenantId: contract.tenantId, companyId: contract.companyId, storeId: contract.storeId } } });
  assert.equal(scopedContext.tenantId, contract.tenantId); assert.equal(scopedContext.companyId, contract.companyId); assert.equal(scopedContext.storeId, contract.storeId);
  assert.equal(validateOperationalMasterEndpoint('10.0.0.101', remote(), scopedContext), 'http://10.0.0.101:3001');
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.match(app, /shouldFetchConfigFromMaster = !!masterIp && \(\s*isClientTerminalMode\(\)/);
  assert.match(app, /masterIp && !isClientTerminalMode\(\) && !shouldFetchConfigFromMaster/);
});

test('read/acquire/open/save/unlock comparten single-flight y reponen mirrors sin duplicar writes', async () => {
  const oldWindow = (globalThis as any).window;
  const values: Record<string, string> = { clic_pos_terminal_setup_mode: 'ORDER_TAKER', pos_master_ip: '10.0.0.123' };
  const storage = { getItem: key => values[key] ?? null, setItem: (key, value) => { values[key] = value; } };
  (globalThis as any).window = { localStorage: storage };
  let discoveries = 0;
  const resolver = createOperationalMasterResolver({ getContract: () => contract,
    mirror: base => { values.CLIC_POS_MASTER_URL = base; values.pos_master_ip = new URL(base).hostname; },
    discover: async () => { discoveries++; return [{ baseUrl: '10.0.0.123', config: remote(contract.terminalId) }, { baseUrl: '10.0.0.101', config: remote() }]; } });
  setOperationalMasterResolver(resolver);
  const paths = ['/api/mesas', '/api/mesas/bloquear', '/api/mesas/abrir', '/api/mesas/parked-tickets', '/api/mesas/desbloquear'];
  const sent: Array<{ url: string; body: unknown }> = [];
  const transport = async (path: string, body: unknown) => { const url = await resolveValidatedOperationalApiUrl(path); sent.push({ url, body }); return path === '/api/mesas/bloquear' ? { status: 409, code: 'TABLE_BUSY' } : { status: 200 }; };
  try {
    const result = await Promise.all(paths.map(path => transport(path, { terminalId: contract.terminalId, ownerId: 'OWNER-UNCHANGED' })));
    assert.equal(discoveries, 1);
    assert.deepEqual(sent.map(entry => entry.url), paths.map(path => `http://10.0.0.101:3001${path}`));
    assert.equal(sent.length, 5); assert.equal(result[1].status, 409);
    values.pos_master_ip = '10.0.0.123'; values.CLIC_POS_MASTER_URL = 'http://10.0.0.123:3001';
    assert.equal(await resolveValidatedOperationalApiUrl('/api/mesas/abrir'), 'http://10.0.0.101:3001/api/mesas/abrir');
    assert.equal(values.pos_master_ip, '10.0.0.101'); assert.equal(discoveries, 1);
  } finally { setOperationalMasterResolver(null); (globalThis as any).window = oldWindow; }
});

test('cambio de contrato/self y fallo explícito invalidan autoridad; reintento vuelve a validar', async () => {
  let active = { ...contract }; let unavailable = false; let count = 0;
  const resolver = createOperationalMasterResolver({ getContract: () => active, mirror: () => {}, discover: async () => {
    count++; if (unavailable) throw new Error('MASTER_CONFIG_HTTP_503'); return [{ baseUrl: '10.0.0.101', config: remote() }]; } });
  await resolver.ensure(); active = { ...contract, companyId: '7cdae43b-eded-44d7-8f1f-89fd79da28b3' };
  assert.equal(resolver.current(), ''); await assert.rejects(resolver.ensure(), /SCOPE_MISMATCH/);
  active = { ...contract }; resolver.invalidate(); unavailable = true;
  await assert.rejects(resolver.ensure(), /503/); assert.equal(resolver.current(), '');
  unavailable = false; await resolver.ensure(); assert.equal(count, 4);
  active = { ...contract, localIps: ['10.0.0.101'] }; assert.equal(resolver.current(), '');
  await assert.rejects(resolver.ensure(), /SELF_ENDPOINT/);
});

test('cambio de vínculo mientras discover está pendiente no publica contrato antiguo', async () => {
  let active = { ...contract }; let finish!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  const resolver = createOperationalMasterResolver({ getContract: () => active, mirror: () => {}, discover: async () => {
    await waiting; return [{ baseUrl: '10.0.0.101', config: remote() }]; } });
  const pending = resolver.ensure(); active = { ...contract, masterTerminalId: '9ffc6771-7845-4976-afd3-20cebc3cc6e8' }; finish();
  await assert.rejects(pending, /CONTRACT_CHANGED/); assert.equal(resolver.current(), '');
});
