import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const serverSource = readFileSync(
  new URL('../native-stubs/android/ClicPOSMasterHttpServer.kt', import.meta.url),
  'utf8',
);
const terminalSelectorSource = readFileSync(
  new URL('../components/TerminalSelector.tsx', import.meta.url),
  'utf8',
);
const terminalBindingSource = readFileSync(
  new URL('../components/TerminalBindingScreen.tsx', import.meta.url),
  'utf8',
);
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const erpTerminalSetupSource = readFileSync(
  new URL('../services/setup/erpTerminalSetup.ts', import.meta.url),
  'utf8',
);

test('el servidor Master Android expone el contrato completo de activacion cliente', () => {
  assert.match(serverSource, /path == "\/api\/setup\/terminals"/);
  assert.match(serverSource, /path == "\/api\/setup\/claim-terminal"/);
  assert.match(serverSource, /path == "\/api\/setup\/bind-terminal"/);
  assert.match(serverSource, /path\.startsWith\("\/api\/setup\/initial-config\/"\)/);
});

test('el servidor Master Android permite POST y protege terminales ocupadas', () => {
  assert.match(serverSource, /Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS/);
  assert.match(serverSource, /"TERMINAL_OCCUPIED"/);
  assert.match(serverSource, /writeResponse\(\s*socket,\s*409,/);
});

test('el servidor Master Android conserva el contrato ORDER_TAKER', () => {
  assert.match(serverSource, /\.put\("terminal_type", terminalType\)/);
  assert.match(serverSource, /\.put\("master_terminal_id"/);
  assert.match(serverSource, /\.put\("capabilities"/);
  assert.match(serverSource, /\.put\("restrictions"/);
});

test('la Cliente recibe mesas y productos desde el snapshot operativo de la Master', () => {
  assert.match(serverSource, /\.put\("rooms", JSONArray\(roomsSnapshot\.toString\(\)\)\)/);
  assert.match(serverSource, /\.put\("tables", buildTablesWithEditLocks\(\)\)/);
  assert.match(serverSource, /\.put\("items", getSyncCollection\("products"\)\)/);
  assert.match(
    terminalSelectorSource,
    /rooms: Array\.isArray\(initialConfigData\.rooms\) \? initialConfigData\.rooms : undefined/,
  );
  assert.match(
    terminalSelectorSource,
    /tables: Array\.isArray\(initialConfigData\.tables\) \? initialConfigData\.tables : undefined/,
  );
  assert.match(appSource, /const hasAuthoritativeTableSnapshot = Array\.isArray\(setupResult\?\.tables\)/);
  assert.match(appSource, /isClientTerminal: isSlave/);
  assert.match(appSource, /if \(hasAuthoritativeTableSnapshot \|\| effectiveSetupTables\.length > 0\)/);
  assert.match(appSource, /if \(!isClientRuntime && nextTables\.length === 0 && previousTables\.length > 0\)/);
});

test('la activacion cliente usa transporte nativo con timeout para todo el handshake', () => {
  assert.match(terminalSelectorSource, /requestMasterSetup<TerminalSelectorResponse>/);
  assert.match(terminalSelectorSource, /`\$\{apiBase\}\/bind-terminal`/);
  assert.match(terminalSelectorSource, /method: 'POST'/);
  assert.match(terminalSelectorSource, /body: bindTerminalRequestBody/);
  assert.match(terminalSelectorSource, /stage: 'BIND_TERMINAL'/);
  assert.match(terminalSelectorSource, /stage: 'INITIAL_CONFIG'/);
  assert.match(terminalSelectorSource, /const timeoutMs = 12000/);
  assert.match(terminalSelectorSource, /Promise\.race\(\[request, hardTimeout\]\)/);
});

test('la activación cliente busca la Maestra automáticamente en el flujo visible', () => {
  assert.match(terminalBindingSource, /resolveMasterEndpointFromCloud\(\)/);
  assert.match(terminalBindingSource, /discoverLanMasterCandidates\(\{ timeoutMs: 2500 \}\)/);
  assert.match(terminalBindingSource, /await applyMasterConnection\(connection, candidate\.source\)/);
  assert.match(terminalBindingSource, /Puede ingresar la IP manualmente/);
});

test('los modos Cliente y Toma de pedidos filtran el tipo de terminal esperado', () => {
  assert.match(
    terminalBindingSource,
    /const \[expectedTerminalType, setExpectedTerminalType\] = useState<PosTerminalType \| null>\(initialExpectedTerminalType\)/,
  );
  assert.match(
    terminalBindingSource,
    /if \(initialBindingMode\) \{[\s\S]*?setBindingMode\(initialBindingMode\);[\s\S]*?setExpectedTerminalType\(initialExpectedTerminalType\);/,
  );
  assert.match(appSource, /initialExpectedTerminalType=\{getExpectedSetupTerminalType\(getStoredTerminalSetupMode\(\)\)\}/);
});

test('Master ERP lista terminales autoritativas del ERP y no acepta seeds del servidor embebido', () => {
  assert.match(terminalSelectorSource, /if \(useErpDirectMasterAndroid \|\| usesErpDirect\)/);
  assert.match(terminalSelectorSource, /const erpData = await listTerminalsFromErp/);
  assert.doesNotMatch(terminalSelectorSource, /setup proxy \/terminals failed, falling back to ERP direct/);
});

test('Master ERP directo propaga forceTransfer en Android y en el fallback web', () => {
  const directBindingFlow = terminalSelectorSource.slice(
    terminalSelectorSource.indexOf('if (useErpDirectMasterAndroid) {', terminalSelectorSource.indexOf('const bindTerminal = useCallback')),
    terminalSelectorSource.indexOf('} else {', terminalSelectorSource.indexOf('if (useErpDirectMasterAndroid) {', terminalSelectorSource.indexOf('const bindTerminal = useCallback'))),
  );

  assert.equal((directBindingFlow.match(/forceTransfer,/g) || []).length, 2);
  assert.doesNotMatch(directBindingFlow, /forceTransfer:\s*false/);
});

test('el takeover ERP directo está limitado a MASTER y usa el UUID canónico', () => {
  assert.match(erpTerminalSetupSource, /input\.bindingMode === 'MASTER'/);
  assert.match(erpTerminalSetupSource, /input\.forceTransfer === true/);
  assert.match(
    erpTerminalSetupSource,
    /`\/api\/sync\/terminals\/\$\{encodeURIComponent\(targetErpTerminalId\)\}\/takeover`/,
  );
  assert.match(erpTerminalSetupSource, /terminal_id:\s*targetErpTerminalId/);
  assert.match(erpTerminalSetupSource, /status:\s*'TAKEOVER_ACCEPTED'/);
  assert.match(terminalSelectorSource, /message:\s*err\.message/);
  assert.match(terminalSelectorSource, /\{authorizationIssue\.message\}/);
});

test('volver desde la autorización regresa al selector canónico del modo de dispositivo', () => {
  assert.match(terminalBindingSource, /onBackToModeSelection\?: \(\) => void/);
  assert.match(terminalBindingSource, /const handleBackToModeSelection = \(\) =>/);
  assert.match(terminalBindingSource, /if \(bindingMode === 'SLAVE' && masterIp\)/);
  assert.match(appSource, /onBackToModeSelection=\{\(\) => \{/);
  assert.match(appSource, /localStorage\.removeItem\(TERMINAL_SETUP_MODE_KEY\)/);
  assert.match(appSource, /setCurrentView\('TERMINAL_MODE_SELECTOR'\)/);
});

test('la activacion cliente cierra el progreso cuando la terminal esta ocupada', () => {
  assert.match(
    terminalSelectorSource,
    /if \(response\.status === 409\) \{[\s\S]*?keepAuthorizationModalOpen = true;[\s\S]*?closeBindingProgress\(\);/
  );
  assert.match(terminalSelectorSource, /message: 'La terminal está ocupada por otro equipo\.'/);
});

test('la reasignacion de una cliente se resuelve exclusivamente en la Maestra local', () => {
  assert.doesNotMatch(terminalSelectorSource, /authorizeTerminalTakeoverFromErp/);
  assert.doesNotMatch(terminalSelectorSource, /ERP_TERMINAL_TAKEOVER/);
  assert.match(terminalSelectorSource, /force_transfer: forceTransfer/);
  assert.match(serverSource, /persistTerminalBinding\(id, deviceId\)/);
  assert.match(serverSource, /applyPersistedBindings/);
  assert.match(terminalSelectorSource, /Autorizar este equipo y liberar el anterior/);
});

test('el servidor Master Android acepta preflight de red privada y ambos headers de device', () => {
  assert.match(serverSource, /Access-Control-Allow-Private-Network: true/);
  assert.match(serverSource, /X-Device-Id, X-POS-Device-Id/);
});
