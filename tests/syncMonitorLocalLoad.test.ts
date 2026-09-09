import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Execute the component's real loader and document formatting with isolated I/O.
const source = readFileSync(new URL('../components/SyncSettings.tsx', import.meta.url), 'utf8');
const loaders = source.slice(source.indexOf('    const resolveDocumentStatus'), source.indexOf('    const initialLoadDone'));
const javascript = ts.transpileModule(loaders, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function setup(get: (collection: string) => Promise<any[]>, getSyncStatus: () => Promise<unknown>, nativePage?: () => Promise<any>) {
  const state = { rows: [] as any[], error: null as string | null, loading: false, totals: { total: 0, blocked: 0 } };
  const deps = {
    nativePagination: Boolean(nativePage), dbAdapter: { getSyncMonitorPage: nativePage },
    currentPage: 1, rowsPerPage: 10, searchTerm: '', statusFilter: 'ALL', terminalFilter: 'ALL',
    auditQueryKey: 'query', latestAuditQuery: { current: 'query' },
    activeAuditQuery: { current: null }, auditReloadRequested: { current: false }, loadAuditRef: { current: async () => {} },
    setAuditTotals: (totals: any) => { state.totals = totals; },
    auditLoadInFlight: { current: false }, activeTab: 'MONITOR', config: { terminals: [] }, db: { get }, syncManager: { getSyncStatus },
    setAuditData: (rows: any[]) => { state.rows = rows; },
    setAuditLoadError: (error: string | null) => { state.error = error; },
    setIsLoadingAudit: (loading: boolean) => { state.loading = loading; },
    console: { error() {} },
  };
  const load = new Function(...Object.keys(deps), `${javascript}\nreturn { loadStatus, loadAuditData };`)(...Object.values(deps));
  return { state, ...load };
}
const blocked = (collection: string) => Promise.resolve(collection === 'cashMovements'
  ? [1, 2, 3].map(id => ({ id: `cash-${id}`, syncStatus: 'BLOCKED_FUNCTIONAL', syncError: 'Terminal rechazada' }))
  : []);

test('three local blocked documents appear even while remote diagnostics never finish', async () => {
  let rejectRemote!: (error: Error) => void;
  let remoteStarted!: () => void;
  const started = new Promise<void>(resolve => { remoteStarted = resolve; });
  const remote = new Promise((_, reject) => { rejectRemote = reject; });
  const { state, loadStatus } = setup(blocked, () => { remoteStarted(); return remote; });
  const loading = loadStatus();
  await started;
  assert.equal(state.rows.length, 3);
  assert.ok(state.rows.every((row: any) => row.status === 'ERROR' && row.error === 'Terminal rechazada'));
  assert.equal(state.loading, false);
  rejectRemote(new Error('timeout'));
  await loading;
  assert.equal(state.rows.length, 3);
  assert.equal(state.error, null);
});

test('local read failure is visible and a local retry recovers without a network call', async () => {
  let fail = true;
  const { state, loadAuditData } = setup(async collection => {
    if (fail) throw new Error('SQLite unavailable');
    return blocked(collection);
  }, () => { throw new Error('must not query remote diagnostics'); });
  await loadAuditData();
  assert.match(state.error!, /No se pudieron cargar/);
  assert.equal(state.loading, false);
  fail = false;
  await loadAuditData();
  assert.equal(state.error, null);
  assert.equal(state.rows.length, 3);
});

test('overlapping refreshes share the in-flight guard and preserve displayed documents', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let reads = 0;
  const { state, loadAuditData } = setup(async collection => {
    reads++;
    await gate;
    return blocked(collection);
  }, async () => { throw new Error('must not query remote diagnostics'); });
  state.rows = [{ id: 'previously-visible' }];
  const first = loadAuditData();
  const firstReads = reads;
  await loadAuditData();
  assert.equal(reads, firstReads);
  assert.equal(state.rows[0].id, 'previously-visible');
  release();
  await first;
  assert.equal(state.rows.length, 3);
  assert.equal(state.loading, false);
});

test('native monitor uses the SQLite page and global counts without reading whole collections', async () => {
  const { state, loadAuditData } = setup(async () => { assert.fail('no collection scan on Android'); }, async () => {}, async () => ({
    collections: { zReports: [{ id: 'z-page', sequenceNumber: 'ZS002', closedAt: '2026-01-01', syncStatus: 'ERROR' }] }, total: 350, blocked: 12,
  }));
  await loadAuditData();
  assert.equal(state.rows.length, 1);
  assert.equal(state.rows[0].id, 'ZS002');
  assert.deepEqual(state.totals, { total: 350, blocked: 12 });
});
