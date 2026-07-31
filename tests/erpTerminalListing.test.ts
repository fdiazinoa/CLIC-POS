import assert from 'node:assert/strict';
import test from 'node:test';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, String(value)),
    removeItem: (key: string) => storage.delete(key),
  },
});

const { getInitialConfig } = await import('../constants');
const { materializeErpTerminalCards } = await import('../services/setup/erpTerminalSetup');

test('keeps occupied ERP terminals visible with their own operational codes', () => {
  const currentConfig = getInitialConfig('Supermercado' as any);
  currentConfig.terminals = [currentConfig.terminals[0]];
  currentConfig.terminals[0].config.stationNumber = 'POS-001';

  const terminals = materializeErpTerminalCards({
    currentConfig,
    posDeviceId: 'DEV-NEW',
    terminals: [
      {
        id: 'erp-pos-003',
        terminal_code: 'POS-003',
        name: 'Caja 003',
        device_id: 'DEV-OLD-003',
        company_name: 'MercaSend-Pruebas',
      },
      {
        id: 'erp-pos-005',
        terminal_code: 'POS-005',
        name: 'POS-005',
        device_id: '',
        company_name: 'MercaSend-Pruebas',
      },
    ],
  });

  assert.equal(terminals.length, 2);
  assert.deepEqual(terminals.map((terminal) => terminal.config.stationNumber), ['POS-003', 'POS-005']);
  assert.equal(terminals[0].occupied, true);
  assert.equal(terminals[0].currentDeviceId, 'DEV-OLD-003');
  assert.equal(terminals[0].config.currentDeviceId, 'DEV-OLD-003');
  assert.equal(terminals[0].config.erpBinding?.terminalId, 'erp-pos-003');
  assert.equal(terminals[1].occupied, false);
});

test('filters archived ERP rows without hiding the active terminal with the same code', () => {
  const currentConfig = getInitialConfig('Supermercado' as any);
  const terminals = materializeErpTerminalCards({
    currentConfig,
    posDeviceId: 'DEV-NEW',
    terminals: [
      {
        id: 'active-pos-003',
        terminal_code: 'POS-003',
        name: 'Caja 003',
        device_id: 'DEV-OLD-003',
      },
      {
        id: 'archived-pos-003',
        terminal_code: 'POS-003',
        name: 'ARCHIVED-Caja 003',
        device_id: 'ARCHIVED-old',
      },
    ],
  });

  assert.equal(terminals.length, 1);
  assert.equal(terminals[0].id, 'active-pos-003');
});

test('keeps a valid Master whose display name matches another terminal code', () => {
  const currentConfig = getInitialConfig('Restaurante' as any);
  const terminals = materializeErpTerminalCards({
    currentConfig,
    posDeviceId: 'DEV-NEW-MASTER',
    terminals: [
      {
        id: 'erp-master-01',
        terminal_code: 'MASTER-01',
        name: 'Slav-01',
        device_id: '',
        active: true,
      },
      {
        id: 'erp-slave-01',
        terminal_code: 'Slav-01',
        name: 'Slav-01',
        device_id: 'DEV-SLAVE-01',
        active: true,
      },
    ],
  });

  assert.equal(terminals.length, 2);
  assert.deepEqual(terminals.map(terminal => terminal.id), ['erp-master-01', 'erp-slave-01']);
});
