import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveIncomingSyncProfileFromRegister,
  resolveRegisterErpTerminalId,
  resolveRegisterTerminalCode,
} from '../services/sync/erpRegisterResponse';

const ERP_TERMINAL_ID = 'd90601d9-6ef3-4b99-9543-a9ea7ffdd2f5';

test('keeps the ERP UUID separate from the operational terminal code', () => {
  const response = {
    terminal_id: ERP_TERMINAL_ID,
    erp_terminal_id: ERP_TERMINAL_ID,
    terminal_code: 'POS-010',
    terminal_name: 'NPOS',
    syncProfile: {
      erpTerminalId: ERP_TERMINAL_ID,
      localTerminalId: ERP_TERMINAL_ID,
    },
  };

  assert.equal(resolveRegisterErpTerminalId(response), ERP_TERMINAL_ID);
  assert.equal(resolveRegisterTerminalCode(response), 'POS-010');

  const profile = resolveIncomingSyncProfileFromRegister(response, {
    erpTerminalId: ERP_TERMINAL_ID,
    localTerminalId: 'POS-010',
  });

  assert.equal(profile.erpTerminalId, ERP_TERMINAL_ID);
  assert.equal(profile.localTerminalId, 'POS-010');
});

test('reads the operational code from nested terminal configuration', () => {
  const response = {
    terminal: {
      id: ERP_TERMINAL_ID,
      name: 'NPOS',
      config: {
        station_number: 'POS-010',
      },
    },
  };

  assert.equal(resolveRegisterTerminalCode(response), 'POS-010');
});

test('never promotes a UUID to terminal code', () => {
  assert.equal(resolveRegisterTerminalCode({
    terminal_id: ERP_TERMINAL_ID,
    local_terminal_id: ERP_TERMINAL_ID,
  }), undefined);
});
