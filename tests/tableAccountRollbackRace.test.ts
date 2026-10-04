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

test('clearPending tardío no aplica snapshot B y restaura el pending C de la misma mesa', async () => {
  const optimisticC = ticket('one', 'A', 'Cuenta C');
  const pendingB = { tableId: 'A' };
  const pendingC = { tableId: 'A' };
  const pendingClient = { current: pendingB };
  const snapshot = { current: { parkedTickets: [ticket('one', 'A', 'Cuenta B')] } };
  const restored: unknown[] = [];
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
    persistPendingClientTableSync: async (value: unknown) => { restored.push(value); },
    setParkedTickets: () => { snapshotWrites += 1; },
    writeCriticalCollectionsMirror: () => { snapshotWrites += 1; },
    db: { save: async () => { snapshotWrites += 1; } },
    fetchTables: async () => { snapshotWrites += 1; },
    console: { warn: () => {} },
  });
  const rejectedB = rollback(new Error('TABLE_EDIT_LOCK_REQUIRED'), pendingB, 'token-B');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(pendingClient.current, null, 'B should be clearing before C takes over');
  pendingClient.current = pendingC;
  snapshot.current.parkedTickets = [optimisticC];
  resolveClear();
  await rejectedB;
  assert.equal(pendingClient.current, pendingC);
  assert.deepEqual(snapshot.current.parkedTickets, [optimisticC]);
  assert.equal(snapshotWrites, 0);
  assert.deepEqual(restored, [pendingC]);
});
