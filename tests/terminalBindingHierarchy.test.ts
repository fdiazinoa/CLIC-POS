import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTerminalBindIdentityPayload,
  formatTerminalBindingLabel,
  groupTerminalBindingRecords,
  isArchivedTerminalBindingRecord,
  isTerminalBindingSelectable,
  normalizeTerminalBindingRecord,
} from '../utils/terminalBindingHierarchy';

const normalize = (records: Record<string, any>[]) => records.map((record) => (
  normalizeTerminalBindingRecord(record, { deviceId: 'DEV-NEW', tenantId: 'tenant-1' })
));

test('separa cajas con nombres repetidos por company_id', () => {
  const groups = groupTerminalBindingRecords(normalize([
    {
      id: 'terminal-a', company_id: 'company-a', company_name: 'MercaSend-Pruebas',
      store_id: 'store-a', store_name: 'Sucursal Principal', terminal_name: 'Caja 1', terminal_code: 'POS-001',
    },
    {
      id: 'terminal-b', company_id: 'company-b', company_name: 'Clic-Suites',
      store_id: 'store-b', store_name: 'Sucursal Principal', terminal_name: 'Caja 1', terminal_code: 'POS-001',
    },
  ]));

  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.id), ['company-a', 'company-b']);
  assert.deepEqual(groups.flatMap((group) => group.stores.flatMap((store) => store.terminals.map((terminal) => terminal.id))), ['terminal-a', 'terminal-b']);
});

test('no mezcla sucursales de igual nombre cuando sus store_id son distintos', () => {
  const groups = groupTerminalBindingRecords(normalize([
    { id: 'terminal-a', company_id: 'company-a', company_name: 'Empresa', store_id: 'store-a', store_name: 'Centro', terminal_name: 'Caja 1' },
    { id: 'terminal-b', company_id: 'company-a', company_name: 'Empresa', store_id: 'store-b', store_name: 'Centro', terminal_name: 'Caja 2' },
  ]));

  assert.equal(groups[0].stores.length, 2);
  assert.deepEqual(groups[0].stores.map((store) => store.id), ['store-a', 'store-b']);
});

test('adapta el contrato anterior sin company_name ni separadores vacíos', () => {
  const [terminal] = normalize([{ id: 'legacy-uuid', nombre: 'Caja Antigua', sucursal: 'Sucursal Norte' }]);

  assert.equal(terminal.companyName, 'Empresa sin identificar');
  assert.equal(terminal.storeName, 'Sucursal Norte');
  assert.equal(terminal.name, 'Caja Antigua');
  assert.equal(formatTerminalBindingLabel(terminal), 'Caja Antigua');
  assert.doesNotMatch(formatTerminalBindingLabel(terminal), /null|·\s*$/i);
});

test('conserva el UUID seleccionado en el payload autoritativo de vinculación', () => {
  const [terminal] = normalize([{
    id: '4f4be269-5ee3-4895-98a3-504aabbcb131',
    terminal_name: 'Caja 1',
    terminal_code: 'POS-001',
  }]);

  assert.deepEqual(buildTerminalBindIdentityPayload(terminal, 'DEV-M22EYU81', 'Tablet recepción'), {
    terminal_id: '4f4be269-5ee3-4895-98a3-504aabbcb131',
    new_device_id: 'DEV-M22EYU81',
    device_name: 'Tablet recepción',
  });
});

test('prioriza id autoritativo aunque un alias ERP heredado apunte a una identidad archivada', () => {
  const [terminal] = normalize([{
    id: '461837f1-67d1-4ce6-b394-bf9e7b79dc8c',
    erpTerminalId: '685cb867-70b6-4f63-aed4-8bc9e706377b',
    terminal_name: 'Mast-01',
    terminal_code: 'POS-001',
  }]);

  assert.equal(terminal.id, '461837f1-67d1-4ce6-b394-bf9e7b79dc8c');
  assert.equal(terminal.erpTerminalId, terminal.id);
  assert.equal(
    buildTerminalBindIdentityPayload(terminal, 'DEV-MASTER').terminal_id,
    '461837f1-67d1-4ce6-b394-bf9e7b79dc8c',
  );
});

test('reconoce terminales archivadas aunque el nombre visible no tenga prefijo ARCHIVED', () => {
  const archivedRecords = [
    { id: 'a', terminal_name: 'Mast-01', status: 'ARCHIVED' },
    { id: 'b', terminal_name: 'Mast-01', is_archived: true },
    { id: 'c', terminal_name: 'Mast-01', archived_at: '2026-08-18T00:00:00Z' },
    { id: 'd', terminal_name: 'Mast-01', metadata: { deleted_at: '2026-08-18T00:00:00Z' } },
    { id: 'e', terminal_name: 'Mast-01', terminal_config: { active: false } },
    { id: 'f', terminal_name: 'Mast-01', status: 'ACTIVE', binding_status: 'ARCHIVED' },
    { id: 'g', terminal_name: 'Mast-01', config: {}, terminal_config: { archived: true } },
  ];

  archivedRecords.forEach(record => assert.equal(isArchivedTerminalBindingRecord(record), true));
  assert.equal(isArchivedTerminalBindingRecord({ id: 'active', terminal_name: 'Mast-01', status: 'ACTIVE' }), false);
});

test('bloquea una terminal ocupada sin permiso de reautorización', () => {
  const [blocked, allowed] = normalize([
    { id: 'blocked', binding_status: 'OCCUPIED', is_occupied: true, can_reauthorize: false },
    { id: 'allowed', binding_status: 'OCCUPIED', is_occupied: true, can_reauthorize: true },
  ]);

  assert.equal(isTerminalBindingSelectable(blocked), false);
  assert.equal(isTerminalBindingSelectable(allowed), true);
});
