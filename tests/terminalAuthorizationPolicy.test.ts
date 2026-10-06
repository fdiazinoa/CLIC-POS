import assert from 'node:assert/strict';
import test from 'node:test';
import type { TerminalConfig } from '../types';
import { DEFAULT_TERMINAL_CONFIG } from '../constants';
import { requiresTerminalPolicyPin } from '../utils/terminalAuthorizationPolicy';
import { canSeeOtherTerminalSales, matchesSalesTerminal } from '../utils/terminalSalesVisibility';

test('terminal PIN policies require approval independent of RBAC and unrelated actions', () => {
  const security = { ...DEFAULT_TERMINAL_CONFIG.security, requirePinForVoid: true, requirePinForDiscount: false, requireManagerForRefunds: true };
  assert.equal(requiresTerminalPolicyPin(security, 'POS_VOID_ITEM'), true);
  assert.equal(requiresTerminalPolicyPin(security, 'POS_DISCOUNT'), false);
  assert.equal(requiresTerminalPolicyPin(security, 'POS_VOID_PAID_TICKET'), true);
  assert.equal(requiresTerminalPolicyPin(security, 'SETTINGS_ACCESS'), false);
  assert.equal(requiresTerminalPolicyPin({ ...security, requirePinForDiscount: true }, 'POS_DISCOUNT'), true);
});

test('explicit global-sales false overrides master fallback; aliases restrict A visibility', () => {
  const terminal: TerminalConfig = structuredClone(DEFAULT_TERMINAL_CONFIG);
  terminal.isPrimaryNode = true;
  terminal.operational.showGlobalSales = false;
  assert.equal(canSeeOtherTerminalSales(terminal), false);
  terminal.operational.showGlobalSales = true;
  assert.equal(canSeeOtherTerminalSales(terminal), true);
  assert.equal(matchesSalesTerminal('ERP-A', ['local-a', 'erp-a']), true);
  assert.equal(matchesSalesTerminal('B', ['local-a', 'erp-a']), false);
});
