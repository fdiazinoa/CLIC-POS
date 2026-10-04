import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const tableMapSource = ts.createSourceFile('TableMap.tsx', readFileSync(new URL('../components/TableMap.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const appSource = ts.createSourceFile('App.tsx', readFileSync(new URL('../App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const evaluate = (expression: ts.Expression, source: ts.SourceFile, bindings: Record<string, unknown>) => {
  const compiled = ts.transpileModule(`const value = ${expression.getText(source)};`, {
    fileName: 'actual.tsx', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
  return new Function(...Object.keys(bindings), `${compiled}; return value;`)(...Object.values(bindings));
};

const findExpression = (source: ts.SourceFile, select: (node: ts.Node) => ts.Expression | undefined) => {
  const matches: ts.Expression[] = [];
  const visit = (node: ts.Node) => { const match = select(node); if (match) matches.push(match); ts.forEachChild(node, visit); };
  visit(source);
  assert.equal(matches.length, 1);
  return matches[0];
};

test('tras suspensión, cada acción del modal revalida lock antes de mutar, imprimir o navegar', async () => {
  let clock = 0;
  const lockChecks: number[] = [];
  const operations: string[] = [];
  const table = { id: 'mesa-11' };
  const bindings = {
    selectedAccountTable: table,
    requireFreshAccountLock: async () => { lockChecks.push(clock); throw new Error('TABLE_EDIT_LOCK_REQUIRED'); },
    createTableAccount: () => { operations.push('create'); },
    renameTableAccount: () => { operations.push('rename'); },
    onTransferAccountItems: () => { operations.push('transfer'); },
    onPrintPrecheck: () => { operations.push('print'); },
    openPosTable: () => { operations.push('open'); },
  };
  clock = 46_000; // native Master TTL is 45 seconds
  for (const [name, args] of [
    ['onCreateAccount', ['Cuenta 5']],
    ['onRenameAccount', [{ id: 'ticket-1' }, 'Ana']],
    ['onTransfer', ['ticket-1', 'ticket-2', { line: 1 }]],
    ['onPrint', [['ticket-1']]],
    ['onOpenAccount', [{ id: 'ticket-1' }, clock]],
  ] as const) {
    const expression = findExpression(tableMapSource, node => ts.isJsxAttribute(node) && node.name.getText(tableMapSource) === name && node.initializer && ts.isJsxExpression(node.initializer) ? node.initializer.expression : undefined);
    const callback = evaluate(expression, tableMapSource, bindings);
    await assert.rejects(Promise.resolve(callback(...args)), /TABLE_EDIT_LOCK_REQUIRED/, name);
  }
  assert.deepEqual(lockChecks, [clock, clock, clock, clock, clock]);
  assert.deepEqual(operations, []);
});

test('heartbeat de TABLE_MAP renueva ref tras TTL sin repintar App y conserva token nuevo', async () => {
  const effectExpression = findExpression(appSource, node => ts.isCallExpression(node)
    && node.expression.getText(appSource) === 'useEffect'
    && node.arguments[0]?.getText(appSource).includes('tableLockHeartbeatInFlightRef.current = renewal')
    ? node.arguments[0] : undefined);
  let tick!: () => void;
  const lock = { tableId: 'mesa-11', ownerId: 'device-1', token: 'expired', terminalId: 'T1' };
  const activeTableEditLockRef = { current: lock };
  const tableLockHeartbeatInFlightRef = { current: null };
  const updated: unknown[] = [];
  const effect = evaluate(effectExpression, appSource, {
    window: { setInterval: (callback: () => void, ms: number) => { assert.equal(ms, 15_000); tick = callback; return 1; }, clearInterval: () => {} },
    activeTableEditLockRef, tableLockHeartbeatInFlightRef,
    currentViewRef: { current: 'TABLE_MAP' }, tableLockLifecycleVersionRef: { current: 0 },
    invokeTableEditLock: async () => ({ success: true, lock: { ...lock, token: 'fresh' } }),
    getCurrentTerminal: () => ({ id: 'T1' }), currentUser: { id: 'user', name: 'Operator' },
    setActiveTableEditLock: (value: unknown) => updated.push(value), console,
  }) as () => void;
  effect();
  tick();
  await tableLockHeartbeatInFlightRef.current;
  assert.equal(activeTableEditLockRef.current.token, 'fresh');
  assert.deepEqual(updated, [], 'TABLE_MAP avoids a full App repaint on heartbeat');
});

test('cerrar durante renovación usa el token nuevo para liberar Master', async () => {
  const expression = findExpression(appSource, node => ts.isVariableDeclaration(node)
    && node.name.getText(appSource) === 'releaseActiveTableEditLock' ? node.initializer : undefined);
  const expired = { tableId: 'mesa-11', ownerId: 'device-1', token: 'expired' };
  let resolveHeartbeat!: (lock: typeof expired) => void;
  const heartbeat = new Promise<typeof expired>(resolve => { resolveHeartbeat = resolve; });
  const releasedTokens: string[] = [];
  const release = evaluate(expression, appSource, {
    useCallback: (fn: unknown) => fn,
    activeTableEditLockRef: { current: expired },
    tableLockHeartbeatInFlightRef: { current: heartbeat },
    tableLockLifecycleVersionRef: { current: 0 },
    pendingTableLockReleasesRef: { current: new Map() },
    parkedTicketSyncQueueRef: { current: Promise.resolve() },
    lastTableInteractionAtRef: { current: 0 },
    performance: { now: () => 46_000 },
    setActiveTableEditLock: () => {}, setTables: () => {}, markInteractionStage: () => {},
    invokeTableEditLock: async (_action: string, payload: { token: string }) => { releasedTokens.push(payload.token); return { success: true }; },
    window: { setTimeout: () => 1 }, console,
  }) as () => Promise<boolean>;
  const releasing = release();
  resolveHeartbeat({ ...expired, token: 'fresh' });
  assert.equal(await releasing, true);
  assert.deepEqual(releasedTokens, ['fresh']);
});
