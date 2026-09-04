import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { getInitialConfig } from '../constants';
import { DeviceRole } from '../types';
import { applyTerminalConfigSnapshot } from '../utils/terminalConfigSnapshot';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const selectorSource = readFileSync(new URL('../components/TerminalSelector.tsx', import.meta.url), 'utf8');
const posInterfaceSource = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
const kioskBrowserSource = readFileSync(new URL('../components/kiosk/KioskProductBrowser.tsx', import.meta.url), 'utf8');

test('ORDER_TAKER explícito prevalece sobre el rol STANDARD_POS persistido', () => {
  const config = getInitialConfig('Restaurante' as any);
  config.terminals[0].config.deviceRole = {
    ...config.terminals[0].config.deviceRole!,
    role: DeviceRole.STANDARD_POS,
  };

  const applied = applyTerminalConfigSnapshot(config, {
    terminalId: 'POS-011',
    posDeviceId: 'order-taker-device',
    bindingMode: 'SLAVE',
    incomingSnapshot: {
      terminal_id: 'POS-011',
      terminal_type: 'ORDER_TAKER',
      master_terminal_id: 'POS-MASTER',
      resolved: {
        terminal: {
          terminal_type: 'ORDER_TAKER',
          master_terminal_id: 'POS-MASTER',
        },
      },
    } as any,
  });

  const terminal = applied.config.terminals.find(item => item.id === 'POS-011');
  assert.ok(terminal);
  assert.equal(terminal.config.terminalType, 'ORDER_TAKER');
  assert.equal(terminal.config.terminal_type, 'ORDER_TAKER');
  assert.equal(terminal.config.deviceRole?.role, DeviceRole.ORDER_TAKER);
  assert.equal(terminal.config.masterTerminalId, 'POS-MASTER');
  assert.equal(terminal.config.isPrimaryNode, false);
  assert.equal(terminal.config.governedByMaster, true);
});

test('la vinculación cliente conserva id local y modo ORDER_TAKER', () => {
  assert.match(
    selectorSource,
    /const resolvedTerminalId = bindingMode === 'SLAVE'[\s\S]*?data\.terminal_id[\s\S]*?resolvedErpTerminalId/
  );
  assert.match(
    appSource,
    /const isClientSetupMode = storedSetupMode === 'CLIENT' \|\| storedSetupMode === 'ORDER_TAKER'/
  );
  assert.match(
    appSource,
    /const nextSetupMode: TerminalSetupMode = isSlave[\s\S]*?storedSetupMode === 'ORDER_TAKER' \? 'ORDER_TAKER' : 'CLIENT'/
  );
  assert.match(
    appSource,
    /const isLocalClientBinding = Boolean\(resolvedMasterIp\)[\s\S]*?storedSetupMode === 'ORDER_TAKER'/
  );
  assert.match(appSource, /if \(!effectiveDeviceToken && !isLocalClientBinding\)/);
  assert.match(
    selectorSource,
    /erpBaseUrl: bindingMode === 'SLAVE' \? undefined : erpBaseUrl \|\| undefined/
  );
});

test('la toma de pedidos tolera snapshots Master sin features opcionales', () => {
  assert.match(posInterfaceSource, /config\.features\?\.stockTracking \?\? false/);
  assert.doesNotMatch(posInterfaceSource, /config\.features\.stockTracking/);
  assert.match(kioskBrowserSource, /config\.features\?\.stockTracking \?\? false/);
  assert.doesNotMatch(kioskBrowserSource, /config\.features\.stockTracking/);
});
