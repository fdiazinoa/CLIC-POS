import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canUseLocalOperationalTableStore,
  createOperationalMasterResolver,
  setOperationalMasterResolver,
  isClientTerminalMode,
  resolveMasterOperationalBaseUrl,
  resolveOperationalApiUrl
} from '../utils/masterOperationalApi';

const createStorage = (values: Record<string, string>) => ({
  getItem: (key: string) => values[key] ?? null
});

const prepare = async (storage: ReturnType<typeof createStorage>) => {
  const resolver = createOperationalMasterResolver({
    getContract: () => ({ erpManaged: false, terminalId: '', masterTerminalId: '', tenantId: '', companyId: '', storeId: '', deviceId: '', localIps: [] }),
    discover: async () => [{ baseUrl: resolveMasterOperationalBaseUrl(storage), config: {} }],
    mirror: () => {},
  });
  setOperationalMasterResolver(resolver);
  await resolver.ensure();
};

test('la caja cliente dirige las operaciones de mesas a la Master validada', async () => {
  const storage = createStorage({
    clic_pos_terminal_setup_mode: 'CLIENT',
    CLIC_POS_MASTER_URL: 'http://192.168.1.20:3001/'
  });

  assert.equal(isClientTerminalMode(storage), true);
  assert.equal(canUseLocalOperationalTableStore(storage), false);
  assert.equal(resolveMasterOperationalBaseUrl(storage), 'http://192.168.1.20:3001');
  await prepare(storage);
  assert.equal(
    resolveOperationalApiUrl('/api/mesas?terminal_id=POS-002', storage),
    'http://192.168.1.20:3001/api/mesas?terminal_id=POS-002'
  );
});

test('la caja cliente conserva compatibilidad validada con pos_master_ip', async () => {
  const storage = createStorage({
    pos_master_ip: '192.168.1.21'
  });

  assert.equal(isClientTerminalMode(storage), true);
  assert.equal(canUseLocalOperationalTableStore(storage), false);
  await prepare(storage);
  assert.equal(
    resolveOperationalApiUrl('/api/mesas/abrir', storage),
    'http://192.168.1.21:3001/api/mesas/abrir'
  );
});

test('la caja cliente corrige HTTPS persistido para una IP privada del Master', async () => {
  const storage = createStorage({
    clic_pos_terminal_setup_mode: 'CLIENT',
    CLIC_POS_MASTER_URL: 'https://192.168.1.21:3001/api/'
  });

  assert.equal(resolveMasterOperationalBaseUrl(storage), 'http://192.168.1.21:3001');
  await prepare(storage);
  assert.equal(
    resolveOperationalApiUrl('/api/config', storage),
    'http://192.168.1.21:3001/api/config'
  );
});

test('Master web mantiene rutas relativas y Master Android usa el servidor nativo', () => {
  const masterStorage = createStorage({
    clic_pos_terminal_setup_mode: 'SERVER_LOCAL',
    CLIC_POS_MASTER_URL: 'http://192.168.1.20:3001'
  });
  const erpStorage = createStorage({
    clic_pos_terminal_setup_mode: 'SERVER_ERP',
    CLIC_POS_MASTER_URL: 'http://192.168.1.20:3001'
  });

  assert.equal(resolveOperationalApiUrl('/api/mesas', masterStorage, false), '/api/mesas');
  assert.equal(resolveOperationalApiUrl('/api/mesas', erpStorage, false), '/api/mesas');
  assert.equal(
    resolveOperationalApiUrl('/api/mesas', masterStorage, true),
    'http://127.0.0.1:3001/api/mesas'
  );
  assert.equal(
    resolveOperationalApiUrl('/api/mesas/parked-tickets', erpStorage, true),
    'http://127.0.0.1:3001/api/mesas/parked-tickets'
  );
  assert.equal(canUseLocalOperationalTableStore(masterStorage), true);
  assert.equal(canUseLocalOperationalTableStore(erpStorage), true);
});

test('una Cliente Android conserva la URL LAN validada de la Master', async () => {
  const storage = createStorage({
    clic_pos_terminal_setup_mode: 'CLIENT',
    CLIC_POS_MASTER_URL: 'http://10.0.0.94:3001'
  });

  await prepare(storage);

  assert.equal(
    resolveOperationalApiUrl('/api/mesas/parked-tickets', storage, true),
    'http://10.0.0.94:3001/api/mesas/parked-tickets'
  );
});
