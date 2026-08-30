import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const selectorSource = readFileSync(new URL('../components/TerminalSelector.tsx', import.meta.url), 'utf8');
const setupSource = readFileSync(new URL('../services/setup/erpTerminalSetup.ts', import.meta.url), 'utf8');
const lifecycleSource = readFileSync(new URL('../utils/erpSyncLifecycle.ts', import.meta.url), 'utf8');
const revocationSource = readFileSync(new URL('../utils/deviceRevocation.ts', import.meta.url), 'utf8');

test('ERP directo no usa bind administrativo ni takeover desde el POS', () => {
  const directBranchStart = selectorSource.indexOf('} else if (usesErpDirect) {');
  const localBranchStart = selectorSource.indexOf('} else {', directBranchStart);
  const directBranch = selectorSource.slice(directBranchStart, localBranchStart);
  const bindServiceStart = setupSource.indexOf('export const bindTerminalFromErp');
  const bindService = setupSource.slice(bindServiceStart);

  assert.ok(directBranchStart >= 0);
  assert.doesNotMatch(directBranch, /bind-terminal/);
  assert.doesNotMatch(bindService, /\/takeover/);
  assert.match(directBranch, /forceTransfer: false/);
});

test('revinculación usa UUID canónico y bootstrap antes de register', () => {
  const bindServiceStart = setupSource.indexOf('export const bindTerminalFromErp');
  const bindService = setupSource.slice(bindServiceStart);
  const bootstrapIndex = bindService.indexOf('checkTerminalAuthorizationFromErp');
  const registerIndex = bindService.indexOf("'/api/sync/terminals/register'");

  assert.ok(bootstrapIndex >= 0);
  assert.ok(registerIndex > bootstrapIndex);
  assert.match(setupSource, /terminal_id: input\.erpTerminalId/);
  assert.match(setupSource, /erp_terminal_id: input\.erpTerminalId/);
  assert.match(setupSource, /device_id: input\.posDeviceId/);
  assert.match(lifecycleSource, /bootstrapErpSyncLifecycle[\s\S]*terminal_id: resolveCanonicalErpTerminalId\(terminalId\)/);
});

test('DEVICE_SUPERSEDED bloquea inmediatamente y solo se desbloquea después de register con credenciales', () => {
  assert.match(appSource, /lockSupersededTerminal\(blockingMessage/);
  assert.match(appSource, /markSyncDeviceTokenInvalid\('DEVICE_SUPERSEDED'\)/);
  assert.match(appSource, /clearStoredSyncToken\(\)/);
  assert.match(appSource, /registerErpSyncTerminal\([\s\S]*readTerminalCredentials\(\)/);
  assert.match(appSource, /!registered \|\| \(!refreshedCredentials\.deviceToken && !refreshedCredentials\.syncToken\)/);
  assert.match(appSource, /Math\.min\(5000 \* \(2 \*\* attempt\), 60000\)/);
  assert.match(revocationSource, /if \(detail\.reason === 'DEVICE_SUPERSEDED'\) return false/);
});

test('la selección de tipo de terminal siempre precede la lista cuando no existe setupMode', () => {
  assert.match(appSource, /case 'TERMINAL_PAIRING':[\s\S]*if \(!getStoredTerminalSetupMode\(\)\) \{[\s\S]*TerminalModeSelector/);
  assert.match(appSource, /const shouldChooseTerminalMode =[\s\S]*!setupMode &&[\s\S]*!localPairedTerminal/);
  assert.match(appSource, /setCurrentView\(getStoredTerminalSetupMode\(\) \? 'TERMINAL_PAIRING' : 'TERMINAL_MODE_SELECTOR'\)/);
});

test('la interfaz ERP identifica el device y no ofrece autoautorizar', () => {
  assert.match(selectorSource, /La autorización debe completarse desde Cloud Admin/);
  assert.match(selectorSource, /authorizationIssue\.generatedDeviceId/);
  assert.match(selectorSource, /Reintentar solo consulta si la autorización externa ya fue completada/);
  assert.match(selectorSource, /!expectsErpDirect && \(/);
});
