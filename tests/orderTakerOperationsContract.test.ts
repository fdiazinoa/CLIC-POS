import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const posSource = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
const actionGridSource = readFileSync(new URL('../components/ActionGrid.tsx', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('../components/Settings.tsx', import.meta.url), 'utf8');

test('guardar pedido no depende de jornada ni documento fiscal en ORDER_TAKER', () => {
  assert.match(posSource, /if \(isOrderTakerMode\) return true;[\s\S]*isSessionExpired/);
  assert.match(posSource, /if \(!isOrderTakerMode\) \{\s*const validation = validateTerminalDocument/);
  assert.match(posSource, /\[ORDER_TAKER_SAVE_FAILED\]/);
  assert.match(posSource, /La mesa permanece abierta/);
});

test('una terminal cliente no acumula locks al abrir mesas sucesivas', () => {
  assert.match(appSource, /const priorReleases = Array\.from\(pendingTableLockReleasesRef\.current\.entries\(\)\)/);
  assert.match(appSource, /await Promise\.all\(priorReleases\)/);
  assert.match(appSource, /waitForPersistence: false/);
  assert.match(appSource, /No se pudo liberar la mesa anterior en la Caja Master/);
});

test('las mesas cliente se refrescan cada segundo y al recuperar foco', () => {
  assert.match(appSource, /CLIENT_TABLE_POLL_INTERVAL_MS = 1000/);
  assert.match(appSource, /isClientTerminalMode\(\) \? CLIENT_TABLE_POLL_INTERVAL_MS : 10000/);
  assert.match(appSource, /window\.addEventListener\('focus', refreshVisibleTables\)/);
  assert.match(appSource, /document\.addEventListener\('visibilitychange', refreshVisibleTables\)/);
});

test('ORDER_TAKER oculta y bloquea cierres financieros', () => {
  assert.match(posSource, /const canCloseXReport = !isOrderTakerMode/);
  assert.match(posSource, /const canCloseZReport = !isOrderTakerMode/);
  assert.match(posSource, /case 'Z_REPORT':\s*if \(isOrderTakerMode\) return;/);
  assert.match(posSource, /hideFinancialClosings=\{isOrderTakerMode\}/);
  assert.match(actionGridSource, /!hideFinancialClosings && renderButton\('Z_REPORT'/);
  assert.match(posSource, /\{canCloseXReport && <button[\s\S]*?<span>Cierre X<\/span>[\s\S]*?<\/button>\}/);
  assert.match(appSource, /\[ORDER_TAKER_FINANCIAL_CLOSING_BLOCKED\]/);
  assert.match(appSource, /initialCashMovementType === 'X_REPORT' && terminalRole === DeviceRole\.ORDER_TAKER/);
  assert.match(appSource, /terminalRole === DeviceRole\.ORDER_TAKER[\s\S]*?Z_REPORT/);
});

test('ORDER_TAKER no consulta ni muestra estado fiscal', () => {
  assert.match(posSource, /if \(isOrderTakerMode \|\| isFiscalModeDisabled\)/);
  assert.match(posSource, /\{!isOrderTakerMode && !isFiscalModeDisabled && \(/);
});

test('la vista vertical mantiene acciones y Guardar pedido en el ticket', () => {
  assert.match(posSource, /data-testid="portrait-ticket-actions"/);
  assert.match(posSource, /isOrderTakerMode \? 'GUARDAR PEDIDO'/);
});

test('el ERP exige seleccionar la Master al configurar una terminal de pedidos', () => {
  const terminalSettingsSource = readFileSync(new URL('../components/TerminalSettings.tsx', import.meta.url), 'utf8');
  assert.match(terminalSettingsSource, /Terminal Master vinculada/);
  assert.match(terminalSettingsSource, /handleAssignOrderTakerMaster/);
  assert.match(terminalSettingsSource, /Selecciona la terminal Master/);
  assert.match(terminalSettingsSource, /master_terminal_id: masterTerminalId \|\| undefined/);
});

test('la configuración de ORDER_TAKER queda limitada a operación local', () => {
  const policyStart = settingsSource.indexOf('const ORDER_TAKER_SETTINGS_VIEWS');
  const policyEnd = settingsSource.indexOf(']);', policyStart);
  const policySource = settingsSource.slice(policyStart, policyEnd);

  assert.match(policySource, /'HARDWARE'/);
  assert.match(policySource, /'PRODUCTION_AREAS'/);
  assert.match(policySource, /'SYNC'/);
  assert.match(policySource, /'CHECKOUT_TRACKING'/);
  assert.doesNotMatch(policySource, /'CATALOG'/);
  assert.doesNotMatch(policySource, /'TERMINALS'/);
  assert.match(settingsSource, /Configuración de esta tableta/);
  assert.match(settingsSource, /!ORDER_TAKER_SETTINGS_VIEWS\.has\(currentView\)/);
});
