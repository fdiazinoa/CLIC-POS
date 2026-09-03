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
    assert.deepEqual(Array.from(options.resolvedScopes), ['identity', 'role']);
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
    isErpSetupMode, finalConfig: initial, currentConfig: initial, effectivePairedTerminal: { id: 't1' },
    pairedTerminal: { id: 't1' }, storedDeviceId: 'd1', console: { warn() {} }, setConfig() {},
    syncManager: {
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

test('ERP refresh is deferred until after the login loading gate opens', async () => {
  const failed = await runBoot(true, true);
  assert.deepEqual(failed.result.users, []); assert.equal(failed.result.config, failed.initial);
  const expression = app.match(/const refreshedUsers = (startupErpUsers !== null[\s\S]*?refreshErpPosUserRoster\(finalConfig\));/)?.[1];
  assert.ok(expression);
  for (const users of [null, [], [{ id: 'revoked-since-early-refresh' }]]) {
    let retries = 0;
    const latestPersistedUsers: unknown[] = [];
    const evaluate = runInNewContext(`(async () => ${expression})`, {
      startupErpUsers: users, localUsers: latestPersistedUsers, finalConfig: {}, syncManager: { refreshErpPosUserRoster: async () => { retries++; return []; } },
    });
    const result = await evaluate();
    assert.equal(retries, users === null ? 1 : 0);
    assert.equal(result.length, 0, 'a newer empty roster must not resurrect a revoked user');
    if (users !== null) assert.equal(result, latestPersistedUsers);
  }
  assert.match(app, /if \(usableUsers.length === 0\) \{\s*throw new Error/);
  assert.ok(app.indexOf('const license = await checkLicenseStatus') < app.indexOf('let startupErpUsers:'));
  assert.ok(app.indexOf("markBootStage('READY')") < app.indexOf('syncManager.refreshErpStartupSecurity(finalConfig)', app.indexOf("markBootStage('READY')")));
});

test('ERP security refresh is scheduled only after the login loading gate opens', () => {
  const ready = app.indexOf("            markBootStage('READY');");
  const gate = app.indexOf('            setIsDataLoaded(true);', ready);
  const scheduledRefresh = app.indexOf('syncManager.refreshErpStartupSecurity(finalConfig)', gate);
  assert.ok(ready >= 0 && gate > ready && scheduledRefresh > gate);
  assert.match(app.slice(gate, scheduledRefresh), /window\.setTimeout\(\(\) => \{/);
  assert.match(app.slice(scheduledRefresh, scheduledRefresh + 900), /setUsers\(refreshedUsers\)/);
});
