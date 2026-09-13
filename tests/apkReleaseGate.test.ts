import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parseArgs, validateBaseline, validatePromotionEvidence } from '../scripts/qa/apk-release-gate.mjs';

const sha = (value: string) => value.repeat(64).slice(0, 64);
const commit = (value: string) => value.repeat(40).slice(0, 40);

const baseline = validateBaseline({
  schemaVersion: 1,
  versionName: '1.1.363',
  versionCode: 1363,
  apkSourceCommit: commit('a'),
  requiredAncestorCommit: commit('b'),
  apkSha256: sha('c'),
  certificateSha256: sha('d'),
  requiredTopologies: ['standaloneMaster', 'masterClient', 'orderTaker'],
  requiredContracts: ['syncResponsive', 'usersDeduplicated'],
  requiredTestFiles: ['tests/example.test.ts'],
  runtimeBudgets: {
    anrCountMax: 0,
    crashCountMax: 0,
    unresolvedOutboxCountMax: 0,
    spontaneousMutationCountMax: 0,
    pendingDrainSecondsMax: 120,
    heartbeatAgeSecondsMax: 180,
    salesTablesNavigationP95MsMax: 500,
    idleTrafficWindowSecondsMin: 15,
    idleRxBytesMax: 10240,
    idleTxBytesMax: 10240,
  },
});

const validEvidence = () => ({
  schemaVersion: 1,
  sourceCommit: 'e'.repeat(40),
  versionName: '1.1.364',
  versionCode: 1364,
  apkSha256: sha('f'),
  certificateSha256: sha('d'),
  topologies: { standaloneMaster: true, masterClient: true, orderTaker: true },
  contracts: { syncResponsive: true, usersDeduplicated: true },
  metrics: {
    anrCount: 0,
    crashCount: 0,
    unresolvedOutboxCount: 0,
    spontaneousMutationCount: 0,
    pendingDrainSeconds: 30,
    heartbeatAgeSeconds: 60,
    salesTablesNavigationP95Ms: 250,
    idleTrafficWindowSeconds: 15,
    idleRxBytes: 2048,
    idleTxBytes: 2048,
  },
  devices: [{
    serial: '10.0.0.10:5555',
    role: 'MASTER',
    versionName: '1.1.364',
    versionCode: 1364,
    installedWithReplace: true,
    processStable: true,
  }],
});

const releaseScript = await readFile(new URL('../scripts/release-android.sh', import.meta.url), 'utf8');

test('accepts promotion evidence that preserves the golden baseline', () => {
  assert.equal(validatePromotionEvidence(baseline, validEvidence()), true);
});

test('rejects a certificate change', () => {
  const evidence = validEvidence();
  evidence.certificateSha256 = sha('1');
  assert.throws(() => validatePromotionEvidence(baseline, evidence), /certificado/);
});

test('rejects missing functional contracts', () => {
  const evidence = validEvidence();
  evidence.contracts.usersDeduplicated = false;
  assert.throws(() => validatePromotionEvidence(baseline, evidence), /usersDeduplicated/);
});

test('rejects runtime metrics outside the approved budget', () => {
  const evidence = validEvidence();
  evidence.metrics.heartbeatAgeSeconds = 181;
  assert.throws(() => validatePromotionEvidence(baseline, evidence), /heartbeatAgeSeconds/);
});

test('the canonical release invokes the prebuild gate before changing the version', () => {
  const invocation = releaseScript.indexOf('node scripts/qa/apk-release-gate.mjs');
  const versionChange = releaseScript.indexOf('update_gradle_version "${BUILD_GRADLE_FILE}"');
  assert.ok(invocation > 0, 'canonical release must invoke the gate');
  assert.ok(versionChange > invocation, 'gate must run before version mutation');
  assert.match(releaseScript, /releaseGatePrebuildPassed=true/);
  assert.match(releaseScript, /promotionGatePassed=false/);
});

test('promotion evidence always produces a durable report path', () => {
  const options = parseArgs(['--stage', 'promote', '--evidence', '/tmp/release-evidence.json']);
  assert.equal(options.report, '/tmp/release-evidence.json.promotion-report.json');
});
