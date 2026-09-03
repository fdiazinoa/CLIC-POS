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

test('one forced security snapshot returns updated config and roster with no general catalog scope', async () => {
  let calls = 0; const config = { terminals: [] }; const users = [{ id: 'authorized' }];
  const instance = subject('ERP_ACTIVE', users, async (_: unknown, options: any) => {
    calls++;
    assert.equal(options.forceRemoteFetch, true);
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
  });
  return { calls, result: await execute(), users, initial, config };
}

test('ERP startup awaits security once and reuses even an empty roster; local startup keeps general config', async () => {
  const erp = await runBoot(true);
  assert.deepEqual(erp.calls, ['security']); assert.equal(erp.result.users, erp.users); assert.equal(erp.result.config, erp.config);
  const local = await runBoot(false);
  assert.deepEqual(local.calls, ['general']); assert.equal(local.result.users, null);
});

test('failed early refresh preserves the existing retry path before login', async () => {
  const failed = await runBoot(true, true);
  assert.equal(failed.result.users, null); assert.equal(failed.result.config, failed.initial);
  const expression = app.match(/const refreshedUsers = (startupErpUsers \?\? await syncManager\.refreshErpPosUserRoster\(finalConfig\));/)?.[1];
  assert.ok(expression);
  for (const users of [null, []]) {
    let retries = 0;
    const evaluate = runInNewContext(`(async () => ${expression})`, {
      startupErpUsers: users, finalConfig: {}, syncManager: { refreshErpPosUserRoster: async () => { retries++; return []; } },
    });
    await evaluate(); assert.equal(retries, users === null ? 1 : 0);
  }
  assert.match(app, /if \(usableUsers.length === 0\) \{\s*throw new Error/);
  assert.ok(app.indexOf('const license = await checkLicenseStatus') < app.indexOf('let startupErpUsers:'));
});

test('general ERP catalogs are scheduled only after the login loading gate opens', async () => {
  const start = app.indexOf("            markBootStage('READY');");
  const end = app.indexOf('              }, 1000);', start) + '              }, 1000);\n            }'.length;
  const scheduled: Array<() => Promise<unknown>> = []; const events: string[] = [];
  const execute = runInNewContext(ts.transpile(`(() => { ${app.slice(start, end)} })`, { target: ts.ScriptTarget.ES2022 }), {
    isErpSetupMode: true, markBootStage() {}, console: { log() {}, warn() {} },
    setIsDataLoaded(value: boolean) { assert.equal(value, true); events.push('access'); },
    window: { setTimeout(fn: () => Promise<unknown>, ms: number) { assert.equal(ms, 1000); scheduled.push(fn); events.push('scheduled'); } },
    syncManager: { refreshTerminalResolvedConfig: async () => { events.push('general'); } },
  });
  execute(); assert.deepEqual(events, ['access', 'scheduled']);
  await scheduled[0](); assert.deepEqual(events, ['access', 'scheduled', 'general']);
});
