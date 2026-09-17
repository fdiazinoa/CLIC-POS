import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolveDiagnosticMode, verifyExecutableAssets, verifyWebAssets, verifyNativeArtifact } from '../scripts/diagnostics/release-diagnostic-mode.mjs';
import { runPreflight, safeResult, writeExternalReport } from '../scripts/diagnostics/check-reference.mjs';

const root = path.resolve(import.meta.dirname, '..');
const release = fs.readFileSync(path.join(root, 'scripts/release-android.sh'), 'utf8');
const F = 'CLIC_POS_SCANNER_FOCUS_DIAGNOSTICS', B = 'CLIC_POS_DIAGNOSTICS', N = 'CLIC_POS_NATIVE_DIAGNOSTICS';
const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pos-focused-tooling-'));
const write = (file: string, content: string) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };

test('actual diagnostic resolver preserves default/legacy and strict flag matrix', () => {
  assert.equal(resolveDiagnosticMode({}).mode, 'normal');
  assert.equal(resolveDiagnosticMode({ [B]: 'true' }).mode, 'broad');
  assert.equal(resolveDiagnosticMode({ [N]: 'true' }).mode, 'native-control');
  const focused = resolveDiagnosticMode({ [F]: 'true', [N]: 'true' });
  assert.equal(focused.mode, 'focused-control');
  for (const key of ['diagnostic', 'instrumented', 'temporary']) assert.equal(focused[key], true);
  assert.equal(focused.releaseEligible, false);
  assert.equal(focused.promotionGatePassed, false);
  for (const env of [{ [B]: 'true', [F]: 'true' }, { [F]: 'true' }, { [B]: 'true', [N]: 'false' }]) assert.throws(() => resolveDiagnosticMode(env));
  for (const key of [F, B, N]) for (const invalid of ['', 'TRUE', '1', 'yes', ' false ']) assert.throws(() => resolveDiagnosticMode({ [key]: invalid }));
});

test('invalid release flags fail before even calling git', () => {
  const dir = fixture(), marker = path.join(dir, 'git-called');
  write(path.join(dir, 'git'), `#!/bin/sh\ntouch '${marker}'\nexit 91\n`);
  fs.chmodSync(path.join(dir, 'git'), 0o755);
  const result = spawnSync('bash', [path.join(root, 'scripts/release-android.sh'), 'HEAD'], {
    env: { ...process.env, PATH: dir + path.delimiter + process.env.PATH, [B]: 'false', [F]: 'true', [N]: 'false' }, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Incompatible CLIC-POS diagnostic flags/);
  assert.equal(fs.existsSync(marker), false);
});

test('executable assets, not maps/docs, determine actual mode', () => {
  const normal = resolveDiagnosticMode({});
  assert.equal(verifyExecutableAssets([['app.js', Buffer.from('console.log(1)')], ['app.js.map', Buffer.from('__CLIC_POS_SCANNER_FOCUS__')]], normal).focusedApiPresent, false);
  assert.throws(() => verifyExecutableAssets([['app.js.map', Buffer.from('__CLIC_POS_SCANNER_FOCUS__')]], normal));
  const focused = resolveDiagnosticMode({ [F]: 'true', [N]: 'true' });
  assert.equal(verifyExecutableAssets([['app.js', Buffer.from('window.__CLIC_POS_SCANNER_FOCUS__')]], focused).focusedApiPresent, true);
  for (const token of ['__POS_DIAGNOSTICS__', '__zone_symbol__']) assert.throws(() => verifyExecutableAssets([['app.js', Buffer.from('__CLIC_POS_SCANNER_FOCUS__ ' + token)]], focused));
  assert.throws(() => verifyExecutableAssets([['app.js', Buffer.from('__CLIC_POS_SCANNER_FOCUS__')]], normal));
});

test('real ZIP extraction verifies bytes and rejects stale executable APK assets', () => {
  const dir = fixture(), normal = resolveDiagnosticMode({});
  write(path.join(dir, 'dist/assets/app.js'), 'console.log(1)');
  write(path.join(dir, 'android/app/src/main/assets/public/assets/app.js'), 'console.log(1)');
  write(path.join(dir, 'zip/assets/public/assets/app.js'), 'console.log(1)');
  const apk = path.join(dir, 'fixture.apk');
  execFileSync('zip', ['-qr', apk, 'assets'], { cwd: path.join(dir, 'zip') });
  assert.equal(verifyWebAssets(dir, normal, apk).apkAssetsVerified, true);
  write(path.join(dir, 'android/app/src/main/assets/public/cordova.js'), '');
  write(path.join(dir, 'zip/assets/public/cordova.js'), '');
  execFileSync('zip', ['-qr', apk, 'assets'], { cwd: path.join(dir, 'zip') });
  assert.deepEqual(verifyWebAssets(dir, normal, apk).emptyCapacitorStubs, ['cordova.js']);
  write(path.join(dir, 'android/app/src/main/assets/public/cordova.js'), 'stale-code');
  assert.throws(() => verifyWebAssets(dir, normal), /Nonempty generated/);
  write(path.join(dir, 'android/app/src/main/assets/public/cordova.js'), '');
  write(path.join(dir, 'zip/assets/public/assets/stale.js'), 'old');
  execFileSync('zip', ['-qr', apk, 'assets'], { cwd: path.join(dir, 'zip') });
  assert.throws(() => verifyWebAssets(dir, normal, apk), /Stale\/extra/);
  write(path.join(dir, 'android/app/src/main/assets/public/assets/app.js'), 'changed');
  assert.throws(() => verifyWebAssets(dir, normal), /Copied asset mismatch/);
});

test('native artifact verifier executes generated flag and packaged manifest/version checks (synthetic aapt fixture)', () => {
  const dir = fixture(), focused = resolveDiagnosticMode({ [F]: 'true', [N]: 'true' });
  const config = path.join(dir, 'android/app/build/generated/source/buildConfig/release/com/clicpos/app/BuildConfig.java');
  write(config, 'public static final boolean POS_DIAGNOSTICS = true; public static final boolean DEBUG = false;');
  const manifest = path.join(dir, 'manifest.txt'), badging = path.join(dir, 'badging.txt'), aapt = path.join(dir, 'aapt');
  write(manifest, 'E: profileable (line=1)\n  A: android:shell(0x010106f0)=(type 0x12)0xffffffff\n');
  write(badging, "package: name='com.clicpos.app' versionCode='1401' versionName='1.1.401'\n");
  write(aapt, `#!/bin/sh\nif [ "$2" = "xmltree" ]; then cat '${manifest}'; else cat '${badging}'; fi\n`); fs.chmodSync(aapt, 0o755);
  assert.equal(verifyNativeArtifact(dir, 'fixture.apk', aapt, focused, 1401, '1.1.401').nativeFlagsVerified, true);
  assert.throws(() => verifyNativeArtifact(dir, 'fixture.apk', aapt, focused, 1402, '1.1.402'), /version mismatch/);
  write(manifest, 'E: profileable (line=1)\n  A: android:shell(0x010106f0)=(type 0x12)0x0\n');
  assert.throws(() => verifyNativeArtifact(dir, 'fixture.apk', aapt, focused, 1401, '1.1.401'), /profileable mismatch/);
  write(config, 'public static final boolean POS_DIAGNOSTICS = false; public static final boolean DEBUG = false;');
  assert.throws(() => verifyNativeArtifact(dir, 'fixture.apk', aapt, focused, 1401, '1.1.401'), /native flags mismatch/);
});

const clean = { zone: 'undefined', nativeActive: false, diagnosticApi: 'undefined', origin: 'https://localhost', focusedMethods: true, clockMs: 1, timeOrigin: 100 };
test('focused result fails closed, legacy predicates retained, no arbitrary payload logged', () => {
  assert.equal(safeResult(clean, 'focused').valid, true);
  assert.equal(safeResult(clean, 'reference').valid, true);
  assert.equal(safeResult({ ...clean, zone: 'function', nativeActive: true, diagnosticApi: 'object' }, 'diagnostic').valid, true);
  for (const change of [{ zone: undefined }, { zone: 'function' }, { nativeActive: true }, { diagnosticApi: 'object' }, { focusedMethods: false }, { origin: 'https://localhost.attacker' }, { clockMs: NaN }, { timeOrigin: 0 }]) assert.equal(safeResult({ ...clean, ...change }, 'focused').valid, false);
  assert.equal(JSON.stringify(safeResult({ ...clean, password: 'DO-NOT-LOG' }, 'focused')).includes('DO-NOT-LOG'), false);
});

class Socket {
  static behavior = 'success';
  static latest: Socket;
  onopen: any; onmessage: any; onerror: any; onclose: any;
  closed = false;
  constructor() { Socket.latest = this; if (Socket.behavior !== 'open-timeout') queueMicrotask(() => this.onopen?.()); }
  send(data: string) {
    const command = JSON.parse(data);
    assert.equal(command.method, 'Runtime.evaluate');
    assert.equal(command.params.expression.includes('.arm('), false);
    if (Socket.behavior === 'evaluate-timeout') return;
    const result = Socket.behavior === 'exception' ? { exceptionDetails: { text: 'SECRET-ERROR' } } : { result: { value: clean } };
    queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id: 1, result }) }));
  }
  close() { this.closed = true; }
}
const inventory = (url = 'https://localhost/', transport = 'ws://127.0.0.1:9222/devtools/page/test') => async (_url, options) => {
  assert.equal(options.redirect, 'error');
  return { ok: true, json: async () => [{ type: 'page', url, webSocketDebuggerUrl: transport }] };
};
test('bounded CDP succeeds read-only; closes on timeout/errors; exact origin and transport', async () => {
  Socket.behavior = 'success';
  assert.equal((await runPreflight('http://127.0.0.1:9222', 'focused', { fetchImpl: inventory(), WebSocketImpl: Socket, timeoutMs: 20 })).valid, true);
  assert.equal(Socket.latest.closed, true);
  assert.equal((await runPreflight('http://127.0.0.1:9222', 'focused', { fetchImpl: inventory('https://localhost/', 'ws://localhost:9222/x'), WebSocketImpl: Socket, timeoutMs: 20 })).valid, true);
  for (const behavior of ['open-timeout', 'evaluate-timeout', 'exception']) {
    Socket.behavior = behavior;
    await assert.rejects(runPreflight('http://127.0.0.1:9222', 'focused', { fetchImpl: inventory(), WebSocketImpl: Socket, timeoutMs: 20 }), error => !String(error).includes('SECRET-ERROR'));
    assert.equal(Socket.latest.closed, true);
  }
  for (const url of ['https://localhost.evil/', 'https://localhost:123/']) await assert.rejects(runPreflight('http://127.0.0.1:9222', 'focused', { fetchImpl: inventory(url), WebSocketImpl: Socket }), /exact POS/);
  await assert.rejects(runPreflight('http://127.0.0.1:9222', 'focused', { fetchImpl: inventory('https://localhost/', 'ws://example.com:9222/x'), WebSocketImpl: Socket }), /loopback/);
  await assert.rejects(runPreflight('http://127.0.0.1:9222', 'focused', { fetchImpl: inventory('https://localhost/', 'ws://127.0.0.1:9222/x?token=private'), WebSocketImpl: Socket }), /loopback/);
  await assert.rejects(runPreflight('http://127.0.0.1:9222', 'focused', { fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('SECRET-FETCH')))), WebSocketImpl: Socket, timeoutMs: 20 }), /inventory failed or timed out/);
});

test('report refuses repository, symlink and overwrite destinations', () => {
  const dir = fixture(), source = path.join(dir, 'source'); fs.mkdirSync(source);
  assert.throws(() => writeExternalReport(path.join(source, 'x.json'), {}, [source]), /external/);
  const link = path.join(dir, 'linked'); fs.symlinkSync(source, link);
  assert.throws(() => writeExternalReport(path.join(link, 'x.json'), {}, [source]), /external/);
  const out = path.join(dir, 'report.json'); writeExternalReport(out, clean, [source]);
  assert.throws(() => writeExternalReport(out, {}, [source]), /EEXIST/);
  const dangling = path.join(dir, 'dangling.json'); fs.symlinkSync(path.join(source, 'missing.json'), dangling);
  assert.throws(() => writeExternalReport(dangling, {}, [source]), /EEXIST/);
});

test('actual default report guard uses checker repository, not a foreign Git caller CWD', () => {
  const dir = fixture(), foreign = path.join(dir, 'foreign'); fs.mkdirSync(foreign);
  execFileSync('git', ['init', '--quiet', foreign]);
  const inside = path.join(root, 'tests', `forbidden-${path.basename(dir)}.json`);
  const outside = path.join(dir, 'external.json');
  const checker = pathToFileURL(path.join(root, 'scripts/diagnostics/check-reference.mjs')).href;
  const code = `import assert from 'node:assert/strict';import fs from 'node:fs';import {writeExternalReport} from ${JSON.stringify(checker)};
    assert.throws(()=>writeExternalReport(${JSON.stringify(inside)},{valid:false}),/external/);
    assert.equal(fs.existsSync(${JSON.stringify(inside)}),false);
    writeExternalReport(${JSON.stringify(outside)},{valid:false});`;
  execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: foreign });
  assert.equal(fs.existsSync(inside), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(outside, 'utf8')), { valid: false });
});

test('actual unchanged monotonic version helper/selection uses canonical and history before source checkout', () => {
  const helpers = release.slice(release.indexOf('extract_version_code_from_metadata()'), release.indexOf('resolve_sdk_dir()'));
  const select = release.slice(release.indexOf('if [[ "${SOURCE_VERSION_CODE}" =~'), release.indexOf('info "Fuente del release:'));
  for (const [canonical, history, source, expected] of [[1400, 1400, 1401, '1401|1.1.401'], [1401, 1401, 1401, '1402|1.1.402'], [1400, 1400, 1403, '1403|1.1.403']] as const) {
    const dir = fixture(), gradle = path.join(dir, 'canonical.gradle');
    write(gradle, `versionCode ${canonical}`);
    write(path.join(dir, '_worktrees/CLIC-POS/history/android/app/build/outputs/apk/release/output-metadata.json'), JSON.stringify({ elements: [{ versionCode: history, versionName: `1.1.${history - 1000}` }] }));
    const script = `set -e\nfail(){ exit 90; }\n${helpers}\nWORKSPACE_ROOT="$1"\nNEXT_VERSION_CODE="$(resolve_next_version_code "$2")"\nLATEST_RELEASE_VERSION_NAME="$(resolve_latest_version_name)"\nSOURCE_VERSION_CODE="$3"\nSOURCE_VERSION_NAME="1.1.$(($3 - 1000))"\n${select}\nprintf '%s|%s' "$NEXT_VERSION_CODE" "$VERSION_NAME"`;
    assert.equal(execFileSync('bash', ['-c', script, 'fixture', dir, gradle, String(source)], { encoding: 'utf8' }), expected);
  }
  assert.ok(release.indexOf('NEXT_VERSION_CODE="$(resolve_next_version_code') < release.indexOf('checkout --detach'));
  assert.ok(release.indexOf('release-diagnostic-mode.mjs" resolve') < release.indexOf('fetch origin'));
  assert.match(release, /apkExtractedAssetsVerified=true/);
  assert.match(release, /releaseEligible=false/);
  const gradle = fs.readFileSync(path.join(root, 'android/app/build.gradle'), 'utf8');
  assert.match(gradle, /POS_DIAGNOSTICS", nativeDiagnostics/);
  assert.match(gradle, /diagnosticProfileable: nativeDiagnostics/);
});
