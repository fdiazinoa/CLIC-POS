import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const serverSource = readFileSync(
  new URL('../native-stubs/android/ClicPOSMasterHttpServer.kt', import.meta.url),
  'utf8',
);

test('el servidor Master Android expone el contrato completo de activacion cliente', () => {
  assert.match(serverSource, /path == "\/api\/setup\/terminals"/);
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
