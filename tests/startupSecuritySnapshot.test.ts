import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const manager = readFileSync(new URL('../services/sync/SyncManager.ts', import.meta.url), 'utf8');
const methods = manager.slice(manager.indexOf('    public async refreshErpPosUserRoster('), manager.indexOf('    private ensureDeviceToken()'));
function subject(kind: string, users: unknown[], refresh: (...args: any[]) => Promise<unknown>) {
  const Constructor = runInNewContext(ts.transpile(`class Subject { ${methods} }\nSubject;`, { target: ts.ScriptTarget.ES2022 }), {
    syncPolicy: { resolve: () => ({ kind }) }, db: { get: async () => users },
  });
  const instance = new Constructor(); instance.refreshTerminalResolvedConfig = refresh; return instance;
}

test('one forced security snapshot returns updated config and roster without forcing the catalog', async () => {
  let calls = 0; const config = { terminals: [] }; const users = [{ id: 'authorized' }];
  const instance = subject('ERP_ACTIVE', users, async (_: unknown, options: any) => {
    calls++;
    assert.equal(options.forceRemoteFetch, true);
    assert.equal(options.forceFullCatalog, false);
    assert.equal(options.requestTimeoutMs, 8000);
    assert.equal(options.supplementalMode, 'skip');
    assert.deepEqual(Array.from(options.masterScopes), ['pos_users', 'users', 'pos_roles', 'roles']);
    assert.deepEqual(Array.from(options.resolvedScopes), ['identity', 'role', 'documents']);
    return config;
  });
  const result = await instance.refreshErpStartupSecurity({ terminals: [] });
  assert.equal(calls, 1); assert.equal(result.config, config); assert.equal(result.users, users);
});

test('empty authorized roster stays empty and explicit security failures are propagated', async () => {
  const instance = subject('ERP_ACTIVE', [], async () => ({ terminals: [] }));
  assert.equal((await instance.refreshErpStartupSecurity(null)).users.length, 0);
  instance.refreshTerminalResolvedConfig = async () => { throw new Error('HTTP 403'); };
  await assert.rejects(instance.refreshErpStartupSecurity(null), /HTTP 403/);
});

test('existing roster callers and local mode retain their behavior', async () => {
  const users = [{ id: 'local' }]; let calls = 0;
  const instance = subject('LOCAL_ONLY', users, async () => { calls++; return null; });
  assert.equal(await instance.refreshErpPosUserRoster(null), users);
  assert.equal(calls, 0);
});

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const block = app.slice(app.indexOf('            let startupErpUsers:'), app.indexOf("            markBootStage('TERMINAL_CONFIG_READY')"));
async function runBoot(isErpSetupMode: boolean, fail = false) {
  const calls: string[] = []; const initial = { terminals: [] }; const config = { terminals: [] };
  const users: unknown[] = []; // An empty roster must not cause a second query or a fallback to old users.
  const execute = runInNewContext(ts.transpile(`(async () => {${block}\nreturn { users: startupErpUsers, config: finalConfig };})`, { target: ts.ScriptTarget.ES2022 }), {
    isErpSetupMode, shouldFetchConfigFromMaster: false, isClientTerminalMode: () => false,
    finalConfig: initial, currentConfig: initial, effectivePairedTerminal: { id: 't1', config: { isPrimaryNode: true } },
    pairedTerminal: { id: 't1' }, storedDeviceId: 'd1', console: { warn() {} }, setConfig() {},
    markBootStage() {}, freezePhase() {},
    syncManager: {
      initialize: async () => {},
      refreshErpStartupSecurity: async () => { calls.push('security'); if (fail) throw new Error('offline'); return { config, users }; },
      refreshTerminalResolvedConfig: async () => { calls.push('general'); return config; },
    },
    db: { get: async () => users },
  });
  return { calls, result: await execute(), users, initial, config };
}

test('ERP startup uses the local roster; local startup keeps general config', async () => {
  const erp = await runBoot(true);
  assert.deepEqual(erp.calls, []); assert.deepEqual(erp.result.users, []); assert.equal(erp.result.config, erp.initial);
  const local = await runBoot(false);
  assert.deepEqual(local.calls, ['general']); assert.equal(local.result.users, null);
});

test('empty local roster fetches security instead of reusing the startup cache', async () => {
  const failed = await runBoot(true, true);
  assert.deepEqual(failed.result.users, []); assert.equal(failed.result.config, failed.initial);
  const expression = app.match(/const refreshedUsers = (startupErpUsers !== null[\s\S]*?refreshErpPosUserRoster\(finalConfig\));/)?.[1];
  assert.ok(expression);
  for (const users of [null, [], [{ id: 'revoked-since-early-refresh' }]]) {
    let retries = 0;
    const latestPersistedUsers: unknown[] = [];
    const evaluate = runInNewContext(`(async () => ${expression})`, {
      startupErpUsers: users, usableUsers: [], localUsers: latestPersistedUsers, finalConfig: {}, syncManager: { refreshErpPosUserRoster: async () => { retries++; return []; } },
    });
    const result = await evaluate();
    assert.equal(retries, 1);
    assert.equal(result.length, 0, 'a newer empty roster must not resurrect a revoked user');

  }
  assert.match(app, /if \(usableUsers.length === 0\) \{\s*throw new Error/);
  assert.ok(app.indexOf('const license = await checkLicenseStatus') < app.indexOf('let startupErpUsers:'));
  assert.ok(app.indexOf("markBootStage('READY')") < app.indexOf('syncManager.refreshErpStartupSecurity(finalConfig,', app.indexOf("markBootStage('READY')")));
});

test('ERP security refresh is scheduled only after the login loading gate opens', () => {
  const ready = app.indexOf("            markBootStage('READY');");
  const gate = app.indexOf('            setIsDataLoaded(true);', ready);
  const scheduledRefresh = app.indexOf('syncManager.refreshErpStartupSecurity(finalConfig,', gate);
  assert.ok(ready >= 0 && gate > ready && scheduledRefresh > gate);
  assert.match(app.slice(gate, scheduledRefresh), /window\.setTimeout\(\(\) => \{/);
  assert.match(app.slice(scheduledRefresh, scheduledRefresh + 200), /deferDuringSale: true/);
  assert.match(app.slice(scheduledRefresh, scheduledRefresh + 900), /setUsers\(refreshedUsers\)/);
});


test('missing local roster requests a full security snapshot despite saved cursors', async () => {
  const instance = subject('ERP_ACTIVE', [], async (_: unknown, options: any) => {
    assert.equal(options.forceFullCatalog, true);
    return { terminals: [] };
  });
  await instance.refreshErpStartupSecurity({ terminals: [] });
});

test('background users unlock a failed bootstrap; empty users never unlock it', async () => {
  const start = app.indexOf('.then(async (security) => {', app.indexOf("markBootStage('READY')"));
  const body = app.slice(start + '.then(async (security) => {'.length, app.indexOf('                  })', start));
  for (const users of [[], [{ id: 'authorized', syncSource: 'ERP_SNAPSHOT' }]]) {
    let loaded = false; let error: string | null = 'No authorized users';
    const execute = runInNewContext(ts.transpile(`(async () => {${body}})`, { target: ts.ScriptTarget.ES2022 }), {
      security: {}, db: { get: async () => users }, visiblePosUsersForRuntime: (value: unknown) => value,
      setUsers() {}, setConfig() {}, setBootstrapError(value: string | null) { error = value; },
      setIsSecurityLoaded(value: boolean) { loaded = value; },
    });
    await execute();
    assert.equal(loaded, users.length > 0);
    assert.equal(error, users.length > 0 ? null : 'No authorized users');
  }
});


test('existing local users keep immediate offline login without another blocking request', async () => {
  const expression = app.match(/const refreshedUsers = (startupErpUsers !== null[\s\S]*?refreshErpPosUserRoster\(finalConfig\));/)?.[1];
  assert.ok(expression);
  const users = [{ id: 'offline-user' }];
  const execute = runInNewContext(`(async () => ${expression})`, {
    startupErpUsers: users, usableUsers: users, localUsers: users, finalConfig: {},
    syncManager: { refreshErpPosUserRoster: async () => { throw new Error('must not request network'); } },
  });
  assert.equal(await execute(), users);
});

// Exercise the real startup method with the captured, sanitized ERP documents shape,
// then the same production snapshot normalization/rehydration used by its refresh.
test('startup documents refresh repairs stale empty assignments without global fallback or pointer rewind', async () => {
  const { dbAdapter } = await import('../services/db');
  const { db } = await import('../utils/db');
  const { DEFAULT_TERMINAL_CONFIG } = await import('../constants');
  const { applyTerminalConfigSnapshot, extractTerminalOperationalDocumentState } = await import('../utils/terminalConfigSnapshot');
  const wire = JSON.parse(readFileSync(new URL('./fixtures/startup-fiscal-documents.json', import.meta.url), 'utf8'));
  const terminalId = wire.terminal_id;
  const foreignAllocation = { id: 'other-terminal-b02', terminalId: 'other-terminal', ncfType: 'B02', prefix: 'B02', reservedStart: 6000, reservedEnd: 6100, nextNumber: 6001, status: 'ACTIVE' };
  let config: any = {
    fiscalCompliance: { mode: 'LEGACY_B' },
    terminals: [{ id: terminalId, config: { ...structuredClone(DEFAULT_TERMINAL_CONFIG), erpTerminalId: terminalId,
      fiscal: { ...structuredClone(DEFAULT_TERMINAL_CONFIG.fiscal), mode: 'LEGACY_B', enabled: true, fiscalAllocations: [] } } }],
  };
  let cachedSnapshot: any = { ...wire, resolved: { documents: { fiscal_allocations: [] } } };
  const records = new Map<string, any>([
    ['config', config], ['fiscalAllocations', [foreignAllocation]], ['localFiscalBuffer', []],
    ['fiscalRanges', wire.resolved.documents.fiscal_ranges.map((row: any) => ({ id: row.id, type: row.ncf_type, prefix: row.prefix, startNumber: row.start_number, endNumber: row.end_number, currentGlobal: row.next_number - 1, isActive: true }))],
  ]);
  const originalGet = dbAdapter.getCollection;
  const originalSave = dbAdapter.saveCollection;
  let historyReads = 0;
  try {
    (dbAdapter as any).getCollection = async (key: string) => {
      if (key === 'transactions' || key === 'transactionHistory') historyReads++;
      return structuredClone(records.get(key) || []);
    };
    (dbAdapter as any).saveCollection = async (key: string, value: any) => { records.set(key, structuredClone(value)); };
    const terminalConfig = () => config.terminals[0].config;
    assert.equal(await db.getNextNCF('B02', terminalId, 1, terminalConfig()), null);
    let delivered = wire;
    let calls = 0;
    const instance = subject('ERP_ACTIVE', [{ id: 'authorized' }], async (_: unknown, options: any) => {
      calls++;
      assert.equal(options.forceRemoteFetch, true);
      assert.equal(options.requestTimeoutMs, 8000);
      assert.equal(options.deferDuringSale, true);
      assert.ok(Array.from(options.resolvedScopes).includes('documents'));
      const applied = applyTerminalConfigSnapshot(options.baseConfig, {
        terminalId, incomingSnapshot: delivered, cachedSnapshot, preserveOmittedOperationalScopes: true,
      });
      config = applied.config;
      records.set('config', structuredClone(config));
      const state = extractTerminalOperationalDocumentState(config, applied.terminalId);
      await db.rehydrateOperationalDocumentState(state.documentSeries, state.fiscalRanges, state.fiscalAllocations, state.terminalId);
      cachedSnapshot = delivered;
      return config;
    });
    await instance.refreshErpStartupSecurity(config, { deferDuringSale: true });
    assert.equal(calls, 1);
    assert.equal(terminalConfig().fiscal.fiscalAllocations.length, 3);
    assert.equal(await db.getNextNCF('B02', terminalId, 1, terminalConfig()), 'B0200000004');
    assert.equal(records.get('fiscalAllocations').find((row: any) => row.ncfType === 'B02' && row.terminalId === terminalId).nextNumber, 5);
    assert.equal(records.get('fiscalRanges').find((row: any) => row.type === 'B02').currentGlobal, 3);
    assert.deepEqual(records.get('fiscalAllocations').find((row: any) => row.terminalId === 'other-terminal'), foreignAllocation);
    assert.equal(await db.getNextNCF('B04', terminalId, 1, terminalConfig()), null);
    // Re-delivery after restart must use persisted pointers rather than stale ERP next4.
    await instance.refreshErpStartupSecurity(config, { deferDuringSale: true });
    assert.equal(await db.getNextNCF('B02', terminalId, 1, terminalConfig()), 'B0200000005');
    instance.refreshTerminalResolvedConfig = async () => { throw new Error('offline'); };
    await assert.rejects(instance.refreshErpStartupSecurity(config), /offline/);
    assert.equal(await db.getNextNCF('B02', terminalId, 1, terminalConfig()), 'B0200000006');
    // Explicit revocation through the same snapshot apply path remains authoritative.
    const revoked = applyTerminalConfigSnapshot(config, {
      terminalId, incomingSnapshot: { ...wire, resolved: { documents: { fiscal_allocations: [] } } }, cachedSnapshot,
      preserveOmittedOperationalScopes: true,
    });
    config = revoked.config;
    const state = extractTerminalOperationalDocumentState(config, revoked.terminalId);
    await db.rehydrateOperationalDocumentState(state.documentSeries, state.fiscalRanges, state.fiscalAllocations, state.terminalId);
    const beforeDenial = structuredClone([...records]);
    assert.equal(await db.getNextNCF('B02', terminalId, 1, terminalConfig()), null);
    assert.equal(await db.getNextNCF('B04', terminalId, 1, terminalConfig()), null);
    assert.deepEqual([...records], beforeDenial);
    assert.equal(historyReads, 0);
  } finally {
    dbAdapter.getCollection = originalGet;
    dbAdapter.saveCollection = originalSave;
  }
});
