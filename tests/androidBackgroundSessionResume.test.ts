import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { shouldRestoreNativeSession } from '../utils/nativeSessionResume';

const now = Date.parse('2026-09-01T17:30:00.000Z');

test('restores the operator only when Android recreates the same activity', () => {
  assert.equal(shouldRestoreNativeSession({
    launchContext: 'activity_recreated',
    forceLogin: false,
    savedAt: '2026-09-01T17:29:30.000Z',
    autoLogoutMinutes: 15,
    currentTerminalId: 'terminal-1',
    sessionTerminalId: 'terminal-1',
    now,
  }), true);

  assert.equal(shouldRestoreNativeSession({
    launchContext: 'fresh_start',
    forceLogin: false,
    savedAt: '2026-09-01T17:29:30.000Z',
    autoLogoutMinutes: 15,
    now,
  }), false);
});

test('does not restore after explicit exit, inactivity timeout, or terminal change', () => {
  assert.equal(shouldRestoreNativeSession({
    launchContext: 'activity_recreated',
    forceLogin: true,
    savedAt: '2026-09-01T17:29:30.000Z',
    autoLogoutMinutes: 15,
    now,
  }), false);

  assert.equal(shouldRestoreNativeSession({
    launchContext: 'activity_recreated',
    forceLogin: false,
    savedAt: '2026-09-01T17:00:00.000Z',
    autoLogoutMinutes: 15,
    now,
  }), false);

  assert.equal(shouldRestoreNativeSession({
    launchContext: 'activity_recreated',
    forceLogin: false,
    savedAt: '2026-09-01T17:29:30.000Z',
    autoLogoutMinutes: 15,
    currentTerminalId: 'terminal-2',
    sessionTerminalId: 'terminal-1',
    now,
  }), false);
});

test('a terminal with auto logout disabled can resume a recreated activity', () => {
  assert.equal(shouldRestoreNativeSession({
    launchContext: 'activity_recreated',
    forceLogin: false,
    autoLogoutMinutes: 0,
    now,
  }), true);
});

test('Android bridge treats saved state and Recents/history as resumable reconstruction', () => {
  const mainActivity = readFileSync(
    new URL('../android/app/src/main/java/com/clicpos/app/MainActivity.java', import.meta.url),
    'utf8',
  );
  const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

  assert.match(mainActivity, /Intent\.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY/);
  assert.match(mainActivity, /activityRecreated\s*=\s*savedInstanceState\s*!=\s*null\s*\|\|\s*launchedFromHistory/);
  assert.match(mainActivity, /public String getLaunchContext\(\)/);
  assert.match(mainActivity, /activity_recreated/);
  assert.match(appSource, /persistActiveUserSession\(currentUserRef\.current, currentViewRef\.current\)/);
  assert.match(appSource, /shouldRestoreNativeSession\(\{/);
});
