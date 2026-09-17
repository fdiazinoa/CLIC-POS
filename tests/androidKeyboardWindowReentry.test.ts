import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const activitySource = readFileSync(
  new URL('../android/app/src/main/java/com/clicpos/app/MainActivity.java', import.meta.url), 'utf8',
);

test('production keyboard window policy executes initial/reentry/recreation and overlay state on JVM', () => {
  const output = execFileSync('bash', [fileURLToPath(
    new URL('../scripts/qa/test-keyboard-window-policy-jvm.sh', import.meta.url),
  )], { encoding: 'utf8', timeout: 30_000 });
  assert.match(output, /PASS: production PosKeyboardWindowPolicy 24 state\/mask checks/);
});

test('MainActivity chooses and applies current lifecycle policy before super.onResume', () => {
  assert.match(activitySource, /private final PosKeyboardWindowPolicy keyboardWindowPolicy = new PosKeyboardWindowPolicy\(\);/);
  const resume = activitySource.match(/public void onResume\(\) \{([\s\S]*?)\n {4}\}/)?.[1];
  assert.ok(resume);
  assert.match(resume, /keyboardWindowPolicy\.onResume\(\);\s*enforcePosWindowPolicy\(\);\s*super\.onResume\(\);\s*enforcePosWindowPolicy\(\);/);
  assert.equal(resume.match(/super\.onResume\(\)/g)?.length, 1);
  assert.match(activitySource, /keyboardWindowPolicy\.resolveSoftInputMode\(\s*WindowManager\.LayoutParams\.SOFT_INPUT_STATE_UNSPECIFIED,\s*WindowManager\.LayoutParams\.SOFT_INPUT_STATE_UNCHANGED,\s*keyboardOverlayMode/);
  assert.match(activitySource, /public void setKeyboardOverlayMode\(boolean enabled\) \{\s*keyboardOverlayMode = enabled;\s*runOnUiThread\(\(\) -> enforcePosWindowPolicy\(\)\);/);
  assert.match(activitySource, /getWindow\(\)\.addFlags\(WindowManager\.LayoutParams\.FLAG_KEEP_SCREEN_ON\)/);
  assert.doesNotMatch(activitySource, /SOFT_INPUT_STATE_(?:ALWAYS_)?HIDDEN|hideSoftInputFromWindow/);
});
