import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canUseLocalOperationalTableStore,
  isClientTerminalMode,
  resolveMasterOperationalBaseUrl,
  resolveOperationalApiUrl
} from '../utils/masterOperationalApi';

const createStorage = (values: Record<string, string>) => ({
  getItem: (key: string) => values[key] ?? null
});

test('la caja cliente dirige las operaciones de mesas a la Master vinculada', () => {
  const storage = createStorage({
    clic_pos_terminal_setup_mode: 'CLIENT',
    CLIC_POS_MASTER_URL: 'http://192.168.1.20:3001/'
  });

  assert.equal(isClientTerminalMode(storage), true);
  assert.equal(canUseLocalOperationalTableStore(storage), false);
  assert.equal(resolveMasterOperationalBaseUrl(storage), 'http://192.168.1.20:3001');
  assert.equal(
    resolveOperationalApiUrl('/api/mesas?terminal_id=POS-002', storage),
    'http://192.168.1.20:3001/api/mesas?terminal_id=POS-002'
  );
});

test('la caja cliente conserva compatibilidad con pos_master_ip', () => {
  const storage = createStorage({
    pos_master_ip: '192.168.1.21'
  });

  assert.equal(isClientTerminalMode(storage), true);
  assert.equal(canUseLocalOperationalTableStore(storage), false);
  assert.equal(
    resolveOperationalApiUrl('/api/mesas/abrir', storage),
    'http://192.168.1.21:3001/api/mesas/abrir'
  );
});

test('Master y ERP directo mantienen las rutas relativas actuales', () => {
  const masterStorage = createStorage({
    clic_pos_terminal_setup_mode: 'SERVER_LOCAL',
    CLIC_POS_MASTER_URL: 'http://192.168.1.20:3001'
  });
  const erpStorage = createStorage({
    clic_pos_terminal_setup_mode: 'SERVER_ERP',
    CLIC_POS_MASTER_URL: 'http://192.168.1.20:3001'
  });

  assert.equal(resolveOperationalApiUrl('/api/mesas', masterStorage), '/api/mesas');
  assert.equal(resolveOperationalApiUrl('/api/mesas', erpStorage), '/api/mesas');
  assert.equal(canUseLocalOperationalTableStore(masterStorage), true);
  assert.equal(canUseLocalOperationalTableStore(erpStorage), true);
});
