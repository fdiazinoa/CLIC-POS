import test from 'node:test';
import assert from 'node:assert/strict';
import { getInitialConfig } from '../constants';
import { applyTerminalConfigSnapshot } from '../utils/terminalConfigSnapshot';
import { readOperationalCatalogBindingProof, readOperationalTerminalBinding } from '../services/sync/OperationalTerminalConfig';
const proof = { terminalId: 'terminal', tenantId: 'tenant', companyId: 'company', deviceId: 'device' };
const identity = { terminal_id: proof.terminalId, tenant_id: proof.tenantId, company_id: proof.companyId, device_id: proof.deviceId };
const base = () => {
 const config = getInitialConfig('Restaurante' as any);
 config.terminals = [{ id: 'local', config: structuredClone(config.terminals[0].config) }];
 config.terminals[0].config.erpBinding = { ...config.terminals[0].config.erpBinding, ...proof } as any;
 config.terminals[0].config.catalog.allowedCategories = ['Alimentos'];
 return config;
};
const apply = (snapshot: any, trusted = false, v3 = true, cached?: any) => applyTerminalConfigSnapshot(base(), {
 terminalId: 'local', incomingSnapshot: snapshot, cachedSnapshot: cached,
 preserveOmittedOperationalScopes: v3, catalogBindingProof: trusted ? proof : undefined,
}).config.terminals[0].config.catalog.allowedCategories;
test('positive fresh exact identity preserves omitted restriction through restart and full hydration', () => {
 assert.deepEqual(apply({ ...identity, resolved: {} }), ['Alimentos']);
 const persisted = JSON.parse(JSON.stringify(applyTerminalConfigSnapshot(base(), { terminalId: 'local',
 incomingSnapshot: { ...identity, resolved: {} } as any, preserveOmittedOperationalScopes: true }).config));
 assert.deepEqual(persisted.terminals[0].config.catalog.allowedCategories, ['Alimentos']);
 assert.deepEqual(apply({ ...identity, resolved: { catalog: { allowed_categories: ['Bebidas'] } } }), ['Bebidas']);
});
test('trusted stable binding permits partial omission but unknown or switched identity never inherits', () => {
 assert.deepEqual(apply({ resolved: {} }, true), ['Alimentos']);
 assert.deepEqual(apply({ resolved: {} }), []);
 assert.deepEqual(apply({ resolved: {} }, false, true, { resolved: { catalog: { allowed_categories: ['Cache'] } } }), []);
 assert.deepEqual(apply({ ...identity, company_id: 'other', resolved: {} }, true, true, { resolved: { catalog: { allowed_categories: ['Cache'] } } }), []);
 for (const key of Object.keys(identity)) assert.deepEqual(apply({ ...identity, [key]: 'other', resolved: {} }, true), []);
 assert.deepEqual(apply({ ...identity, resolved: { identity: { id: 'other' } } }, true), []);
 const config = base(); delete config.terminals[0].config.erpBinding.companyId;
 assert.deepEqual(applyTerminalConfigSnapshot(config, { terminalId: 'local', incomingSnapshot: { resolved: {} } as any,
 preserveOmittedOperationalScopes: true, catalogBindingProof: proof }).config.terminals[0].config.catalog.allowedCategories, []);
});
test('fresh explicit empty or malformed restriction overrides cache and groups; V2 unchanged', () => {
 for (const value of [[]]) for (const key of ['allowed_categories', 'allowedCategories', 'categories', 'product_categories', 'productCategories']) {
 assert.deepEqual(apply({ ...identity, resolved: { catalog: { [key]: value, groups: [{ id: 'Bebidas', name: 'Bebidas' }] } } }, true, true,
 { resolved: { catalog: { allowed_categories: ['Cache'] } } }), []);
 }
 assert.deepEqual(apply({ ...identity, resolved: { catalog: { groups: [{ id: 'Bebidas', name: 'Bebidas' }] } } }, true, true, { resolved: { catalog: { allowed_categories: ['Cache'] } } }), ['Bebidas']);
 assert.deepEqual(apply({ ...identity, resolved: {} }, true, false), []);
});
test('pure current company proof and fingerprint detect company/terminal drift without writes', () => {
 const values = new Map<string, string>(); let writes = 0;
 Object.assign(globalThis, { localStorage: { getItem: (key: string) => values.get(key) || null, setItem: () => writes++ } });
 assert.equal(readOperationalCatalogBindingProof(), undefined);
 values.set('clic_terminal_credentials_v1', JSON.stringify({ erpTerminalId: 'terminal', erpTenantId: 'tenant', companyId: 'company', deviceId: 'device' }));
 assert.deepEqual(readOperationalCatalogBindingProof(), proof);
 const fingerprint = readOperationalTerminalBinding(); values.set('clic_erp_sync_company_id', 'other');
 assert.notEqual(readOperationalTerminalBinding(), fingerprint);
 assert.equal(readOperationalCatalogBindingProof(), undefined, 'conflicting persisted current company cannot authorize old binding');
 assert.equal(writes, 0);
});

test('malformed fresh V3 restrictions fail closed before publication; valid named/id objects remain supported', () => {
 for (const value of [null, {}, 'bad', [1], [' '], [{}], [{ name: 4 }]]) {
  const config = base(); const before = structuredClone(config);
  assert.throws(() => applyTerminalConfigSnapshot(config, { terminalId: 'local', preserveOmittedOperationalScopes: true,
   incomingSnapshot: { ...identity, resolved: { catalog: { allowed_categories: value } } } as any, catalogBindingProof: proof }), /SYNC_V3_TERMINAL_CATALOG_INVALID/);
  assert.deepEqual(config, before);
 }
 assert.deepEqual(apply({ ...identity, resolved: { catalog: { allowed_categories: [{ name: 'Alimentos' }, { id: 'food-id' }] } } }), ['Alimentos', 'food-id']);
});
