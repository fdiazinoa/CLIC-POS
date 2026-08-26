import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  normalizeScannerQuantity,
  resolveScannerQuantityMode,
} from '../utils/scannerQuantity';

const scannerHookSource = readFileSync(new URL('../hooks/useBarcodeScanner.ts', import.meta.url), 'utf8');
const posSource = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('../components/SettingsOperational.tsx', import.meta.url), 'utf8');

test('el lector agrega una unidad por defecto y permite activar solicitud de cantidad', () => {
  assert.equal(resolveScannerQuantityMode(null), 'UNIT');
  assert.equal(resolveScannerQuantityMode({ operational: {} } as any), 'UNIT');
  assert.equal(resolveScannerQuantityMode({
    operational: { scannerQuantityMode: 'PROMPT' },
  } as any), 'PROMPT');
});

test('normaliza cantidades escaneadas a un rango seguro', () => {
  assert.equal(normalizeScannerQuantity(undefined), 1);
  assert.equal(normalizeScannerQuantity(0), 1);
  assert.equal(normalizeScannerQuantity('2.375'), 2.375);
  assert.equal(normalizeScannerQuantity(20_000), 9_999);
});

test('el capturador PDA admite Enter, Tab y lectores sin sufijo en campos marcados', () => {
  assert.match(scannerHookSource, /e\.key === 'Enter' \|\| e\.key === 'Tab'/);
  assert.match(scannerHookSource, /barcodeScannerTarget === 'true'/);
  assert.match(scannerHookSource, /if \(isScannerTarget\) emitScan\(buffer\.current\)/);
  assert.match(posSource, /data-barcode-scanner-target="true"/);
});

test('el POS valida el artículo y aplica el modo de cantidad configurado', () => {
  assert.match(posSource, /resolveScannerQuantityMode\(activeTerminalConfig\) === 'PROMPT'/);
  assert.match(posSource, /Producto agregado: \$\{match\.product\.name\} · Cantidad/);
  assert.match(posSource, /Artículo validado/);
  assert.match(posSource, /Código no encontrado:/);
  assert.match(settingsSource, /Solicitar cantidad al escanear/);
  assert.match(settingsSource, /agrega 1 inmediatamente/);
});

