import assert from 'node:assert/strict';
import test from 'node:test';

import { DeviceRole } from '../types';
import { getDefaultRoleConfig, resolveDeviceRoleValue } from '../utils/deviceRoleHelpers';
import {
  isTerminalAllowedForBinding,
  ORDER_TAKER_TERMINAL_TYPE,
  resolveOrderTakerContract,
  STANDARD_POS_TERMINAL_TYPE,
} from '../utils/orderTakerPolicy';

test('recognizes ORDER_TAKER from ERP camel and snake case contracts', () => {
  assert.equal(resolveDeviceRoleValue([{ terminal_type: 'ORDER_TAKER' }]), DeviceRole.ORDER_TAKER);
  assert.equal(resolveDeviceRoleValue([{ terminalType: 'ORDER_TAKER' }]), DeviceRole.ORDER_TAKER);
});

test('filters activation terminals without hiding legacy standard POS terminals', () => {
  const orderTaker = { terminal_type: 'ORDER_TAKER' };
  const legacyPos = { id: 'legacy-pos', config: {} };

  assert.equal(isTerminalAllowedForBinding(orderTaker, ORDER_TAKER_TERMINAL_TYPE), true);
  assert.equal(isTerminalAllowedForBinding(legacyPos, ORDER_TAKER_TERMINAL_TYPE), false);
  assert.equal(isTerminalAllowedForBinding(orderTaker, STANDARD_POS_TERMINAL_TYPE), false);
  assert.equal(isTerminalAllowedForBinding(legacyPos, STANDARD_POS_TERMINAL_TYPE), true);
});

test('only offers order takers assigned to the connected master', () => {
  const assigned = { terminal_type: 'ORDER_TAKER', master_terminal_id: 'master-001' };
  assert.equal(
    isTerminalAllowedForBinding(assigned, ORDER_TAKER_TERMINAL_TYPE, ['master-001']),
    true
  );
  assert.equal(
    isTerminalAllowedForBinding(assigned, ORDER_TAKER_TERMINAL_TYPE, ['master-002']),
    false
  );
});

test('preserves master identity, capabilities and restrictions', () => {
  const contract = resolveOrderTakerContract({
    config: {
      terminal_type: 'ORDER_TAKER',
      master_terminal_id: 'master-001',
      capabilities: ['TABLES', 'ORDERS', 'KDS_SEND'],
      restrictions: ['NO_OFFLINE', 'NO_PAYMENTS', 'NO_FISCAL_DOCUMENTS'],
    },
  });

  assert.equal(contract.terminalType, ORDER_TAKER_TERMINAL_TYPE);
  assert.equal(contract.masterTerminalId, 'master-001');
  assert.deepEqual(contract.capabilities, ['TABLES', 'ORDERS', 'KDS_SEND']);
  assert.deepEqual(contract.restrictions, ['NO_OFFLINE', 'NO_PAYMENTS', 'NO_FISCAL_DOCUMENTS']);
});

test('ORDER_TAKER role only exposes authenticated sales and disables payment hardware', () => {
  const role = getDefaultRoleConfig(DeviceRole.ORDER_TAKER);
  assert.equal(role.defaultRoute, '/tables');
  assert.deepEqual(role.allowedModules, ['sales', 'auth']);
  assert.equal(role.hardwareConfig?.disableCashDrawer, true);
  assert.equal(role.hardwareConfig?.disablePrinter, true);
});
