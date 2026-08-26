import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manifestSource = readFileSync(
  new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url),
  'utf8',
);
const scannerSource = readFileSync(
  new URL('../components/BarcodeScannerModal.tsx', import.meta.url),
  'utf8',
);

test('el APK declara el permiso requerido por getUserMedia para escanear', () => {
  assert.match(manifestSource, /<uses-permission android:name="android\.permission\.CAMERA"\s*\/>/);
  assert.match(scannerSource, /html5QrCode\.start\(/);
  assert.match(scannerSource, /Html5Qrcode\.getCameras\(\)/);
  assert.match(scannerSource, /selectPreferredBackCameraId\(cameras\)/);
  assert.match(scannerSource, /facingMode:\s*"environment"/);
  assert.match(
    scannerSource,
    /new Html5Qrcode\(regionId,\s*\{[\s\S]*?useBarCodeDetectorIfSupported:\s*false/,
  );
});

test('la cámara es opcional para mantener compatibles los POS sin cámara', () => {
  assert.match(
    manifestSource,
    /<uses-feature android:name="android\.hardware\.camera" android:required="false"\s*\/>/,
  );
  assert.match(
    manifestSource,
    /<uses-feature android:name="android\.hardware\.camera\.any" android:required="false"\s*\/>/,
  );
});
