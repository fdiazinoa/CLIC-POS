// Real React lifecycle regression, run with an isolated matching React/test-renderer runtime:
// CLIC_ROUTING_REACT_TEST_RUNTIME=/tmp/<runtime> node tests/v3OperationalConfigContext.react.mjs
// This explicit integration fixture is separate from the dependency-free CI Node test suites.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const runtime = process.env.CLIC_ROUTING_REACT_TEST_RUNTIME;
if (!runtime) throw Error('Set CLIC_ROUTING_REACT_TEST_RUNTIME to an isolated matching React/test-renderer runtime');
const require = createRequire(`${runtime}/package.json`), React = require('react'), Renderer = require('react-test-renderer');
const { act } = React;
const previousWindow = globalThis.window;
globalThis.window = new EventTarget(); globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const env = { React, child: undefined, mounts: 0, unmounts: 0, requests: [], hold: undefined, fail: false };
globalThis.__mountedV3Context = env;
const config = { terminals: [{ id: 'local', config: { currentDeviceId: 'device', erpTerminalId: 'erp', erpBinding: { companyId: 'company' }, inventoryScope: { defaultSalesWarehouseId: 'W' }, pricing: { defaultTariffId: 'T', allowedTariffIds: ['T'], tariffs: [{ id: 'T', strategy: 'BASE', items: [] }] } } }], tariffs: [{ id: 'T', taxIncluded: false }], taxes: [], taxRate: 0 };
const cart = [{ id: 'P', cartId: 'retained-line', quantity: 2, price: 45, discount: 5 }];
let canonical = config, releaseValidation;
env.acquire = async input => {
  env.requests.push(input);
  if (env.hold) await env.hold;
  if (env.fail) throw Error('SYNC_V3_BINDING_CHANGED');
  const expected = JSON.stringify(input.terminals[0].config);
  const assertCurrent = async () => { if (JSON.stringify(canonical.terminals[0].config) !== expected) throw Error('SYNC_V3_BINDING_CHANGED'); };
  return { assertCurrent, projectConfig: async value => value, catalog: async () => ({ categories: async () => [], search: async () => { if (env.searchHold) return env.searchHold; return []; }, get: async () => { const owned = env.getHold; env.getHold = undefined; if (owned) return owned; return null; } }),
    withStocks: async rows => rows, validate: async () => { await new Promise(resolve => { releaseValidation = resolve; }); await assertCurrent(); } };
};
const mocks = {
  react: 'module.exports=globalThis.__mountedV3Context.React;module.exports.default=module.exports;',
  './POSInterface': `const E=globalThis.__mountedV3Context,R=E.React;module.exports=function POS(props){const [source]=R.useState({ticketId:'retained-ticket',reservationId:'retained-reservation',modal:'payment-open'});R.useEffect(()=>{E.mounts++;return()=>E.unmounts++;},[]);E.child={props,source};return R.createElement('section',{'data-pos':true});};`,
  '../services/sync/LargeMasterSyncV3OperationalSession': 'exports.acquireLargeMasterSyncV3ConfigContext=(config)=>globalThis.__mountedV3Context.acquire(config);',
  '../services/sync/LargeMasterSyncV3CatalogUpdates': 'exports.subscribeLargeMasterSyncV3CatalogUpdates=callback=>{globalThis.__mountedV3Context.catalogUpdated=callback;return()=>{};};',
  '../services/sync/LargeMasterSyncV3FinancialCommit': 'exports.readV3CompletedReservation=()=>{throw Error("unused");};',
  '../services/sync/LargeMasterSyncV3ReservationRecovery': 'exports.restoreV3ReservationReference=exports.expireV3Reservation=()=>{throw Error("unused");};',
  '../services/sync/LargeMasterSyncV3DirectTicketSource': 'exports.claimV3DirectTicket=exports.readV3DirectWaitingTickets=exports.updateV3DirectTicket=()=>{throw Error("unused");};',
};
const bundle = await build({ entryPoints: ['components/LargeMasterSyncV3OperationalPOS.tsx'], bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'transform', tsconfigRaw: { compilerOptions: { jsx: 'react' } }, plugins: [{ name: 'mounted-config-context', setup(b) {
  b.onResolve({ filter: /.*/ }, a => mocks[a.path] ? { path: a.path, namespace: 'fixture' } : undefined);
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: mocks[a.path] }));
} }] });
const loaded = { exports: {} }; new Function('module', 'exports', bundle.outputFiles[0].text)(loaded, loaded.exports);
const Component = loaded.exports.default; let renderer;
const props = () => ({ config: canonical, activeTerminalId: 'local', cart, onOpenSettings() {}, onUpdateCart() { throw Error('cart mutation forbidden'); } });
const settle = async () => act(async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); });
try {
  await act(async () => { renderer = Renderer.create(React.createElement(Component, props())); }); await settle();
  assert.equal(env.mounts, 1); const source = env.child.source, old = env.child.props.v3Operational, originalCart = JSON.stringify(cart);
  let rejectGet;
  env.getHold = new Promise((_resolve, reject) => { rejectGet = reject; });
  const pendingCart = [...cart];
  await act(async () => renderer.update(React.createElement(Component, { ...props(), cart: pendingCart })));
  // Listener retires the read synchronously, before React effect cleanup runs.
  await act(async () => { env.catalogUpdated(); });
  env.getHold = undefined;
  rejectGet(Error('retired-cart-read-failed'));
  await settle();
  assert.ok(!JSON.stringify(renderer.toJSON()).includes('retired-cart-read-failed'));
  await act(async () => renderer.update(React.createElement(Component, props()))); await settle();
  let rejectSearch;
  env.searchHold = new Promise((_resolve, reject) => { rejectSearch = reject; });
  const retiredSearch = env.child.props.v3Operational.search('', null);
  await Promise.resolve();
  await act(async () => { env.catalogUpdated(); });
  env.searchHold = undefined;
  rejectSearch(Error('retired-read-failed'));
  await retiredSearch; await settle();
  assert.ok(!JSON.stringify(renderer.toJSON()).includes('retired-read-failed'));
  const active = env.child.props.v3Operational;
  let adds = 0;
  const inFlight = active.validate(cart).then(() => adds++); const rejectedOld = assert.rejects(inFlight, /BINDING_CHANGED|UI_CONTEXT_CHANGED/);
  let releaseRenewal; env.hold = new Promise(resolve => { releaseRenewal = resolve; });
  canonical = structuredClone(canonical); canonical.terminals[0].config.pricing.tariffs = [{ id: 'T', isDefault: true }];
  await act(async () => renderer.update(React.createElement(Component, props()))); await settle();
  assert.equal(env.mounts, 1); assert.equal(env.unmounts, 0); assert.strictEqual(env.child.source, source);
  assert.notStrictEqual(env.child.props.v3Operational, old);
  await assert.rejects(env.child.props.v3Operational.validate(cart), /UI_CONTEXT_CHANGED/);
  await assert.rejects(old.resolveCode('P'), /UI_CONTEXT_CHANGED/);
  releaseValidation(); await rejectedOld; assert.equal(adds, 0);
  env.hold = undefined; await act(async () => releaseRenewal()); await settle();
  assert.strictEqual(env.child.source, source); assert.equal(env.mounts, 1); assert.equal(env.unmounts, 0);
  assert.equal(JSON.stringify(cart), originalCart); assert.strictEqual(env.child.props.cart, cart);
  const requests = env.requests.length;
  canonical = { ...canonical, name: 'Unrelated display change' };
  await act(async () => renderer.update(React.createElement(Component, props()))); await settle(); assert.equal(env.requests.length, requests);
  env.fail = true; canonical = structuredClone(canonical); canonical.terminals[0].config.fiscal = { mode: 'NEW' };
  await act(async () => renderer.update(React.createElement(Component, props()))); await settle();
  assert.equal(env.mounts, 1); assert.equal(env.unmounts, 0); assert.strictEqual(env.child.source, source);
  assert.ok(JSON.stringify(renderer.toJSON()).includes('SYNC_V3_BINDING_CHANGED'));
  await assert.rejects(env.child.props.v3Operational.validate(cart), /UI_CONTEXT_CHANGED/);
  assert.equal(JSON.stringify(cart), originalCart);
  console.log('Real React context renewal: pending/success/failure preserve one mounted POS and retained source; stale actions reject; cart untouched.');
} finally {
  if (renderer) await act(async () => renderer.unmount());
  globalThis.window = previousWindow; delete globalThis.__mountedV3Context; delete globalThis.IS_REACT_ACT_ENVIRONMENT;
}
