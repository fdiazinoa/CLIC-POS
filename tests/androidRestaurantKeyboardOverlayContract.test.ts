import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const activitySource = readFileSync(
  new URL('../android/app/src/main/java/com/clicpos/app/MainActivity.java', import.meta.url),
  'utf8',
);
const posSource = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');

test('Android exposes a scoped keyboard overlay mode and preserves resize as the default', () => {
  assert.match(activitySource, /keyboardOverlayMode\s*\?\s*WindowManager\.LayoutParams\.SOFT_INPUT_ADJUST_NOTHING/);
  assert.match(activitySource, /:\s*WindowManager\.LayoutParams\.SOFT_INPUT_ADJUST_RESIZE/);
  assert.match(activitySource, /public void setKeyboardOverlayMode\(boolean enabled\)/);
});

test('restaurant POS enables overlay mode and restores the default when leaving', () => {
  assert.match(posSource, /if \(!isRestaurantMode \|\| !\(Capacitor\.isNativePlatform\(\)/);
  assert.match(posSource, /androidBridge\.setKeyboardOverlayMode\(true\)/);
  assert.match(posSource, /return \(\) => androidBridge\.setKeyboardOverlayMode\?\.\(false\)/);
});
