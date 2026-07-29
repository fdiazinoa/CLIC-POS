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

test('la activacion cliente usa transporte nativo con timeout para todo el handshake', () => {
  assert.match(terminalSelectorSource, /requestMasterSetup<TerminalSelectorResponse>/);
  assert.match(terminalSelectorSource, /buildMasterClaimUrl\(apiBase, bindTerminalRequestBody\)/);
  assert.match(terminalSelectorSource, /stage: 'BIND_TERMINAL'/);
  assert.match(terminalSelectorSource, /stage: 'INITIAL_CONFIG'/);
  assert.match(terminalSelectorSource, /const timeoutMs = 12000/);
  assert.match(terminalSelectorSource, /Promise\.race\(\[request, hardTimeout\]\)/);
});

test('el servidor Master Android acepta preflight de red privada y ambos headers de device', () => {
  assert.match(serverSource, /Access-Control-Allow-Private-Network: true/);
  assert.match(serverSource, /X-Device-Id, X-POS-Device-Id/);
});
