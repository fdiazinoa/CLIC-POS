import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildCustomerDisplayUrl,
  isCustomerDisplaySurface,
  isCustomerDisplayView,
  launchCustomerDisplay,
  recoverNativePrimaryDisplayUrl,
} from '../utils/customerDisplay';

const androidNavigator = { userAgent: 'Mozilla/5.0 (Linux; Android 13; wv)' };
const browserNavigator = { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/126' };

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

const installBrowserRuntime = (windowValue: Record<string, unknown>) => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: browserNavigator,
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
    url: 'https://localhost/?view=VISOR&surface=SECONDARY',
    welcomeMessage: 'Bienvenido',
  });
  assert.deepEqual(result, {
    opened: true,
    mode: 'HDMI',
    url: 'https://localhost/?view=VISOR&surface=SECONDARY',
    usedSecondScreen: true,
  });
});

test('recupera la superficie principal Android si el WebView restaura view=VISOR', () => {
  let replacedUrl = '';
  installAndroidRuntime({
    location: {
      href: 'https://localhost/?view=VISOR&surface=SECONDARY',
      search: '?view=VISOR&surface=SECONDARY',
    },
    history: {
      state: { preserved: true },
      replaceState: (_state: unknown, _title: string, url: string) => {
        replacedUrl = url;
      },
    },
    AndroidCustomerDisplay: {
      launch: () => '{}',
    },
  });

  assert.equal(isCustomerDisplaySurface(), false);
  assert.equal(recoverNativePrimaryDisplayUrl(), true);
  assert.equal(replacedUrl, '/');
});

test('mantiene el Presentation Android como superficie secundaria', () => {
  installAndroidRuntime({
    location: {
      href: 'https://localhost/?view=VISOR&surface=SECONDARY',
      search: '?view=VISOR&surface=SECONDARY',
    },
    history: {
      state: null,
      replaceState: () => assert.fail('no debe reescribir la URL del Presentation'),
    },
  });

  assert.equal(isCustomerDisplaySurface(), true);
  assert.equal(recoverNativePrimaryDisplayUrl(), false);
});

test('identifica VISOR como estado exclusivo de la segunda pantalla', () => {
  assert.equal(isCustomerDisplayView('VISOR'), true);
  assert.equal(isCustomerDisplayView('POS'), false);
  assert.equal(isCustomerDisplayView(undefined), false);
});

test('mantiene compatible el visor por navegador y marca las URLs de red', () => {
  installBrowserRuntime({
    location: {
      href: 'https://pos.example.test/?view=VISOR',
      search: '?view=VISOR',
      pathname: '/',
      origin: 'https://pos.example.test',
    },
  });

  assert.equal(isCustomerDisplaySurface(), true);
  assert.equal(buildCustomerDisplayUrl({
    isEnabled: true,
    welcomeMessage: 'Bienvenido',
    showItemImages: true,
    showQrPayment: true,
    layout: 'SPLIT',
    connectionType: 'NETWORK',
    ipAddress: '10.0.0.50:3000',
    ads: [],
  }), 'http://10.0.0.50:3000/?view=VISOR&surface=SECONDARY');
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

test('MainActivity recupera la superficie primaria después de que Capacitor termina de cargar', () => {
  const mainActivitySource = readFileSync(
    new URL('../android/app/src/main/java/com/clicpos/app/MainActivity.java', import.meta.url),
    'utf8',
  );
  const customerDisplayBridgeSource = readFileSync(
    new URL('../native-stubs/android/ClicPOSCustomerDisplayBridge.kt', import.meta.url),
    'utf8',
  );
  const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

  assert.match(mainActivitySource, /onPageLoaded\(WebView loadedWebView\)/);
  assert.match(
    mainActivitySource,
    /AndroidCustomerDisplayBridge\.recoverPrimarySurface\(loadedWebView\)/,
  );
  assert.match(customerDisplayBridgeSource, /searchParams\.delete\('view'\)/);
  assert.match(customerDisplayBridgeSource, /searchParams\.delete\('surface'\)/);
  assert.match(appSource, /if \(isCustomerDisplayView\(currentView\)\) return;/);
  assert.match(appSource, /'DEVICE_UNAUTHORIZED',\s*'VISOR',/);
  assert.match(
    customerDisplayBridgeSource,
    /it\.displayId != Display\.DEFAULT_DISPLAY && !isCaptureDisplay\(it\)/,
  );
  assert.match(customerDisplayBridgeSource, /it\.flags and Display\.FLAG_SECURE != 0/);
  assert.match(customerDisplayBridgeSource, /normalizedName\.contains\("anydesk"\)/);
  assert.match(
    customerDisplayBridgeSource,
    /WindowManager\.LayoutParams\.FLAG_NOT_FOCUSABLE[\s\S]*WindowManager\.LayoutParams\.FLAG_NOT_TOUCHABLE/,
    'el visor secundario debe ser una ventana no interactiva para no capturar el touch principal',
  );
  assert.match(
    customerDisplayBridgeSource,
    /activity\.window\.clearFlags\(WindowManager\.LayoutParams\.FLAG_NOT_TOUCHABLE\)/,
    'la ventana principal debe conservar explícitamente su capacidad táctil',
  );
});

test('el Presentation del visor omite bootstrap y bloqueadores del POS', () => {
  const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const bootstrapBypassIndex = appSource.indexOf(
    "Customer visor surface: skipping POS data and security bootstrap.",
  );
  const loadDataIndex = appSource.indexOf('const loadData = async () =>');
  const visorRenderIndex = appSource.indexOf(
    'if (isCustomerDisplaySurface()) {\n    return <CustomerVisor />;',
  );
  const dataBlockerIndex = appSource.indexOf('if (!isDataLoaded) {', visorRenderIndex);
  const securityBlockerIndex = appSource.indexOf('if (!isSecurityLoaded) {', visorRenderIndex);

  assert.ok(bootstrapBypassIndex >= 0, 'el visor debe declarar el bypass de bootstrap');
  assert.ok(
    bootstrapBypassIndex < loadDataIndex,
    'el bypass debe ejecutarse antes de inicializar la base de datos del POS',
  );
  assert.ok(visorRenderIndex >= 0, 'el visor debe tener un render dedicado');
  assert.ok(
    visorRenderIndex < dataBlockerIndex,
    'el visor debe renderizar antes del bloqueador de datos',
  );
  assert.ok(
    visorRenderIndex < securityBlockerIndex,
    'el visor debe renderizar antes del bloqueador de seguridad',
  );
});
