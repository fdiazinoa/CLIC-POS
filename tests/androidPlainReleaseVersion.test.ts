import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validatePromotionEvidence } from '../scripts/qa/apk-release-gate.mjs';

const script = readFileSync(new URL('../scripts/release-android.sh', import.meta.url), 'utf8');
const gradle = readFileSync(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
const policy = script.slice(script.indexOf('V3_CANARY_ENABLED='), script.indexOf('info() {'));
const naming = script.slice(script.indexOf('ARTIFACT_VERSION_NAME="${VERSION_NAME}"'), script.indexOf('info "Fuente del release:'));
const env = { ...process.env, LAN_HTTP_ENABLED: 'true', VERSION_NAME: '1.1.492',
  VITE_LARGE_MASTER_SYNC_V3_CANARY: 'false', CLIC_POS_SIGNED_V3_CANARY: 'false',
  VITE_LARGE_MASTER_SYNC_V3_CANDIDATE: 'false', CLIC_POS_SIGNED_V3_CANDIDATE: 'false',
  VITE_LARGE_MASTER_SYNC_V3_BASE_URL: 'https://clic-erp-production.up.railway.app',
  CLIC_POS_RELEASE_PLAIN_VERSION_NAME: undefined,
  CLIC_POS_DIAGNOSTICS: 'false', CLIC_POS_WEBVIEW_PROFILE: 'false', CLIC_POS_TABLE_LATENCY_QA: 'false' };
const operational = { VITE_LARGE_MASTER_SYNC_V3_CANDIDATE: 'true', CLIC_POS_SIGNED_V3_CANDIDATE: 'true' };
const run = (extra: Record<string, string | undefined>) => spawnSync('bash', ['-c',
  `set -eu\n${policy}\n${naming}\nprintf '%s|%s|%s' "$ARTIFACT_VERSION_NAME" "$NONPROMOTABLE" "$CLIC_POS_RELEASE_PLAIN_VERSION_NAME"`],
{ encoding: 'utf8', env: { ...env, ...extra } });

test('plain naming is an explicit cosmetic opt-in; default V3 and V2 identities remain unchanged', () => {
  for (const [flags, expected] of [
    [{}, '1.1.492|false|false'],
    [operational, '1.1.492-v3-candidate|true|false'],
    [{ ...operational, CLIC_POS_RELEASE_PLAIN_VERSION_NAME: 'false' }, '1.1.492-v3-candidate|true|false'],
    [{ ...operational, CLIC_POS_RELEASE_PLAIN_VERSION_NAME: 'true' }, '1.1.492|true|true'],
    [{ VITE_LARGE_MASTER_SYNC_V3_CANARY: 'true', CLIC_POS_SIGNED_V3_CANARY: 'true' }, '1.1.492-canary|true|false'],
  ] as const) {
    const result = run(flags);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, expected);
  }
});

test('plain name fails closed before worktree, version and Gradle mutations for invalid or incompatible flags', () => {
  for (const flags of [
    ...['', 'yes', '1', 'TRUE'].map(value => ({ ...operational, CLIC_POS_RELEASE_PLAIN_VERSION_NAME: value })),
    { CLIC_POS_RELEASE_PLAIN_VERSION_NAME: 'true' },
    { ...operational, CLIC_POS_RELEASE_PLAIN_VERSION_NAME: 'true', CLIC_POS_SIGNED_V3_CANDIDATE: 'false' },
    { ...operational, CLIC_POS_RELEASE_PLAIN_VERSION_NAME: 'true', VITE_LARGE_MASTER_SYNC_V3_CANARY: 'true', CLIC_POS_SIGNED_V3_CANARY: 'true' },
    ...['CLIC_POS_DIAGNOSTICS', 'CLIC_POS_WEBVIEW_PROFILE', 'CLIC_POS_TABLE_LATENCY_QA'].map(flag =>
      ({ ...operational, CLIC_POS_RELEASE_PLAIN_VERSION_NAME: 'true', [flag]: 'true' })),
    { ...operational, CLIC_POS_RELEASE_PLAIN_VERSION_NAME: 'true', VITE_LARGE_MASTER_SYNC_V3_BASE_URL: '' },
  ]) assert.equal(run(flags).status, 1, JSON.stringify(flags));
  const validation = script.indexOf('[[ "${PLAIN_VERSION_NAME}" == "true" ||');
  for (const mutation of ['git -C "${CANONICAL_BUILD_WORKTREE}" checkout', 'update_gradle_version "', 'sync_release_artifacts "', './gradlew assembleRelease']) {
    assert.ok(validation < script.indexOf(mutation), mutation);
  }
  assert.match(gradle, /'CLIC_POS_RELEASE_PLAIN_VERSION_NAME'\]\.each/);
  assert.match(gradle, /if \(plainVersionName && !v3Candidate\)/);
  assert.match(gradle, /v3Candidate && signedV3CandidateOptIn && !plainVersionName\) versionNameSuffix '-v3-candidate'/);
});

test('plain Android metadata records real V3 authority and remains rejected by promotion', () => {
  const start = script.indexOf("import fs from 'node:fs';", script.indexOf('# Preserve actual Gradle identity'));
  const producer = script.slice(start, script.indexOf('\nNODE', start)).replace("import fs from 'node:fs';",
    `const fs = {readFileSync:()=>'{"elements":[{"versionName":"1.1.492"}]}',writeFileSync:(_file,value)=>console.log(value)};`);
  const result = spawnSync(process.execPath, ['--input-type=module', '-', '/metadata', 'source-sha'], {
    input: producer, encoding: 'utf8', env: { ...env, ...operational, CLIC_POS_RELEASE_PLAIN_VERSION_NAME: 'true' },
  });
  assert.equal(result.status, 0, result.stderr);
  const metadata = JSON.parse(result.stdout);
  assert.equal(metadata.elements[0].versionName, '1.1.492');
  assert.equal(metadata.plainVersionName, true);
  assert.equal(metadata.operationalV3Candidate, true);
  assert.equal(metadata.signedV3CandidateOptIn, true);
  assert.equal(metadata.nonpromotable, true);
  assert.equal(metadata.salesEnabled, true);
  assert.equal(metadata.buildMode, 'operational-v3-candidate');
  assert.equal(metadata.downloadOrigin, env.VITE_LARGE_MASTER_SYNC_V3_BASE_URL);
  assert.throws(() => validatePromotionEvidence({}, { schemaVersion: 1, ...metadata }), /no promovible/);
  assert.match(script, /plainVersionName=\$\{PLAIN_VERSION_NAME\}/);
  assert.match(script, /promotionGatePassed=false/);
});
