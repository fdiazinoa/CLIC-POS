import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validatePromotionEvidence } from '../scripts/qa/apk-release-gate.mjs';

const script = readFileSync(new URL('../scripts/release-android.sh', import.meta.url), 'utf8');
const gradle = readFileSync(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
const policy = script.slice(script.indexOf('V3_CANARY_ENABLED='), script.indexOf('info() {'));
const runPolicy = (extra: Record<string, string | undefined> = {}) => spawnSync('bash', ['-c', `set -eu\n${policy}\nprintf '%s|%s' "$VITE_LARGE_MASTER_SYNC_V3_CANARY" "$VITE_LARGE_MASTER_SYNC_V3_CANDIDATE"`], {
  encoding: 'utf8', env: { ...process.env, LAN_HTTP_ENABLED: 'true',
    VITE_LARGE_MASTER_SYNC_V3_CANARY: 'false', CLIC_POS_SIGNED_V3_CANARY: 'false',
    VITE_LARGE_MASTER_SYNC_V3_CANDIDATE: 'false', CLIC_POS_SIGNED_V3_CANDIDATE: 'false',
    VITE_LARGE_MASTER_SYNC_V3_BASE_URL: '',
    CLIC_POS_DIAGNOSTICS: 'false', CLIC_POS_WEBVIEW_PROFILE: 'false', CLIC_POS_TABLE_LATENCY_QA: 'false', ...extra },
});
const origin = 'https://clic-erp-production.up.railway.app';
const candidate = { VITE_LARGE_MASTER_SYNC_V3_CANDIDATE: 'true', CLIC_POS_SIGNED_V3_CANDIDATE: 'true',
  VITE_LARGE_MASTER_SYNC_V3_BASE_URL: origin };

test('operational V3 origin fails closed before canonical mutations without leaking rejected values', () => {
  for (const value of [undefined, '', '   ', 'undefined', 'not-a-url', 'ftp://example.com', 'http://example.com',
    'https://user:secret@example.com', `${origin}/api/sync`, `${origin}/?token=secret`, `${origin}/#secret`]) {
    const result = runPolicy({ ...candidate, VITE_LARGE_MASTER_SYNC_V3_BASE_URL: value });
    assert.equal(result.status, 1, value);
    assert.ok(!value || !result.stderr.includes(value), 'must not print invalid caller URL');
  }
  const validation = script.indexOf('const value = process.env.VITE_LARGE_MASTER_SYNC_V3_BASE_URL;');
  for (const mutation of ['git -C "${CANONICAL_BUILD_WORKTREE}" checkout', 'update_gradle_version "', 'sync_release_artifacts "', './gradlew assembleRelease']) {
    assert.ok(validation < script.indexOf(mutation), mutation);
  }
  const normalized = spawnSync('bash', ['-c', `set -eu\n${policy}\nprintf '%s' "$VITE_LARGE_MASTER_SYNC_V3_BASE_URL"`], {
    encoding: 'utf8', env: { ...process.env, ...candidate, LAN_HTTP_ENABLED: 'true',
      VITE_LARGE_MASTER_SYNC_V3_BASE_URL: `  ${origin.toUpperCase()}/  `,
      VITE_LARGE_MASTER_SYNC_V3_CANARY: 'false', CLIC_POS_SIGNED_V3_CANARY: 'false',
      CLIC_POS_DIAGNOSTICS: 'false', CLIC_POS_WEBVIEW_PROFILE: 'false', CLIC_POS_TABLE_LATENCY_QA: 'false' },
  });
  assert.equal(normalized.status, 0, normalized.stderr);
  assert.equal(normalized.stdout, origin);
  for (const url of ['http://localhost:3001/', 'http://127.0.0.1:3001/', 'http://[::1]:3001/']) {
    assert.equal(runPolicy({ ...candidate, VITE_LARGE_MASTER_SYNC_V3_BASE_URL: url }).status, 0);
  }
  assert.equal(runPolicy().status, 0, 'V2 requires no V3 URL');
  assert.equal(runPolicy({ VITE_LARGE_MASTER_SYNC_V3_BASE_URL: undefined }).status, 0);
});

test('pre-Gradle packaged origin proof executes against matched JavaScript assets', () => {
  const start = script.indexOf("import fs from 'node:fs';", script.indexOf('ASSET_REPORT='));
  const producer = script.slice(start, script.indexOf('\nNODE', start));
  assert.ok(script.indexOf('downloadOriginAssets.length') < script.indexOf('./gradlew assembleRelease'));
  for (const [operational, content, expected] of [
    ['true', `const downloadOrigin=${JSON.stringify(origin)};`, 0],
    ['true', 'const missingOrigin = undefined;', 1],
    ['false', 'const missingOrigin = undefined;', 0],
  ] as const) {
    const virtual = producer.replace("import fs from 'node:fs';", `const fs = {
      readdirSync: () => [{name:'runtime.js',isDirectory:()=>false}],
      readFileSync: () => Buffer.from(${JSON.stringify(content)}),
      mkdirSync:()=>{}, writeFileSync:(_file,value)=>console.log(value)
    };`);
    const result = spawnSync(process.execPath, ['--input-type=module', '-', '/virtual', '/report.json', 'source-sha'], {
      input: virtual, encoding: 'utf8', env: { ...process.env,
        VITE_LARGE_MASTER_SYNC_V3_CANDIDATE: operational, VITE_LARGE_MASTER_SYNC_V3_BASE_URL: origin },
    });
    assert.equal(result.status, expected, result.stderr);
    if (expected === 0) {
      const report = JSON.parse(result.stdout.slice(0, result.stdout.indexOf('\nAssets verificados:')));
      assert.equal(report.downloadOrigin, operational === 'true' ? origin : null);
      assert.deepEqual(report.downloadOriginAssets, operational === 'true' ? ['runtime.js'] : []);
      assert.equal(report.downloadOriginVerified, operational === 'true' ? true : null);
    }
  }
});

test('paired operational candidate flags accept explicit modes and export false defaults', () => {
  assert.equal(runPolicy().stdout, 'false|false');
  assert.equal(runPolicy(candidate).stdout, 'false|true');
  assert.equal(runPolicy({ VITE_LARGE_MASTER_SYNC_V3_CANARY: 'true', CLIC_POS_SIGNED_V3_CANARY: 'true' }).stdout, 'true|false');
  assert.ok(script.indexOf('export VITE_LARGE_MASTER_SYNC_V3_CANDIDATE=') < script.indexOf('&& npm run build'));
  assert.ok(script.indexOf('export VITE_LARGE_MASTER_SYNC_V3_CANARY=') < script.indexOf('&& npm run build'));
});

test('candidate policy fails closed for missing, ambiguous and overlapping modes', () => {
  for (const extra of [
    { VITE_LARGE_MASTER_SYNC_V3_CANDIDATE: 'true' },
    { CLIC_POS_SIGNED_V3_CANDIDATE: 'true' },
    { ...candidate, VITE_LARGE_MASTER_SYNC_V3_CANDIDATE: 'yes' },
    { ...candidate, CLIC_POS_SIGNED_V3_CANDIDATE: '1' },
    { ...candidate, VITE_LARGE_MASTER_SYNC_V3_CANDIDATE: '' },
    { ...candidate, VITE_LARGE_MASTER_SYNC_V3_CANARY: 'true', CLIC_POS_SIGNED_V3_CANARY: 'true' },
    ...['CLIC_POS_DIAGNOSTICS', 'CLIC_POS_WEBVIEW_PROFILE', 'CLIC_POS_TABLE_LATENCY_QA'].flatMap(flag => [
      { ...candidate, [flag]: 'true' }, { ...candidate, [flag]: 'yes' }, { ...candidate, [flag]: '' },
    ]),
  ]) assert.equal(runPolicy(extra).status, 1, JSON.stringify(extra));
});

test('actual packaged candidate identity matches canonical filename and advances normal versions', () => {
  assert.match(gradle, /v3Candidate != signedV3CandidateOptIn/);
  assert.match(gradle, /if \(v3Candidate && v3Canary\)/);
  assert.match(gradle, /v3Candidate && \['CLIC_POS_DIAGNOSTICS', 'CLIC_POS_WEBVIEW_PROFILE', 'CLIC_POS_TABLE_LATENCY_QA'\]\.any/);
  assert.match(gradle, /value in \['true', 'false'\]/);
  assert.match(gradle, /if \(v3Candidate && signedV3CandidateOptIn\) versionNameSuffix '-v3-candidate'/);
  const start = script.indexOf('if [[ "${SOURCE_VERSION_CODE}" == "${NEXT_VERSION_CODE}"');
  const end = script.indexOf('info "Fuente del release:', start);
  const result = spawnSync('bash', ['-c', `set -eu\n${script.slice(start, end)}\nprintf '%s|%s' "$VERSION_NAME" "$ARTIFACT_VERSION_NAME"`], {
    encoding: 'utf8', env: { ...process.env, SOURCE_VERSION_CODE: '1479', NEXT_VERSION_CODE: '1481',
      SOURCE_VERSION_NAME: '1.1.479', LATEST_RELEASE_VERSION_NAME: '1.1.480-v3-candidate',
      V3_CANARY_ENABLED: 'false', V3_CANDIDATE_ENABLED: 'true', CLIC_POS_DIAGNOSTICS: 'false', CLIC_POS_WEBVIEW_PROFILE: 'false' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '1.1.481|1.1.481-v3-candidate');
  assert.match(script, /Clic-Pos-\$\{ARTIFACT_VERSION_NAME\}-release\.apk/);
  assert.match(script, /ACTUAL_VERSION_NAME.*NEXT_VERSION_CODE.*ARTIFACT_VERSION_NAME/);
  assert.match(script, /operationalV3Candidate=\$\{V3_CANDIDATE_ENABLED\}/);
  assert.match(script, /nonpromotable=\$\{NONPROMOTABLE\}/);
});

test('generated Android mode metadata retains candidate provenance and lab sales policy', () => {
  const start = script.indexOf("import fs from 'node:fs';", script.indexOf('# Preserve actual Gradle identity'));
  const end = script.indexOf('\nNODE', start);
  const source = script.slice(start, end);
  // Run the exact embedded producer with a virtual fs to avoid artifact writes.
  const producer = source.replace("import fs from 'node:fs';", "const fs = { readFileSync: () => '{\"elements\":[{\"versionName\":\"1.1.481\"}]}', writeFileSync: (_file, value) => console.log(value) };");
  for (const [canary, operational, mode, sales] of [
    ['false', 'false', 'normal-v2', true], ['true', 'false', 'laboratory-v3-canary', false], ['false', 'true', 'operational-v3-candidate', true],
  ] as const) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-', 'unused', 'source-sha'], { input: producer, encoding: 'utf8', env: { ...process.env,
      VITE_LARGE_MASTER_SYNC_V3_CANARY: canary, CLIC_POS_SIGNED_V3_CANARY: canary,
      VITE_LARGE_MASTER_SYNC_V3_BASE_URL: origin,
      VITE_LARGE_MASTER_SYNC_V3_CANDIDATE: operational, CLIC_POS_SIGNED_V3_CANDIDATE: operational } });
    assert.equal(result.status, 0, result.stderr);
    const metadata = JSON.parse(result.stdout);
    assert.equal(metadata.buildMode, mode);
    assert.equal(metadata.salesEnabled, sales);
    assert.equal(metadata.nonpromotable, canary === 'true' || operational === 'true');
    assert.equal(metadata.operationalV3Candidate, operational === 'true');
    assert.equal(metadata.sourceCommit, 'source-sha');
    assert.equal(metadata.downloadOrigin, operational === 'true' ? origin : null);
  }
});

test('promotion rejects candidate provenance even with forged normal version names', () => {
  for (const field of ['operationalV3Candidate', 'nonpromotable', 'canaryNonPromotable', 'signedV3Canary', 'signedV3CanaryOptIn', 'signedV3CandidateOptIn']) {
    for (const value of [true, 'true', 'yes']) {
      assert.throws(() => validatePromotionEvidence({}, { schemaVersion: 1, versionName: '1.1.481', [field]: value }), /no promovible/);
    }
  }
  for (const buildMode of ['operational-v3-candidate', 'laboratory-v3-canary', 'unknown']) {
    assert.throws(() => validatePromotionEvidence({}, { schemaVersion: 1, buildMode }), /no promovible/);
  }
  assert.throws(() => validatePromotionEvidence({}, { schemaVersion: 1, sourceCommit: 'a'.repeat(40), versionName: '1.1.481-v3-candidate' }), /versionName/);
});
