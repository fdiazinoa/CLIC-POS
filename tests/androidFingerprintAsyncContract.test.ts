import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bridgeSource = readFileSync(
  new URL('../native-stubs/android/ClicPOSNativePrinterBridge.kt', import.meta.url),
  'utf8',
);
const mainActivitySource = readFileSync(
  new URL('../android/app/src/main/java/com/clicpos/app/MainActivity.java', import.meta.url),
  'utf8',
);

test('la captura automática se ejecuta fuera del hilo JavaScript', () => {
  assert.match(bridgeSource, /fun verifyFingerprintAsync\(payloadJson: String\?\): String/);
  assert.match(bridgeSource, /Thread\(\{[\s\S]*?verifyFingerprintPayload\(payload\)/);
  assert.match(bridgeSource, /clic:fingerprint-verification-result/);
  assert.match(bridgeSource, /fingerprintVerificationInFlight\.compareAndSet\(false, true\)/);
});

test('el bridge recibe el WebView para publicar el resultado asíncrono', () => {
  assert.match(
    mainActivitySource,
    /new AndroidPrinterBridge\(getApplicationContext\(\), webView\)/,
  );
  assert.match(bridgeSource, /webView\.post\s*\{/);
  assert.match(bridgeSource, /webView\.evaluateJavascript\(/);
});
