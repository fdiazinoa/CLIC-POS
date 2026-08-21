import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainActivitySource = readFileSync(
  new URL('../android/app/src/main/java/com/clicpos/app/MainActivity.java', import.meta.url),
  'utf8',
);
const manifestSource = readFileSync(
  new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url),
  'utf8',
);
const activationSource = readFileSync(
  new URL('../components/ActivationScreen.tsx', import.meta.url),
  'utf8',
);
const globalKeyboardSource = readFileSync(
  new URL('../components/GlobalVirtualKeyboard.tsx', import.meta.url),
  'utf8',
);

test('la activación Android permite mostrar y redimensionar el teclado virtual', () => {
  assert.match(mainActivitySource, /SOFT_INPUT_STATE_UNSPECIFIED/);
  assert.match(mainActivitySource, /SOFT_INPUT_ADJUST_RESIZE/);
  assert.doesNotMatch(mainActivitySource, /SOFT_INPUT_STATE_ALWAYS_HIDDEN/);
  assert.doesNotMatch(mainActivitySource, /SOFT_INPUT_ADJUST_NOTHING/);
  assert.doesNotMatch(mainActivitySource, /SOFT_INPUT_ADJUST_PAN/);
  assert.match(manifestSource, /android:windowSoftInputMode="adjustResize"/);
});

test('la política del teclado conserva la pantalla activa y el campo de contraseña enfocable', () => {
  assert.match(mainActivitySource, /FLAG_KEEP_SCREEN_ON/);
  assert.match(activationSource, /<input\s+[\s\S]*?type="password"[\s\S]*?value=\{password\}/);
});

test('Android solicita LatinIME desde el puente nativo al tocar un campo editable', () => {
  assert.match(mainActivitySource, /@JavascriptInterface\s+public void showSoftKeyboard\(\)/);
  assert.match(mainActivitySource, /inputMethodManager\.showSoftInput\(webView, InputMethodManager\.SHOW_IMPLICIT\)/);
  assert.match(mainActivitySource, /controller\.show\(WindowInsets\.Type\.ime\(\)\)/);
  assert.match(globalKeyboardSource, /Capacitor\.getPlatform\(\) === 'android'/);
  assert.match(globalKeyboardSource, /document\.addEventListener\('pointerup', handlePointerUp, true\)/);
  assert.match(globalKeyboardSource, /bridge\?\.showSoftKeyboard\?\.\(\)/);
});

test('Android no abre el IME por autofocus o escáner y admite exclusiones explícitas', () => {
  assert.doesNotMatch(globalKeyboardSource, /addEventListener\('focusin',[\s\S]*showSoftKeyboard/);
  assert.match(globalKeyboardSource, /data-disable-native-soft-keyboard/);
  assert.match(globalKeyboardSource, /target\.disabled \|\| target\.readOnly/);
});
