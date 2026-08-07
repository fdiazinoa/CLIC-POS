import assert from 'node:assert/strict';
import test from 'node:test';

import { launchCustomerDisplay } from '../utils/customerDisplay';

const androidNavigator = { userAgent: 'Mozilla/5.0 (Linux; Android 13; wv)' };

const installAndroidRuntime = (windowValue: Record<string, unknown>) => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: androidNavigator,
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: windowValue,
  });
};

test.afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'navigator');
});

test('lanza el visor mediante el puente Android directo cuando el shim se perdió al cargar el WebView', async () => {
  let receivedPayload: Record<string, unknown> | null = null;
  installAndroidRuntime({
    AndroidCustomerDisplay: {
      launch: (payload: string) => {
        receivedPayload = JSON.parse(payload);
        return JSON.stringify({
          success: true,
          opened: true,
          mode: 'HDMI',
          usedSecondScreen: true,
          displayName: 'Pantalla HDMI',
        });
      },
    },
  });

  const result = await launchCustomerDisplay({
    isEnabled: true,
    welcomeMessage: 'Bienvenido',
    showItemImages: true,
    showQrPayment: true,
    layout: 'SPLIT',
    connectionType: 'HDMI',
    ipAddress: '',
    ads: [],
  });

  assert.deepEqual(receivedPayload, {
    mode: 'HDMI',
    url: 'https://localhost/?view=VISOR',
    welcomeMessage: 'Bienvenido',
  });
  assert.deepEqual(result, {
    opened: true,
    mode: 'HDMI',
    url: 'https://localhost/?view=VISOR',
    usedSecondScreen: true,
  });
});

test('mantiene preferencia por el shim Android cuando sigue disponible', async () => {
  let directBridgeCalls = 0;
  installAndroidRuntime({
    ClicPOSCustomerDisplay: {
      launch: async () => ({
        success: true,
        opened: true,
        mode: 'ANDROID_SECONDARY',
        usedSecondScreen: true,
      }),
    },
    AndroidCustomerDisplay: {
      launch: () => {
        directBridgeCalls += 1;
        return '{}';
      },
    },
  });

  const result = await launchCustomerDisplay({
    isEnabled: true,
    welcomeMessage: 'Bienvenido',
    showItemImages: true,
    showQrPayment: true,
    layout: 'SPLIT',
    connectionType: 'ANDROID_SECONDARY',
    ipAddress: '',
    ads: [],
  });

  assert.equal(result.opened, true);
  assert.equal(result.mode, 'ANDROID_SECONDARY');
  assert.equal(directBridgeCalls, 0);
});
