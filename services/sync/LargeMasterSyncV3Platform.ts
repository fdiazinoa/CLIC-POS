import { Capacitor } from '@capacitor/core';
import { LargeMasterSyncV3Error } from './LargeMasterSyncV3Types';

/** Operational V3 uses native Android SQLite on physical terminals and emulators. */
export const assertLargeMasterSyncV3NativeAndroid = (): void => {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    throw new LargeMasterSyncV3Error('SYNC_V3_NATIVE_ANDROID_REQUIRED');
  }
};
