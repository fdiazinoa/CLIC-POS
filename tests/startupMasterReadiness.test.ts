import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { createOperationalMasterResolver, type OperationalMasterContract } from '../utils/masterOperationalApi';

const contract: OperationalMasterContract = { erpManaged: true,
  terminalId: '0efd23be-d73f-42aa-ab7d-5895b56edee0', masterTerminalId: '0f77877f-66b2-4820-b956-997cd5b4b575',
  tenantId: '9eda7d73-76e4-4432-ad13-4934fefe8f69', companyId: '6b6153ce-501e-4702-9ae9-34a3f1ab9042',
  storeId: 'de8dd318-12e7-4a3f-b0e8-4ea1bdb70c07', deviceId: 'DEV-CLIENT', localIps: ['10.0.0.123'] };
const remote = () => ({ runtimeTerminalId: contract.masterTerminalId,
  masterSetupContext: { erpEnabled: true, tenantId: contract.tenantId, companyId: contract.companyId, storeId: contract.storeId },
  terminals: [{ id: contract.masterTerminalId, config: { isPrimaryNode: true, terminalType: 'STANDARD_POS', currentDeviceId: 'DEV-MASTER' } }] });
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
};

test('boot readiness prevents discovery; completed boot missing ERP scope fails precisely without probing', async () => {
  let ready = false; let discoveries = 0; let active = { ...contract, companyId: '' };
  const resolver = createOperationalMasterResolver({ isReady: () => ready, getContract: () => active,
    mirror: () => assert.fail('incomplete identity must not be mirrored'), discover: async () => { discoveries++; return []; } });
  await assert.rejects(resolver.ensureCurrent(), /ENDPOINT_NOT_READY/);
  assert.equal(discoveries, 0);
  ready = true;
  await assert.rejects(resolver.ensureCurrent(), /CONTRACT_MISSING/);
  assert.equal(discoveries, 0);
  active = { ...contract }; assert.equal(resolver.current(), '');
});

test('hydrate during discovery classifies obsolete work before old scope validation and reconciles once single-flight', async () => {
  let active = { ...contract }; const waiting = gate(); let discoveries = 0; const mirrors: string[] = [];
  const resolver = createOperationalMasterResolver({ getContract: () => active, mirror: value => mirrors.push(value),
    discover: async () => { discoveries++; if (discoveries === 1) await waiting.promise; return [{ baseUrl: '10.0.0.101', config: remote() }]; } });
  const first = resolver.ensureCurrent(); const overlap = resolver.ensureCurrent();
  active = { ...contract, terminalType: 'ORDER_TAKER' }; waiting.release();
  assert.deepEqual(await Promise.all([first, overlap]), ['http://10.0.0.101:3001', 'http://10.0.0.101:3001']);
  assert.equal(discoveries, 2); assert.deepEqual(mirrors, ['http://10.0.0.101:3001']);
});

test('obsolete thrown discovery error cannot hide generation drift; a second drift does not loop', async () => {
  let active = { ...contract }; let discoveries = 0; const mirrors: string[] = [];
  const resolver = createOperationalMasterResolver({ getContract: () => active, mirror: value => mirrors.push(value),
    discover: async () => { discoveries++; active = { ...active, terminalType: String(discoveries) }; throw new Error('MASTER_CONFIG_HTTP_503'); } });
  await assert.rejects(resolver.ensureCurrent(), /CONTRACT_CHANGED/);
  assert.equal(discoveries, 2); assert.deepEqual(mirrors, []);
});

test('revalidated foreign, self and wrong-master candidates stay blocked', async () => {
  for (const changed of [{ companyId: '7cdae43b-eded-44d7-8f1f-89fd79da28b3' },
    { masterTerminalId: '9ffc6771-7845-4976-afd3-20cebc3cc6e8' }, { deviceId: 'DEV-MASTER' }]) {
    let active = { ...contract }; let discoveries = 0;
    const resolver = createOperationalMasterResolver({ getContract: () => active, mirror: () => assert.fail('unsafe authority accepted'),
      discover: async () => { discoveries++; if (discoveries === 1) active = { ...contract, ...changed }; return [{ baseUrl: '10.0.0.101', config: remote() }]; } });
    await assert.rejects(resolver.ensureCurrent(), /SCOPE_MISMATCH|IDENTITY_MISMATCH|SELF_IDENTITY/);
    assert.equal(discoveries, 2); assert.equal(resolver.current(), '');
  }
});

test('capture refuses publication after identity, self-IP or invalidation changes without writing mirrors', async () => {
  for (const change of ['scope', 'self', 'invalidate']) {
    let active = { ...contract }; let mirrors = 0;
    const resolver = createOperationalMasterResolver({ getContract: () => active, mirror: () => { mirrors++; },
      discover: async () => [{ baseUrl: '10.0.0.101', config: remote() }] });
    await resolver.ensureCurrent(); const isCurrent = resolver.captureAuthority(); assert.equal(isCurrent(), true);
    assert.equal(mirrors, 1);
    if (change === 'scope') active = { ...contract, storeId: '7cdae43b-eded-44d7-8f1f-89fd79da28b3' };
    else if (change === 'self') active = { ...contract, localIps: ['10.0.0.101'] };
    else resolver.invalidate();
    assert.equal(isCurrent(), false); assert.equal(mirrors, 1);
  }
});

test('LOCAL_ONLY retains ERP-independent readiness and real transport failures are not retried', async () => {
  let discoveries = 0;
  const resolver = createOperationalMasterResolver({ getContract: () => ({ ...contract, erpManaged: false, terminalId: 'CLIENT', masterTerminalId: '', tenantId: '', companyId: '', storeId: '' }),
    mirror: () => {}, discover: async () => { discoveries++; return [{ baseUrl: '10.0.0.101', config: { terminals: [] } }]; } });
  assert.equal(await resolver.ensureCurrent(), 'http://10.0.0.101:3001'); assert.equal(discoveries, 1);
  const unavailable = createOperationalMasterResolver({ getContract: () => contract, mirror: () => {},
    discover: async () => { discoveries++; throw new Error('MASTER_CONFIG_HTTP_503'); } });
  await assert.rejects(unavailable.ensureCurrent(), /503/); assert.equal(discoveries, 2);
});

// Extract and execute actual App handlers. Only I/O and unrelated business
// reconciliation are isolated; unchanged-revision fixtures never invoke the latter.
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name: string) {
  const matches: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name && node.initializer) matches.push(node.initializer.getText(file));
    ts.forEachChild(node, visit);
  };
  visit(file); assert.equal(matches.length, 1, `actual App ${name} handler`); return matches[0];
}
function setup(transport: (...args: any[]) => Promise<any>, timers?: { setTimeout: (callback: () => void, ms: number) => number; clearTimeout: (id: number) => void }) {
  let active = { ...contract }; const statuses: string[] = []; const diagnostics: any[] = [];
  const context = { current: { ready: false, getContract: () => active, getTerminal: () => ({ id: active.terminalId }) } };
  let discoveries = 0;
  const resolver = createOperationalMasterResolver({ isReady: () => context.current.ready, getContract: () => active,
    mirror: () => {}, discover: async () => { discoveries++; return [{ baseUrl: '10.0.0.101', config: remote() }]; } });
  const failureCount = { current: 0 };
  const deps: Record<string, any> = {
    isClientTerminalMode: () => true, clientRoutingContextRef: context,
    clientOperationalResolverRef: { current: resolver },
    clientMasterFailureCountRef: failureCount, clientMasterLastSuccessAtRef: { current: 0 },
    clientMasterTablesFetchInFlightRef: { current: false }, clientMasterTablesFetchPromiseRef: { current: null },
    clientMasterTablesRevalidationBudgetRef: { current: null }, clientMasterDiagnosticRef: { current: '' },
    clientMasterConnectionAttemptRef: { current: { id: 0, startedAt: 0 } },
    setClientMasterTablesStatus: (status: string) => statuses.push(status), setClientMasterDiagnostic: () => {},
    window: { setTimeout: timers?.setTimeout ?? setTimeout, clearTimeout: timers?.clearTimeout ?? clearTimeout,
      ClicPOSNativePrinter: { debugLog: (text: string) => diagnostics.push(JSON.parse(text)) } },
    console: { warn() {}, error() {}, debug() {} }, localStorage: { getItem: () => null },
    fetch: transport, pendingClientTableSyncRef: { current: null }, pendingMasterTableSyncRef: { current: null },
    readPendingClientTableSync: async () => null, lastAppliedClientRestaurantRevisionRef: { current: 1 },
    masterRestaurantRevisionRef: { current: 1 },
    useCallback: (callback: any) => callback,
  };
  const declarations = ['publishClientMasterState', 'markClientMasterOnline', 'recordClientMasterFailure',
    'ensureEligibleClientMasterEndpoint', 'fetchTables', 'retryClientMasterConnection']
    .map(name => `const ${name} = ${declaration(name)};`).join('\n');
  const javascript = ts.transpileModule(declarations, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const handlers = new Function(...Object.keys(deps), `${javascript}; return { fetchTables, retryClientMasterConnection, recordClientMasterFailure };`)(...Object.values(deps));
  return { ...handlers, context, statuses, diagnostics, failureCount, resolver,
    discoveries: () => discoveries, change: (value: Partial<OperationalMasterContract>) => { active = { ...active, ...value }; } };
}
const response = () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ revision: 1 }) });

test('actual App boot blocks probes without outages and ready overlapping probes publish ONLINE once', async () => {
  let calls = 0; const waiting = gate();
  const fixture = setup(async () => { calls++; await waiting.promise; return response(); });
  assert.deepEqual(await fixture.fetchTables(), { ok: false, pending: true });
  assert.equal(calls, 0); assert.equal(fixture.discoveries(), 0); assert.equal(fixture.failureCount.current, 0);
  fixture.context.current.ready = true;
  const first = fixture.fetchTables(); const overlap = fixture.fetchTables(); waiting.release();
  assert.deepEqual(await Promise.all([first, overlap]), [{ ok: true }, { ok: true }]);
  assert.equal(calls, 1); assert.equal(fixture.discoveries(), 1); assert.equal(fixture.failureCount.current, 0);
  assert.deepEqual(fixture.statuses, ['CHECKING', 'ONLINE']);
  assert.equal(fixture.diagnostics.length, 2);
  assert.ok(fixture.diagnostics.every((entry: any) => entry.tag === 'ClicPOSConnection'
    && entry.message === 'MASTER_CONNECTION_TRANSITION' && typeof entry.data.status === 'string'));
  assert.ok(fixture.diagnostics.every((entry: any) => !/token|deviceId|terminalId|PIN|payload/i.test(JSON.stringify(entry))));
});

test('actual App completed boot missing contract becomes actionable invalid status without network requests', async () => {
  const fixture = setup(async () => assert.fail('missing contract cannot probe'));
  fixture.context.current.ready = true; fixture.change({ companyId: '' });
  const result = await fixture.fetchTables(); assert.equal(result.ok, false);
  assert.deepEqual(fixture.statuses, ['OFFLINE']); assert.equal(fixture.discoveries(), 0);
  assert.equal(fixture.diagnostics[0].data.code, 'MASTER_CONTRACT_MISSING');
  assert.equal(fixture.failureCount.current, 0, 'invalid configuration is not a network outage');
});

test('actual explicit retry settles tables HTTP, non-JSON and transport failures instead of remaining CHECKING', async () => {
  for (const transport of [async () => ({ ok: false, status: 503 }),
    async () => ({ ok: true, headers: { get: () => 'text/html' } }),
    async () => { throw new Error('request timed out'); }]) {
    const fixture = setup(transport); fixture.context.current.ready = true;
    await fixture.retryClientMasterConnection();
    assert.deepEqual(fixture.statuses, ['CHECKING', 'OFFLINE']);
    assert.equal(fixture.failureCount.current, 1); assert.equal(fixture.discoveries(), 1);
    assert.notEqual(fixture.diagnostics.at(-1).data.code, '');
  }
});

test('actual pending mesas deadline aborts once, clears its timer and settles explicit retry without waiting', async () => {
  let deadline!: () => void; let timerMs = 0; let clears = 0; let calls = 0;
  const fixture = setup(async (_endpoint, options) => {
    calls++;
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  }, { setTimeout: (callback, ms) => { deadline = callback; timerMs = ms; return 1; }, clearTimeout: () => { clears++; } });
  fixture.context.current.ready = true;
  const retry = fixture.retryClientMasterConnection();
  while (calls === 0) await Promise.resolve();
  assert.equal(timerMs, 5000); deadline(); await retry;
  assert.deepEqual(fixture.statuses, ['CHECKING', 'OFFLINE']);
  assert.equal(fixture.diagnostics.at(-1).data.code, 'MASTER_TABLES_TIMEOUT');
  assert.equal(fixture.failureCount.current, 1); assert.equal(calls, 1); assert.equal(clears, 1);
});

test('actual polling tolerance and recovery only after a real mesas response remain unchanged', async () => {
  let available = false;
  const fixture = setup(async () => { if (!available) throw new Error('unavailable'); return response(); });
  fixture.context.current.ready = true;
  await fixture.fetchTables(); assert.deepEqual(fixture.statuses, []);
  await fixture.fetchTables(); assert.deepEqual(fixture.statuses, ['OFFLINE']);
  available = true; await fixture.fetchTables(); assert.deepEqual(fixture.statuses, ['OFFLINE', 'ONLINE']);
  assert.equal(fixture.failureCount.current, 0);
  fixture.recordClientMasterFailure('poll', new Error('first')); fixture.recordClientMasterFailure('poll', new Error('second'));
  assert.equal(fixture.statuses.at(-1), 'ONLINE'); fixture.recordClientMasterFailure('poll', new Error('third'));
  assert.equal(fixture.statuses.at(-1), 'OFFLINE');
});

test('actual stale tables reply cannot publish obsolete ONLINE; one immediate revalidation reaches current authority', async () => {
  let calls = 0; const waiting = gate();
  const fixture = setup(async () => { calls++; if (calls === 1) await waiting.promise; return response(); });
  fixture.context.current.ready = true;
  const loading = fixture.fetchTables();
  const overlap = fixture.fetchTables();
  // Let endpoint validation finish and the actual mesas request start.
  while (calls === 0) await Promise.resolve();
  fixture.change({ terminalType: 'ORDER_TAKER' }); waiting.release();
  assert.ok((await Promise.all([loading, overlap])).every(result => result.ok));
  assert.equal(calls, 2); assert.deepEqual(fixture.statuses, ['ONLINE']);
  assert.equal(fixture.failureCount.current, 0);
});

test('actual stale rejected tables request does not count an outage or overwrite latest successful authority', async () => {
  let calls = 0; const waiting = gate();
  const fixture = setup(async () => {
    calls++;
    if (calls === 1) { await waiting.promise; throw new Error('obsolete transport error'); }
    return response();
  });
  fixture.context.current.ready = true;
  const loading = fixture.fetchTables();
  while (calls === 0) await Promise.resolve();
  fixture.change({ terminalType: 'ORDER_TAKER' });
  await fixture.resolver.ensureCurrent(); waiting.release();
  assert.equal((await loading).ok, true);
  assert.equal(calls, 2); assert.deepEqual(fixture.statuses, ['ONLINE']); assert.equal(fixture.failureCount.current, 0);
});

test('actual stale response followed by foreign scope fails closed without accepting the old snapshot', async () => {
  let calls = 0; const waiting = gate();
  const fixture = setup(async () => { calls++; await waiting.promise; return response(); });
  fixture.context.current.ready = true;
  const loading = fixture.fetchTables();
  while (calls === 0) await Promise.resolve();
  fixture.change({ storeId: '7cdae43b-eded-44d7-8f1f-89fd79da28b3' }); waiting.release();
  assert.equal((await loading).ok, false);
  assert.deepEqual(fixture.statuses, ['OFFLINE']); assert.equal(calls, 1);
  assert.equal(fixture.diagnostics.at(-1).data.code, 'MASTER_SCOPE_MISMATCH');
});

test('same successful idle revision produces no periodic React status or native diagnostic updates', async () => {
  const fixture = setup(async () => response()); fixture.context.current.ready = true;
  for (let index = 0; index < 10; index++) assert.equal((await fixture.fetchTables()).ok, true);
  assert.deepEqual(fixture.statuses, ['ONLINE']); assert.equal(fixture.diagnostics.length, 1);
});

test('actual explicit retry shares one reconciliation budget across resolver and snapshot instead of looping on churn', async () => {
  let calls = 0;
  const fixture = setup(async () => {
    calls++; fixture.change({ terminalType: `changed-${calls}` }); return response();
  });
  fixture.context.current.ready = true;
  await fixture.retryClientMasterConnection();
  assert.equal(calls, 2); assert.equal(fixture.discoveries(), 2);
  assert.deepEqual(fixture.statuses, ['CHECKING', 'OFFLINE']);
  assert.equal(fixture.diagnostics.at(-1).data.code, 'MASTER_CONTRACT_CHANGED');
  assert.equal(fixture.failureCount.current, 0);
});

test('poll and focus lifecycle effects include boot readiness with no added idle loop', () => {
  const poll = app.slice(app.indexOf('// Poll tables if in restaurant mode'), app.indexOf('// --- SYNC EVENT LISTENERS'));
  assert.match(poll, /if \(!isDataLoaded\) return;/);
  assert.match(poll, /\[config\.vertical, config\.terminals, deviceId, currentView, isDataLoaded\]/);
  assert.match(poll, /if \(!isDataLoaded \|\| !isClientTerminalMode\(\)/);
  assert.match(poll, /\[currentView, isDataLoaded\]/);
});
