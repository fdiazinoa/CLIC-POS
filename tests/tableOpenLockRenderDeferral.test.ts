import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const source = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const createAcquire = (bindings: Record<string, unknown>) => {
  const declarations: ts.Expression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'acquireTableEditLock' && node.initializer) {
      declarations.push(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(declarations.length, 1);
  const javascript = ts.transpileModule(`const result = ${declarations[0].getText(source)};`, {
    fileName: 'acquire.tsx',
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function(...Object.keys(bindings), `${javascript}; return result;`)(...Object.values(bindings)) as
    (table: { id: string }) => Promise<boolean>;
};

test('opening from Mesas owns the confirmed lock immediately without repainting App before ticket hydration', async () => {
  const lock = { tableId: 'mesa-1', ownerId: 'qa-device', token: 'qa-lock' };
  const lockRef = { current: null as typeof lock | null };
  const published: Array<typeof lock | null> = [];
  let calls = 0;
  const currentViewRef = { current: 'TABLE_MAP' };
  const acquire = createAcquire({
    useCallback: (callback: unknown) => callback,
    currentViewRef,
    activeTableEditLockRef: lockRef,
    setActiveTableEditLock: (value: typeof lock | null) => published.push(value),
    lastTableInteractionAtRef: { current: 0 },
    pendingTableLockReleasesRef: { current: new Map() },
    deviceId: 'qa-device',
    getCurrentTerminal: () => ({ id: 'qa-terminal', config: {} }),
    currentUser: { id: 'qa-user', name: 'QA' },
    invokeTableEditLock: async () => { calls += 1; return { success: true, lock }; },
    releaseActiveTableEditLock: async () => true,
    setTables: () => assert.fail('acquiring must not change the table snapshot'),
    alert: () => assert.fail('a valid lock must not show an error'),
    fetchTables: async () => assert.fail('a valid lock must not fetch tables'),
  });

  assert.equal(await acquire({ id: 'mesa-1' }), true);
  assert.equal(calls, 1, 'the authoritative lock request is never skipped');
  assert.equal(lockRef.current, lock, 'release and reentry guards see the lock immediately');
  assert.deepEqual(published, [], 'the hidden POS heartbeat state waits for ticket hydration');

  const tableCase = appSource.slice(appSource.indexOf("case 'TABLE_MAP':"), appSource.indexOf("case 'TABLE_DESIGNER':"));
  const heartbeat = tableCase.indexOf('setActiveTableEditLock(activeTableEditLockRef.current)');
  const cart = tableCase.indexOf('setCart(nextCart)', heartbeat);
  const navigation = tableCase.indexOf("setCurrentView('POS')", cart);
  assert.ok(heartbeat >= 0 && cart > heartbeat && navigation > cart,
    'publish lock heartbeat in the same hydration batch before exposing POS');
});

test('acquiring outside Mesas still publishes heartbeat state immediately', async () => {
  const lock = { tableId: 'mesa-2', ownerId: 'qa-device', token: 'qa-lock-2' };
  const lockRef = { current: null as typeof lock | null };
  const published: Array<typeof lock | null> = [];
  const acquire = createAcquire({
    useCallback: (callback: unknown) => callback,
    currentViewRef: { current: 'POS' },
    activeTableEditLockRef: lockRef,
    setActiveTableEditLock: (value: typeof lock | null) => published.push(value),
    lastTableInteractionAtRef: { current: 0 },
    pendingTableLockReleasesRef: { current: new Map() },
    deviceId: 'qa-device',
    getCurrentTerminal: () => ({ id: 'qa-terminal', config: {} }),
    currentUser: { id: 'qa-user', name: 'QA' },
    invokeTableEditLock: async () => ({ success: true, lock }),
    releaseActiveTableEditLock: async () => true,
    alert: () => assert.fail('a valid lock must not show an error'),
    fetchTables: async () => assert.fail('a valid lock must not fetch tables'),
  });

  assert.equal(await acquire({ id: 'mesa-2' }), true);
  assert.equal(lockRef.current, lock);
  assert.deepEqual(published, [lock]);
});
