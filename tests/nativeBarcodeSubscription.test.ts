import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { attachNativeBarcodeSubscription } from '../utils/nativeBarcodeSubscription';
import { canReceiveNativeBarcode } from '../utils/globalBarcodeCapture';

function harness() {
  const win = new EventTarget();
  let enabled = true;
  let canReceive = true;
  let starts = 0;
  let removes = 0;
  const callbacks: Array<(code: string) => void> = [];
  const resolve: Array<(handle: { remove(): Promise<void> }) => void> = [];
  const scans: string[] = [];
  let recipient = (code: string) => scans.push(code);
  const attach = () => attachNativeBarcodeSubscription(win, {
    subscribe: callback => { callbacks.push(callback); return new Promise(r => resolve.push(r)); },
    start: async () => { starts++; }, isEnabled: () => enabled, settingEvent: 'setting',
    canReceive: () => canReceive, getCallback: () => recipient,
  });
  const ready = async (index: number) => {
    resolve[index]({ remove: async () => { removes++; } });
    await Promise.resolve();
  };
  return { win, attach, ready, scans, callbacks,
    disable: () => { enabled = false; }, enable: () => { enabled = true; },
    block: () => { canReceive = false; },
    replace: () => { recipient = code => scans.push(`new:${code}`); },
    stats: () => ({ starts, removes }),
  };
}

test('late async subscription is removed after unmount, without starting or dispatching', async () => {
  const h = harness(); const cleanup = h.attach(); cleanup();
  await h.ready(0); h.callbacks[0]('1234');
  h.win.dispatchEvent(new Event('setting'));
  assert.deepEqual(h.scans, []);
  assert.deepEqual(h.stats(), { starts: 0, removes: 1 });
});

test('StrictMode remount leaves exactly one native recipient, preserving intentional repeat scans', async () => {
  const h = harness(); const old = h.attach(); old();
  const cleanup = h.attach(); await h.ready(1); await h.ready(0);
  for (let i = 0; i < 2; i++) h.callbacks.forEach(cb => cb('1234'));
  assert.deepEqual(h.scans, ['1234', '1234']);
  cleanup(); h.callbacks.forEach(cb => cb('1234'));
  assert.deepEqual(h.stats(), { starts: 1, removes: 2 });
  assert.equal(h.scans.length, 2);
});

test('setting toggles, latest callbacks and modal boundary apply at delivery time', async () => {
  const h = harness(); const cleanup = h.attach(); await h.ready(0);
  h.callbacks[0](' 1234 '); h.replace(); h.callbacks[0]('1234');
  h.disable(); h.win.dispatchEvent(new Event('setting')); h.callbacks[0]('1234');
  h.enable(); h.win.dispatchEvent(new Event('setting')); h.block(); h.callbacks[0]('1234');
  assert.deepEqual(h.scans, ['1234', 'new:1234']);
  assert.equal(h.stats().starts, 2); cleanup();
});

test('native input uses editable/modal/visibility guards including the quiet sales receiver', () => {
  let blocked = false;
  const doc = { visibilityState: 'visible', activeElement: { tagName: 'BODY' }, querySelector: () => blocked ? {} : null };
  const allowed = () => canReceiveNativeBarcode(doc as unknown as Document);
  assert.equal(allowed(), true);
  doc.activeElement = { tagName: 'INPUT', dataset: {} } as any;
  assert.equal(allowed(), false);
  doc.activeElement = { tagName: 'INPUT', dataset: { barcodeScannerTarget: 'true' } } as any;
  assert.equal(allowed(), true);
  (doc.activeElement as any).disabled = true; assert.equal(allowed(), false);
  (doc.activeElement as any).disabled = false;
  blocked = true; assert.equal(allowed(), false);
  blocked = false; doc.visibilityState = 'hidden'; assert.equal(allowed(), false);
});

test('only central App opts in; POS and catalog do not register native listeners', () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  assert.match(read('App.tsx'), /useBarcodeScanner\(\{\s*nativeOwner: true,\s*enabled: scannerEnabledViews/);
  assert.doesNotMatch(read('components/POSInterface.tsx'), /listenZebraBarcode|nativeOwner/);
  assert.doesNotMatch(read('components/CatalogManager.tsx'), /listenZebraBarcode|nativeOwner/);
  assert.match(read('hooks/useBarcodeScanner.ts'), /nativeOwner = false/);
});
