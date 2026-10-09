import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ScaleDevice } from '../types';
import { SCALE_PRESETS, ZEBRA_USB_CONFIG, applyScalePreset, applyLocalZebraSetting, canConfigureLocalZebra } from '../utils/scalePresets';

const serial = (): ScaleDevice => ({ id: 'legacy', name: 'Mi balanza', technology: 'DIRECT', isEnabled: true,
  directConfig: { port: '/dev/ttyUSB7', baudRate: 19200, dataBits: 8, protocol: 'Standard' } });
const preset = (id: string) => SCALE_PRESETS.find(item => item.id === id)!;
const local = { platform: 'android', selectedTerminalId: 'T99', localTerminalId: 'T99' };

test('Zebra preset resolves USB automatic SNAPI without changing serial values or shared records', () => {
  const original = serial(); const shared = [original]; const before = structuredClone(shared);
  const selection = applyScalePreset(original, preset('ZEBRA_MP7000'));
  assert.equal(selection.driver, 'ZEBRA_USB');
  assert.deepEqual(selection.usb, { connection: 'USB', port: 'USB_AUTO', protocol: 'SNAPI' });
  assert.deepEqual(selection.scale, original);
  assert.deepEqual(shared, before);
  assert.deepEqual(ZEBRA_USB_CONFIG, selection.usb);
  assert.equal('driver' in shared[0], false);
});

test('selecting Zebra then serial restores arbitrary COM/device port with preset parameters', () => {
  const original = serial(); const zebra = applyScalePreset(original, preset('ZEBRA_MP7000'));
  const cas = applyScalePreset(zebra.scale, preset('CAS_PD2'));
  assert.equal(cas.driver, 'SERIAL');
  assert.equal(cas.scale.name, 'CAS PD-II / ER');
  assert.deepEqual(cas.scale.directConfig, { port: '/dev/ttyUSB7', baudRate: 9600, dataBits: 7, protocol: 'NCI' });
  const manual = applyScalePreset(zebra.scale, preset('MANUAL'));
  assert.equal(manual.scale.name, 'Mi balanza');
  assert.equal(manual.scale.directConfig?.port, '/dev/ttyUSB7');
  assert.deepEqual(original, serial());
});

test('legacy missing directConfig and label settings keep previous preset semantics', () => {
  const original: ScaleDevice = { id: 'label', name: 'Etiquetas', isEnabled: false, technology: 'LABEL',
    labelConfig: { mode: 'WEIGHT', prefixes: ['20'], decimals: 3, itemDigits: 5, valueDigits: 5 } };
  const result = applyScalePreset(original, preset('DIBAL_G310'));
  assert.equal(result.scale.technology, 'LABEL');
  assert.equal(result.scale.isEnabled, false);
  assert.deepEqual(result.scale.labelConfig, original.labelConfig);
  assert.deepEqual(result.scale.directConfig, { port: 'COM1', baudRate: 9600, dataBits: 8, protocol: 'Protocolo T' });
  assert.equal(original.directConfig, undefined);
});

test('selection and cancel have zero native/storage effects; only explicit local Apply invokes setter', async () => {
  const calls: boolean[] = [];
  const setter = async (enabled: boolean) => { calls.push(enabled); };
  applyScalePreset(serial(), preset('ZEBRA_MP7000'));
  assert.deepEqual(calls, []);
  await applyLocalZebraSetting(local, true, setter);
  await applyLocalZebraSetting(local, false, setter);
  assert.deepEqual(calls, [true, false]);
});

for (const scope of [
  { ...local, platform: 'web' }, { ...local, platform: 'ios' },
  { ...local, selectedTerminalId: 'T1' }, { ...local, localTerminalId: null },
  { ...local, localTerminalId: '' }, { ...local, localTerminalId: ' ' },
]) {
  test(`scope ${JSON.stringify(scope)} cannot operate native Zebra`, async () => {
    let calls = 0;
    assert.equal(canConfigureLocalZebra(scope), false);
    await assert.rejects(applyLocalZebraSetting(scope, true, async () => { calls++; }), /terminal activa/);
    assert.equal(calls, 0);
  });
}

test('storage or native rejection propagates to the UI action without false success', async () => {
  const error = new Error('Permiso USB rechazado');
  await assert.rejects(applyLocalZebraSetting(local, true, async () => { throw error; }), error);
});

test('Hardware form keeps explicit local Apply separate from global save and removes setting listener', () => {
  const source = readFileSync(new URL('../components/HardwareSettings.tsx', import.meta.url), 'utf8');
  const saveAllStart = source.indexOf('const handleSaveAllHardware =');
  const saveAll = source.slice(saveAllStart, source.indexOf('\n   const ', saveAllStart + 1));
  assert.match(saveAll, /const newConfig = \{ \.\.\.globalConfig, availablePrinters: printers, scaleLabelConfig \}/);
  assert.doesNotMatch(saveAll, /setZebraEnabled|applyZebra|applyLocalZebraSetting/);
  assert.match(saveAll, /if \(t.id === selectedTerminalId\)[\s\S]*hardware: \{[\s\S]*scales, defaultScaleId,/);
  assert.match(saveAll, /persistScaleConfigurationDefault\(selectedTerminalId, defaultScaleId, async \(\) => \{ await onUpdateConfig\(newConfig\); \}\)/);
  assert.doesNotMatch(saveAll, /globalConfig, scales/);
  const saveScale = source.slice(source.indexOf('const handleSaveScale ='), source.indexOf('const handleStartDiscovery ='));
  assert.match(saveScale, /if \(editingZebra\) \{[\s\S]*if \(!zebraLocalAllowed\)[\s\S]*if \(!editingLocalZebra && !\(await applyZebra\(true\)\)\)/);
  assert.match(saveScale, /saveLocalScalePreference\(selectedTerminalId, previous\)/); // failed explicit activation restores preference
  assert.match(source, /const selectedTerminalId = terminalId \|\| permissionService.getTerminalId\(\) \|\| ''/);
  assert.match(source, /permissionService.getTerminalId\(\)/);
  assert.match(source, /window.removeEventListener\(zebraSettingEvent, refresh\)/);
  assert.match(source, /\{!editingZebra && \(<>[\s\S]*Baud Rate[\s\S]*<\/>\)\}/);
  assert.match(source, /\{zebraEnabled && zebraLocalAllowed && \(/);
  assert.match(source, /disabled=\{editingLocalZebra \|\| zebraBusy\}/);
});
