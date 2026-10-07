import test from 'node:test';
import assert from 'node:assert/strict';
import { Capacitor } from '@capacitor/core';
import { assertLargeMasterSyncV3NativeAndroid } from '../services/sync/LargeMasterSyncV3Platform';
import { assertLargeMasterSyncV3CanaryEmulator } from '../services/sync/LargeMasterSyncV3Canary';

test('operational Android supports physical terminals while canary remains emulator-only', () => {
  const native = Capacitor.isNativePlatform;
  const platform = Capacitor.getPlatform;
  const global = globalThis as typeof globalThis & { ClicPOSAppBridge?: { isEmulator?: () => boolean } };
  const bridge = global.ClicPOSAppBridge;
  try {
    Capacitor.isNativePlatform = () => true;
    Capacitor.getPlatform = () => 'android';
    global.ClicPOSAppBridge = { isEmulator: () => false };
    assert.doesNotThrow(assertLargeMasterSyncV3NativeAndroid);
    assert.throws(assertLargeMasterSyncV3CanaryEmulator, /SYNC_V3_CANARY_EMULATOR_REQUIRED/);
    delete global.ClicPOSAppBridge;
    assert.doesNotThrow(assertLargeMasterSyncV3NativeAndroid);
    assert.throws(assertLargeMasterSyncV3CanaryEmulator, /SYNC_V3_CANARY_EMULATOR_REQUIRED/);
    global.ClicPOSAppBridge = { isEmulator: () => true };
    assert.doesNotThrow(assertLargeMasterSyncV3NativeAndroid);
    assert.doesNotThrow(assertLargeMasterSyncV3CanaryEmulator);
    Capacitor.getPlatform = () => 'ios';
    assert.throws(assertLargeMasterSyncV3NativeAndroid, /SYNC_V3_NATIVE_ANDROID_REQUIRED/);
    Capacitor.getPlatform = () => 'web';
    Capacitor.isNativePlatform = () => false;
    assert.throws(assertLargeMasterSyncV3NativeAndroid, /SYNC_V3_NATIVE_ANDROID_REQUIRED/);
  } finally {
    Capacitor.isNativePlatform = native;
    Capacitor.getPlatform = platform;
    if (bridge === undefined) delete global.ClicPOSAppBridge;
    else global.ClicPOSAppBridge = bridge;
  }
});
