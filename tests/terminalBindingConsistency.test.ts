import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enforceClientTerminalBinding,
  isGovernedClientTerminal,
} from '../utils/terminalBindingConsistency';

test('reconoce una terminal dependiente por jerarquía o tipo ORDER_TAKER', () => {
  assert.equal(isGovernedClientTerminal({ masterTerminalId: 'master-1' }), true);
  assert.equal(isGovernedClientTerminal({ terminalType: 'ORDER_TAKER' }), true);
  assert.equal(isGovernedClientTerminal({ terminalType: 'STANDARD_POS' }), false);
});

test('sincroniza atómicamente identidad ERP y jerarquía del Cliente', () => {
  const result = enforceClientTerminalBinding({
    currentDeviceId: 'DEV-OLD',
    isPrimaryNode: true,
    governedByMaster: false,
    syncConfig: { mode: 'MASTER', isEnabled: false },
    erpTerminalId: 'erp-client-1',
    erpBinding: { terminalId: 'erp-client-1', deviceId: 'DEV-OLD' },
  }, 'DEV-NEW');

  assert.equal(result.currentDeviceId, 'DEV-NEW');
  assert.equal(result.erpBinding.deviceId, 'DEV-NEW');
  assert.equal(result.erpBinding.terminalId, 'erp-client-1');
  assert.equal(result.isPrimaryNode, false);
  assert.equal(result.governedByMaster, true);
  assert.equal(result.syncConfig.mode, 'SLAVE');
  assert.equal(result.syncConfig.isEnabled, true);
});

test('no inventa un erpBinding para una terminal LOCAL_ONLY', () => {
  const result = enforceClientTerminalBinding({ syncConfig: { mode: 'MASTER' } }, 'DEV-LOCAL');
  assert.equal(result.currentDeviceId, 'DEV-LOCAL');
  assert.equal(result.erpBinding, undefined);
});
