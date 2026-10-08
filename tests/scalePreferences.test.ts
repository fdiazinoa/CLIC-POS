import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

test('scale preferences persist with company/tenant/terminal/device scope, readback and driver isolation', async () => {
  const storage = new Map<string, string>();
  const fixture = { credentials: { erpTenantId: 'tenant', companyId: 'company', erpTerminalId: 'T' },
    device: 'D', enabled: true, corruptReadback: false, readCount: 0 };
  const oldStorage = globalThis.localStorage;
  const oldWindow = globalThis.window;
  (globalThis as any).__scaleFixture = fixture;
  (globalThis as any).window = { dispatchEvent() {} };
  (globalThis as any).localStorage = { getItem: (key: string) => fixture.corruptReadback && fixture.readCount++ > 0 ? 'corrupt' : storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) };
  try {
    const bundled = await build({ entryPoints: ['services/ScalePreferences.ts'], bundle: true, write: false, platform: 'node', format: 'cjs',
      plugins: [{ name: 'isolated-scale-dependencies', setup(build) {
        const mocks: Record<string, string> = {
          './sync/TerminalCredentialStore': 'export const readTerminalCredentialsSync=()=>globalThis.__scaleFixture.credentials;',
          '../utils/deviceRevocation': 'export const resolveLocalDeviceId=()=>globalThis.__scaleFixture.device;',
          './ZebraScanner': 'export const isZebraEnabled=()=>globalThis.__scaleFixture.enabled;export const zebraSettingEvent="zebra";',
        };
        build.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'scale-mock' } : undefined);
        build.onLoad({ filter: /.*/, namespace: 'scale-mock' }, args => ({ contents: mocks[args.path], loader: 'ts' }));
      } }] });
    const module = { exports: {} as any }; new Function('module', 'exports', bundled.outputFiles[0].text)(module, module.exports);
    const api = module.exports;
    const key = api.currentScaleScope('T');
    assert.notEqual(key, api.scaleScopeKey('tenant', 'other-company', 'T', 'D'));
    assert.notEqual(key, api.scaleScopeKey('tenant', 'company', 'T', 'other-device'));
    assert.throws(() => api.scaleScopeKey('tenant', '', 'T', 'D'));
    assert.deepEqual(api.readLocalScalePreference('T'), {});
    api.saveLocalScalePreference('T', { zebraUnit: 'lb', defaultScaleId: 'local-zebra-mp7000' });
    assert.equal(api.readLocalScalePreference('T').zebraUnit, 'lb');
    const config = { scales: [], terminals: [{ id: 'T', config: { hardware: {} } }] };
    let resolved = api.resolveSaleScales(config, 'T');
    assert.equal(resolved.scales[0].displayUnit, 'lb');
    assert.equal(resolved.scales[0].driver, 'ZEBRA');
    assert.equal(resolved.defaultScaleId, 'local-zebra-mp7000');
    let added = 0;
    fixture.credentials.companyId = 'other-company';
    assert.throws(() => { api.assertCurrentScaleContext(resolved, config, 'T'); ++added; }, /identidad/);
    assert.equal(added, 0);
    fixture.credentials.companyId = 'company';
    assert.equal(api.resolveSaleScales(config, 'other-terminal').scales[0].driver, 'MANUAL');
    assert.throws(() => api.saveLocalScalePreference('other-terminal', { zebraUnit: 'kg' }));
    fixture.credentials.companyId = 'other-company';
    assert.deepEqual(api.readLocalScalePreference('T'), {});
    fixture.credentials.companyId = 'company';
    assert.equal(api.readLocalScalePreference('T').zebraUnit, 'lb');
    fixture.enabled = false;
    resolved = api.resolveSaleScales(config, 'T');
    assert.equal(resolved.defaultScaleId, undefined); // deleted/disabled explicit default requires selection
    assert.equal(resolved.scales[0].driver, 'MANUAL');
    storage.clear();
    const two = { ...config, scales: [{ id: 'S1', name: 'Serial', isEnabled: true, technology: 'DIRECT', displayUnit: 'lb' },
      { id: 'S2', name: 'Manual', isEnabled: true, technology: 'DIRECT' }] };
    assert.equal(api.resolveSaleScales(two, 'T').defaultScaleId, undefined);
    assert.throws(() => api.resolveSaleScales({ ...two, scales: [{ ...two.scales[0], displayUnit: 'oz' }] }, 'T'), /inválida/);
    assert.equal(api.resolveSaleScales({ ...two, scales: [{ ...two.scales[0], technology: 'LABEL' }] }, 'T').scales[0].id, 'manual');
    assert.deepEqual(api.resolveSaleScales(two, 'T').scales.map((s: any) => s.driver), ['MANUAL', 'MANUAL']);
    storage.set(key, '{"zebraUnit":"oz"}');
    assert.throws(() => api.readLocalScalePreference('T'), /inválida/);
    storage.set(key, '{}'); fixture.corruptReadback = true;
    assert.throws(() => api.saveLocalScalePreference('T', { zebraUnit: 'lb' }), /verificar/);
    fixture.corruptReadback = false;
    assert.equal(storage.get(key), '{}'); // failed readback restored the previous preference
  } finally {
    (globalThis as any).localStorage = oldStorage; (globalThis as any).window = oldWindow;
    delete (globalThis as any).__scaleFixture;
  }
});
