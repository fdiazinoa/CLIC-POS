import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isEligibleOperationalMasterConfig,
  isEligibleOperationalMasterTerminal,
  resolveServingTerminalFromConfig,
} from '../utils/masterServerEligibility';

const MASTER_ID = '461837f1-67d1-4ce6-b394-bf9e7b79dc8c';
const KDS_ID = '0dc38b59-26d0-4e59-9f5d-2cb7f389fde2';

const terminals = [
  {
    id: MASTER_ID,
    config: {
      isPrimaryNode: true,
      governedByMaster: false,
      terminalType: 'STANDARD_POS',
      deviceRole: { role: 'STANDARD_POS' },
    },
  },
  {
    id: KDS_ID,
    config: {
      isPrimaryNode: true,
      governedByMaster: false,
      terminalType: 'KITCHEN_DISPLAY',
      deviceRole: { role: 'KITCHEN_DISPLAY' },
    },
  },
];

test('acepta la Caja Master que ejecuta el terminal POS primario', () => {
  const config = {
    terminals,
    metadata: {
      deviceToken: 'dev_461837f167d14ce6b394bf9e_token',
    },
  } as any;

  assert.equal(resolveServingTerminalFromConfig(config)?.id, MASTER_ID);
  assert.equal(isEligibleOperationalMasterConfig(config), true);
});

test('rechaza un KDS que por error anuncia el puerto de la Master', () => {
  const config = {
    terminals,
    metadata: {
      syncAuth: {
        deviceToken: 'dev_0dc38b5926d04e599f5d2cb7_token',
      },
    },
  } as any;

  assert.equal(resolveServingTerminalFromConfig(config)?.id, KDS_ID);
  assert.equal(isEligibleOperationalMasterConfig(config), false);
  assert.equal(isEligibleOperationalMasterTerminal(terminals[1] as any), false);
});

test('rechaza terminales cliente aunque un contrato antiguo las marque como primarias', () => {
  assert.equal(isEligibleOperationalMasterTerminal({
    config: {
      isPrimaryNode: true,
      governedByMaster: true,
      terminalType: 'ORDER_TAKER',
    },
  } as any), false);
});
