import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { reconcileRejectedTableTickets } from '../utils/tableAccountReconciliation';

const source = ts.createSourceFile('App.tsx', readFileSync(new URL('../App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let rollbackExpression: ts.Expression | undefined;
const visit = (node: ts.Node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'rollbackRejectedTableLock') rollbackExpression = node.initializer;
  ts.forEachChild(node, visit);
};
visit(source);
assert.ok(rollbackExpression);
const compiled = ts.transpileModule(`const rollback = ${rollbackExpression.getText(source)};`, {
  fileName: 'rollback.ts', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const evaluate = (bindings: Record<string, unknown>) =>
  new Function(...Object.keys(bindings), `${compiled}; return rollback;`)(...Object.values(bindings)) as
    (error: unknown, pending: unknown, token: string) => Promise<void>;

const ticket = (id: string, tableId: string, name: string) => ({ id, tableId, name, items: [], total: 0 });

test('rechazo tardío de mesa A no limpia lock nuevo de mesa B', async () => {
  const pendingA = { tableId: 'A' };
  const lockB = { tableId: 'B', token: 'token-B' };
  const activeTableEditLockRef = { current: lockB };
  const tableLockLifecycleVersionRef = { current: 9 };
  const rejectedTableSyncGenerationRef = { current: new Map<string, number>() };
  const updates: unknown[] = [];
  const rollback = evaluate({
    activeTableEditLockRef, tableLockLifecycleVersionRef, rejectedTableSyncGenerationRef,
    pendingClientTableSyncRef: { current: null }, pendingMasterTableSyncRef: { current: null },
    setActiveTableEditLock: (value: unknown) => updates.push(value),
  });
  await rollback(new Error('TABLE_EDIT_LOCK_REQUIRED'), pendingA, 'token-A');
  assert.equal(activeTableEditLockRef.current, lockB);
  assert.equal(tableLockLifecycleVersionRef.current, 9);
  assert.deepEqual(updates, []);
  assert.equal(rejectedTableSyncGenerationRef.current.get('A'), 1);
});

test('A rechazada y B en cola: si GET falla, B restaura último ACK, nunca A optimista ni mesa C', async () => {
  const original = ticket('one', 'A', 'Cuenta 1');
  const optimisticA = ticket('one', 'A', 'Cuenta 1QA');
  const optimisticB = ticket('two', 'A', 'Cuenta 2QA');
  const newerC = ticket('other', 'C', 'Cliente nuevo');
  const pendingB = { tableId: 'A' };
  const snapshot = { current: { parkedTickets: [optimisticA, optimisticB, newerC] } };
  const pendingClient = { current: pendingB };
  let persisted: unknown;
  let shown: unknown;
  const rollback = evaluate({
    activeTableEditLockRef: { current: { tableId: 'A', token: 'token-A' } },
    tableLockLifecycleVersionRef: { current: 0 },
    rejectedTableSyncGenerationRef: { current: new Map<string, number>([['A', 1]]) },
    lastAcknowledgedTableTicketsRef: { current: new Map([['A', [original]]]) },
    pendingClientTableSyncRef: pendingClient, pendingMasterTableSyncRef: { current: null },
    setActiveTableEditLock: () => {},
    fetchAuthoritativeTableSnapshot: async () => { throw new Error('Master unavailable'); },
    resolveValidatedOperationalApiUrl: async () => '',
    isClientTerminalMode: () => false,
    parkedTicketReferencesTable: (row: { tableId: string }, tableId: string) => row.tableId === tableId,
    masterOperationalSnapshotRef: snapshot,
    reconcileRejectedTableTickets,
    clearPendingClientTableSync: async () => {},
    setParkedTickets: (value: unknown) => { shown = value; },
    writeCriticalCollectionsMirror: () => {}, cashMovements: [],
    db: { save: async (_: string, value: unknown) => { persisted = value; } },
    fetchTables: async () => {}, console: { warn: () => {} },
  });
  await rollback(new Error('TABLE_EDIT_LOCK_REQUIRED'), pendingB, 'token-A');
  const expected = [newerC, original];
  assert.deepEqual(snapshot.current.parkedTickets, expected);
  assert.deepEqual(shown, expected);
  assert.deepEqual(persisted, expected);
  assert.equal(pendingClient.current, null);
});

test('sin GET ni baseline confirmado, conserva PENDING y no declara snapshot optimista reconciliado', async () => {
  const optimistic = ticket('one', 'A', 'Cuenta 1QA');
  const pending = { tableId: 'A' };
  const pendingClient = { current: pending };
  let localWrites = 0;
  const rollback = evaluate({
    activeTableEditLockRef: { current: null },
    tableLockLifecycleVersionRef: { current: 0 },
    rejectedTableSyncGenerationRef: { current: new Map<string, number>() },
    lastAcknowledgedTableTicketsRef: { current: new Map() },
    pendingClientTableSyncRef: pendingClient, pendingMasterTableSyncRef: { current: null },
    fetchAuthoritativeTableSnapshot: async () => { throw new Error('Master unavailable'); },
    resolveValidatedOperationalApiUrl: async () => '', isClientTerminalMode: () => false,
    masterOperationalSnapshotRef: { current: { parkedTickets: [optimistic] } },
    setParkedTickets: () => { localWrites += 1; },
    writeCriticalCollectionsMirror: () => { localWrites += 1; },
    db: { save: async () => { localWrites += 1; } },
    console: { warn: () => {} },
  });
  await rollback(new Error('TABLE_EDIT_LOCK_REQUIRED'), pending, 'expired');
  assert.equal(pendingClient.current, pending);
  assert.equal(localWrites, 0);
});

test('GET tardío de B no pisa una edición C que tomó la misma mesa durante el await', async () => {
  const optimisticB = ticket('one', 'A', 'Cuenta B');
  const optimisticC = ticket('one', 'A', 'Cuenta C');
  const pendingB = { tableId: 'A' };
  const pendingC = { tableId: 'A' };
  const pendingClient = { current: pendingB };
  const snapshot = { current: { parkedTickets: [optimisticB] } };
  const lastAck = { current: new Map([['A', [ticket('one', 'A', 'Cuenta original')]]]) };
  let resolveGet!: (value: unknown) => void;
  const delayedGet = new Promise(resolve => { resolveGet = resolve; });
  let localWrites = 0;
  const rollback = evaluate({
    activeTableEditLockRef: { current: { tableId: 'A', token: 'token-C' } },
    tableLockLifecycleVersionRef: { current: 1 },
    rejectedTableSyncGenerationRef: { current: new Map<string, number>() },
    lastAcknowledgedTableTicketsRef: lastAck,
    pendingClientTableSyncRef: pendingClient, pendingMasterTableSyncRef: { current: null },
    fetchAuthoritativeTableSnapshot: () => delayedGet,
    resolveValidatedOperationalApiUrl: async () => '', isClientTerminalMode: () => false,
    parkedTicketReferencesTable: (row: { tableId: string }, tableId: string) => row.tableId === tableId,
    masterOperationalSnapshotRef: snapshot,
    reconcileRejectedTableTickets,
    clearPendingClientTableSync: async () => { localWrites += 1; },
    setParkedTickets: () => { localWrites += 1; },
    writeCriticalCollectionsMirror: () => { localWrites += 1; },
    db: { save: async () => { localWrites += 1; } },
    fetchTables: async () => { localWrites += 1; },
    console: { warn: () => {} },
  });
  const rejectedB = rollback(new Error('TABLE_EDIT_LOCK_REQUIRED'), pendingB, 'token-B');
  pendingClient.current = pendingC;
  snapshot.current.parkedTickets = [optimisticC];
  resolveGet({ assertCurrentAuthority: () => {}, parkedTickets: [ticket('one', 'A', 'Cuenta original')] });
  await rejectedB;
  assert.equal(pendingClient.current, pendingC);
  assert.deepEqual(snapshot.current.parkedTickets, [optimisticC]);
  assert.equal(localWrites, 0);
  assert.equal(lastAck.current.get('A')?.[0]?.name, 'Cuenta original');
});

test('clearPending tardío no aplica snapshot B sobre pending C de la misma mesa', async () => {
  const optimisticC = ticket('one', 'A', 'Cuenta C');
  const pendingB = { tableId: 'A' };
  const pendingC = { tableId: 'A' };
  const pendingClient = { current: pendingB };
  const snapshot = { current: { parkedTickets: [ticket('one', 'A', 'Cuenta B')] } };
  let resolveClear!: () => void;
  const deferredClear = new Promise<void>(resolve => { resolveClear = resolve; });
  let snapshotWrites = 0;
  const rollback = evaluate({
    activeTableEditLockRef: { current: { tableId: 'A', token: 'token-C' } },
    tableLockLifecycleVersionRef: { current: 1 },
    rejectedTableSyncGenerationRef: { current: new Map<string, number>() },
    lastAcknowledgedTableTicketsRef: { current: new Map([['A', [ticket('one', 'A', 'Cuenta original')]]]) },
    pendingClientTableSyncRef: pendingClient, pendingMasterTableSyncRef: { current: null },
    fetchAuthoritativeTableSnapshot: async () => ({ assertCurrentAuthority: () => {}, parkedTickets: [ticket('one', 'A', 'Cuenta original')] }),
    resolveValidatedOperationalApiUrl: async () => '', isClientTerminalMode: () => false,
    parkedTicketReferencesTable: (row: { tableId: string }, tableId: string) => row.tableId === tableId,
    masterOperationalSnapshotRef: snapshot,
    reconcileRejectedTableTickets,
    clearPendingClientTableSync: () => deferredClear,
    setParkedTickets: () => { snapshotWrites += 1; },
    writeCriticalCollectionsMirror: () => { snapshotWrites += 1; },
    db: { save: async () => { snapshotWrites += 1; } },
    fetchTables: async () => { snapshotWrites += 1; },
    console: { warn: () => {} },
  });
  const rejectedB = rollback(new Error('TABLE_EDIT_LOCK_REQUIRED'), pendingB, 'token-B');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(pendingClient.current, pendingB, 'B remains visible until its durable clear completes');
  pendingClient.current = pendingC;
  snapshot.current.parkedTickets = [optimisticC];
  resolveClear();
  await rejectedB;
  assert.equal(pendingClient.current, pendingC);
  assert.deepEqual(snapshot.current.parkedTickets, [optimisticC]);
  assert.equal(snapshotWrites, 0);
});

test('cola durable ordena EMPTY, C y D aunque la escritura C termine tarde', async () => {
  let persistExpression: ts.Expression | undefined;
  let clearExpression: ts.Expression | undefined;
  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'persistPendingClientTableSync') persistExpression = node.initializer;
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'clearPendingClientTableSync') clearExpression = node.initializer;
    ts.forEachChild(node, collect);
  };
  collect(source);
  assert.ok(persistExpression && clearExpression);
  const helpers = ts.transpileModule(`
    let pendingClientTableSyncWriteQueue = Promise.resolve();
    const persistPendingClientTableSync = ${persistExpression.getText(source)};
    const clearPendingClientTableSync = ${clearExpression.getText(source)};
  `, { fileName: 'pending.ts', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  let resolveC!: () => void;
  const delayedC = new Promise<void>(resolve => { resolveC = resolve; });
  const durable: string[] = [];
  const mirror: string[] = [];
  const helpersRuntime = new Function('db', 'writePendingTableSyncMirror', `${helpers}; return { persistPendingClientTableSync, clearPendingClientTableSync };`)(
    { saveDocument: async (_collection: string, pending: { status: string; tableId?: string; queuedAt?: string }) => {
      const label = pending.tableId || pending.status;
      if (label === 'C') await delayedC;
      durable.push(label);
    } },
    (pending: { status: string; tableId?: string }) => { mirror.push(pending.tableId || pending.status); },
  ) as { persistPendingClientTableSync: (pending: unknown) => Promise<void>; clearPendingClientTableSync: () => Promise<void> };
  const empty = helpersRuntime.clearPendingClientTableSync();
  const c = helpersRuntime.persistPendingClientTableSync({ id: 'current', status: 'PENDING', tableId: 'C' });
  await empty;
  await Promise.resolve();
  const d = helpersRuntime.persistPendingClientTableSync({ id: 'current', status: 'PENDING', tableId: 'D' });
  assert.deepEqual(durable, ['EMPTY'], 'C remains in flight');
  resolveC();
  await Promise.all([c, d]);
  assert.deepEqual(durable, ['EMPTY', 'C', 'D']);
  assert.deepEqual(mirror, ['EMPTY', 'C', 'D']);
});

test('ACK de D después de C deja EMPTY durable, sin resucitar C', async () => {
  let persistExpression: ts.Expression | undefined;
  let clearExpression: ts.Expression | undefined;
  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'persistPendingClientTableSync') persistExpression = node.initializer;
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'clearPendingClientTableSync') clearExpression = node.initializer;
    ts.forEachChild(node, collect);
  };
  collect(source);
  assert.ok(persistExpression && clearExpression);
  const helpers = ts.transpileModule(`
    let pendingClientTableSyncWriteQueue = Promise.resolve();
    const persistPendingClientTableSync = ${persistExpression.getText(source)};
    const clearPendingClientTableSync = ${clearExpression.getText(source)};
  `, { fileName: 'pending.ts', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  let resolveC!: () => void;
  const delayedC = new Promise<void>(resolve => { resolveC = resolve; });
  const durable: string[] = [];
  const helpersRuntime = new Function('db', 'writePendingTableSyncMirror', `${helpers}; return { persistPendingClientTableSync, clearPendingClientTableSync };`)(
    { saveDocument: async (_collection: string, pending: { status: string; tableId?: string }) => {
      if (pending.tableId === 'C') await delayedC;
      durable.push(pending.tableId || pending.status);
    } }, () => {},
  ) as { persistPendingClientTableSync: (pending: unknown) => Promise<void>; clearPendingClientTableSync: () => Promise<void> };
  const c = helpersRuntime.persistPendingClientTableSync({ id: 'current', status: 'PENDING', tableId: 'C' });
  const d = helpersRuntime.persistPendingClientTableSync({ id: 'current', status: 'PENDING', tableId: 'D' });
  const empty = helpersRuntime.clearPendingClientTableSync();
  resolveC();
  await Promise.all([c, d, empty]);
  assert.deepEqual(durable, ['C', 'D', 'EMPTY']);
});

test('B rechazada no se convierte en baseline cuando C arranca durante clear y también falla', async () => {
  const original = ticket('one', 'A', 'Cuenta original');
  const rejectedB = ticket('one', 'A', 'Cuenta B rechazada');
  const rejectedC = ticket('two', 'A', 'Cuenta C rechazada');
  const unrelated = ticket('other', 'Z', 'Otra mesa');
  const lastAck = { current: new Map([['A', [original]]]) };
  const seeds: ts.IfStatement[] = [];
  const collectSeeds = (node: ts.Node) => {
    if (ts.isIfStatement(node) && node.expression.getText(source).includes('!lastAcknowledgedTableTicketsRef.current.has(syncTableId)')) seeds.push(node);
    ts.forEachChild(node, collectSeeds);
  };
  collectSeeds(source);
  assert.equal(seeds.length, 2, 'client and native Master both guard the initial baseline');
  for (const seed of seeds) {
    const compiledSeed = ts.transpileModule(seed.getText(source), {
      fileName: 'seed.ts', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    new Function('syncTableId', 'lastAcknowledgedTableTicketsRef', 'pendingClientTableSyncRef', 'pendingMasterTableSyncRef', 'parkedTickets', 'parkedTicketReferencesTable', compiledSeed)(
      'A', lastAck, { current: null }, { current: null }, [rejectedB, unrelated],
      (row: { tableId: string }, tableId: string) => row.tableId === tableId,
    );
  }
  assert.deepEqual(lastAck.current.get('A'), [original], 'optimistic B never replaces ACK original');

  const pendingC = { tableId: 'A' };
  const snapshot = { current: { parkedTickets: [rejectedB, rejectedC, unrelated] } };
  const rollback = evaluate({
    activeTableEditLockRef: { current: { tableId: 'A', token: 'token-C' } },
    tableLockLifecycleVersionRef: { current: 0 },
    rejectedTableSyncGenerationRef: { current: new Map<string, number>() },
    lastAcknowledgedTableTicketsRef: lastAck,
    pendingClientTableSyncRef: { current: pendingC }, pendingMasterTableSyncRef: { current: null },
    setActiveTableEditLock: () => {},
    fetchAuthoritativeTableSnapshot: async () => { throw new Error('Master unavailable'); },
    resolveValidatedOperationalApiUrl: async () => '', isClientTerminalMode: () => false,
    parkedTicketReferencesTable: (row: { tableId: string }, tableId: string) => row.tableId === tableId,
    masterOperationalSnapshotRef: snapshot,
    reconcileRejectedTableTickets,
    clearPendingClientTableSync: async () => {},
    setParkedTickets: () => {}, writeCriticalCollectionsMirror: () => {}, cashMovements: [],
    db: { save: async () => {} }, fetchTables: async () => {}, console: { warn: () => {} },
  });
  await rollback(new Error('TABLE_EDIT_LOCK_REQUIRED'), pendingC, 'token-C');
  assert.deepEqual(snapshot.current.parkedTickets, [unrelated, original]);
});

test('cierre y nuevo lock de la misma mesa invalidan baseline de la sesión anterior', () => {
  let freshLockGuard: ts.IfStatement | undefined;
  let closeGuard: ts.IfStatement | undefined;
  const collect = (node: ts.Node) => {
    if (ts.isIfStatement(node) && node.expression.getText(source).includes('!reusableLock && pendingClientTableSyncRef.current')) freshLockGuard = node;
    if (ts.isIfStatement(node) && node.thenStatement.getText(source).includes('remainingAcknowledged') && node.expression.getText(source) === 'closedOrderId') closeGuard = node;
    ts.forEachChild(node, collect);
  };
  collect(source);
  assert.ok(freshLockGuard && closeGuard);
  const run = (statement: ts.IfStatement, bindings: Record<string, unknown>) => {
    const compiled = ts.transpileModule(statement.getText(source), {
      fileName: 'session.ts', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    new Function(...Object.keys(bindings), compiled)(...Object.values(bindings));
  };
  const first = ticket('old', 'A', 'Sesión anterior');
  const second = ticket('other', 'A', 'Cuenta remanente');
  const ref = { current: new Map([['A', [first, second]]]) };
  run(closeGuard, { closedOrderId: 'old', table: { id: 'A' }, lastAcknowledgedTableTicketsRef: ref });
  assert.deepEqual(ref.current.get('A'), [second]);
  run(closeGuard, { closedOrderId: 'other', table: { id: 'A' }, lastAcknowledgedTableTicketsRef: ref });
  assert.equal(ref.current.has('A'), false);
  ref.current.set('A', [first]);
  run(freshLockGuard, {
    reusableLock: undefined, tableId: 'A', lastAcknowledgedTableTicketsRef: ref,
    pendingClientTableSyncRef: { current: null }, pendingMasterTableSyncRef: { current: null },
  });
  assert.equal(ref.current.has('A'), false);
  ref.current.set('A', [first]);
  run(freshLockGuard, {
    reusableLock: undefined, tableId: 'A', lastAcknowledgedTableTicketsRef: ref,
    pendingClientTableSyncRef: { current: { tableId: 'A' } }, pendingMasterTableSyncRef: { current: null },
  });
  assert.deepEqual(ref.current.get('A'), [first], 'pending rollback keeps its baseline');
});

test('B en clear durable impide que fresh acquire C convierta B rechazada en ACK', async () => {
  const original = ticket('one', 'A', 'Cuenta original');
  const rejectedB = ticket('one', 'A', 'Cuenta B rechazada');
  const rejectedC = ticket('two', 'A', 'Cuenta C rechazada');
  const lastAck = { current: new Map([['A', [original]]]) };
  const pendingB = { tableId: 'A' };
  const pendingC = { tableId: 'A' };
  const pendingClient = { current: pendingB };
  const snapshot = { current: { parkedTickets: [rejectedB] } };
  let clearStarted!: () => void;
  const clearEntered = new Promise<void>(resolve => { clearStarted = resolve; });
  let resolveClear!: () => void;
  const delayedClear = new Promise<void>(resolve => { resolveClear = resolve; });
  let reads = 0;
  const rollback = evaluate({
    activeTableEditLockRef: { current: { tableId: 'A', token: 'token-C' } },
    tableLockLifecycleVersionRef: { current: 0 },
    rejectedTableSyncGenerationRef: { current: new Map<string, number>() },
    lastAcknowledgedTableTicketsRef: lastAck,
    pendingClientTableSyncRef: pendingClient, pendingMasterTableSyncRef: { current: null },
    setActiveTableEditLock: () => {},
    fetchAuthoritativeTableSnapshot: async () => {
      reads += 1;
      if (reads > 1) throw new Error('Master unavailable');
      return { assertCurrentAuthority: () => {}, parkedTickets: [original] };
    },
    resolveValidatedOperationalApiUrl: async () => '', isClientTerminalMode: () => false,
    parkedTicketReferencesTable: (row: { tableId: string }, tableId: string) => row.tableId === tableId,
    masterOperationalSnapshotRef: snapshot, reconcileRejectedTableTickets,
    clearPendingClientTableSync: () => { clearStarted(); return delayedClear; },
    setParkedTickets: () => {}, writeCriticalCollectionsMirror: () => {}, cashMovements: [],
    db: { save: async () => {} }, fetchTables: async () => {}, console: { warn: () => {} },
  });
  const rejectingB = rollback(new Error('TABLE_EDIT_LOCK_REQUIRED'), pendingB, 'token-B');
  await clearEntered;
  assert.equal(pendingClient.current, pendingB);

  const guards: ts.IfStatement[] = [];
  const collect = (node: ts.Node) => {
    if (ts.isIfStatement(node) && (
      node.expression.getText(source).includes('!reusableLock && pendingClientTableSyncRef.current')
      || node.expression.getText(source).includes('!lastAcknowledgedTableTicketsRef.current.has(syncTableId)')
    )) guards.push(node);
    ts.forEachChild(node, collect);
  };
  collect(source);
  assert.equal(guards.length, 3);
  for (const guard of guards) {
    const compiled = ts.transpileModule(guard.getText(source), {
      fileName: 'guard.ts', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    new Function('reusableLock', 'syncTableId', 'tableId', 'lastAcknowledgedTableTicketsRef', 'pendingClientTableSyncRef', 'pendingMasterTableSyncRef', 'parkedTickets', 'parkedTicketReferencesTable', compiled)(
      undefined, 'A', 'A', lastAck, pendingClient, { current: null }, [rejectedB],
      (row: { tableId: string }, target: string) => row.tableId === target,
    );
  }
  assert.deepEqual(lastAck.current.get('A'), [original]);
  pendingClient.current = pendingC;
  snapshot.current.parkedTickets = [rejectedB, rejectedC];
  resolveClear();
  await rejectingB;
  await rollback(new Error('TABLE_EDIT_LOCK_REQUIRED'), pendingC, 'token-C');
  assert.deepEqual(snapshot.current.parkedTickets, [original]);
});
