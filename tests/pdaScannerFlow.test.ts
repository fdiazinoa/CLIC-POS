import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  normalizeScannerQuantity,
  resolveScannerQuantityMode,
  resolveScannerQuantityPreference,
  scannerQuantityPreferenceKey,
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

test('la preferencia local por terminal prevalece sobre la configuración heredada', () => {
  assert.equal(scannerQuantityPreferenceKey('PDA-01'), 'clic_pos_scanner_quantity_mode:PDA-01');
  assert.equal(resolveScannerQuantityPreference('PROMPT', 'UNIT'), 'PROMPT');
  assert.equal(resolveScannerQuantityPreference('UNIT', 'PROMPT'), 'UNIT');
  assert.equal(resolveScannerQuantityPreference(null, 'PROMPT'), 'PROMPT');
});

test('el capturador PDA admite Enter, Tab y lectores sin sufijo en campos marcados', () => {
  assert.match(scannerHookSource, /e\.key === 'Enter' \|\| e\.key === 'Tab'/);
  assert.match(scannerHookSource, /barcodeScannerTarget === 'true'/);
  assert.match(scannerHookSource, /fieldCode\.length >= 3 \? fieldCode : bufferedCode/);
  assert.match(scannerHookSource, /window\.addEventListener\('input', handleGlobalInput, true\)/);
  assert.match(scannerHookSource, /emitScan\(target\.value\)/);
  assert.match(posSource, /data-barcode-scanner-target="true"/);
});

test('el POS valida el artículo y aplica el modo de cantidad configurado', () => {
  assert.match(posSource, /scannerQuantityMode === 'PROMPT'/);
  assert.match(posSource, /Modo lector: agregar 1 unidad/);
  assert.match(posSource, /Modo lector: solicitar cantidad/);
  assert.match(posSource, /Pedir cant\./);
  assert.match(posSource, /Producto agregado: \$\{match\.product\.name\} · Cantidad/);
  assert.match(posSource, /Artículo validado/);
  assert.match(posSource, /Código no encontrado:/);
  assert.match(settingsSource, /Solicitar cantidad al escanear/);
  assert.match(settingsSource, /agrega 1 inmediatamente/);
});
