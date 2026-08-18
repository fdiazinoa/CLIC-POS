import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildEscPosHardwareTestPayload } from '../services/printer/EscPosFormatter';

test('la prueba de impresora incluye inicializacion, avance y corte ESC/POS', () => {
  const payload = buildEscPosHardwareTestPayload({
    printerName: 'ticket',
    connection: 'NETWORK',
    address: '10.0.0.151',
    printedAt: '18/8/2026 4:20:00 p. m.',
  });
  const bytes = Buffer.from(payload, 'base64');

  assert.deepEqual([...bytes.subarray(0, 2)], [0x1b, 0x40]);
  assert.ok(bytes.includes(Buffer.from('PRUEBA DE IMPRESORA')));
  assert.ok(bytes.includes(Buffer.from('10.0.0.151')));
  assert.deepEqual([...bytes.subarray(-4)], [0x1d, 0x56, 0x42, 0x00]);
  assert.ok(bytes.subarray(-8, -4).filter(value => value === 0x0a).length >= 2);
});

test('la prueba de red usa el bridge ESC/POS en lugar de HTML sin corte', () => {
  const source = readFileSync(new URL('../components/HardwareSettings.tsx', import.meta.url), 'utf8');

  assert.match(source, /printer\.connection \|\| ''\)\.toUpperCase\(\) === 'NETWORK'/);
  assert.match(source, /nativePrintBridge\.printEscPos\(/);
  assert.match(source, /buildEscPosHardwareTestPayload\(/);
});

test('las copias de red se agrupan en un solo socket nativo', () => {
  const source = readFileSync(
    new URL('../native-stubs/android/ClicPOSNativePrinterBridge.kt', import.meta.url),
    'utf8',
  );

  assert.match(source, /connection == "NETWORK"/);
  assert.match(source, /repeatNetworkPayload\(rawBytes, copies\)/);
  assert.match(source, /ByteArray\(rawBytes\.size \* safeCopies\)/);
  assert.match(source, /copias enviadas en un solo trabajo de red/);
});
