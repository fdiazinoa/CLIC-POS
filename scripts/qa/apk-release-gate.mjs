#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const defaultBaseline = path.join(repoRoot, 'qa/baselines/apk-1.1.363.json');

const fail = message => {
  throw new Error(message);
};

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    const detail = options.inherit ? '' : `\n${result.stderr || result.stdout || ''}`;
    fail(`${command} ${args.join(' ')} falló${detail}`);
  }
  return options.inherit ? '' : String(result.stdout || '').trim();
};

export function parseArgs(argv) {
  const options = {
    stage: 'prebuild',
    baseline: defaultBaseline,
    sourceCommit: 'HEAD',
    evidence: null,
    report: null,
    requireClean: false,
    runTests: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--stage') options.stage = argv[++index];
    else if (argument === '--baseline') options.baseline = path.resolve(repoRoot, argv[++index]);
    else if (argument === '--source-commit') options.sourceCommit = argv[++index];
    else if (argument === '--evidence') options.evidence = path.resolve(repoRoot, argv[++index]);
    else if (argument === '--report') options.report = path.resolve(repoRoot, argv[++index]);
    else if (argument === '--require-clean') options.requireClean = true;
    else if (argument === '--skip-tests') options.runTests = false;
    else fail(`Argumento desconocido: ${argument}`);
  }
  if (!['prebuild', 'promote'].includes(options.stage)) fail(`Etapa inválida: ${options.stage}`);
  if (options.stage === 'promote' && !options.evidence) fail('La etapa promote requiere --evidence');
  if (options.stage === 'promote' && !options.report) options.report = `${options.evidence}.promotion-report.json`;
  return options;
}

export function loadJson(file, label) {
  if (!fs.existsSync(file)) fail(`${label} no existe: ${file}`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${label} no contiene JSON válido: ${error.message}`);
  }
}

export function validateBaseline(baseline) {
  if (baseline?.schemaVersion !== 1) fail('La baseline debe usar schemaVersion 1');
  if (!/^\d+\.\d+\.\d+$/.test(baseline.versionName || '')) fail('versionName inválido en baseline');
  if (!Number.isSafeInteger(baseline.versionCode) || baseline.versionCode < 1) fail('versionCode inválido en baseline');
  for (const field of ['apkSourceCommit', 'requiredAncestorCommit']) {
    if (!/^[0-9a-f]{40}$/i.test(baseline[field] || '')) fail(`${field} inválido en baseline`);
  }
  for (const field of ['apkSha256', 'certificateSha256']) {
    if (!/^[0-9a-f]{64}$/i.test(baseline[field] || '')) fail(`${field} inválido en baseline`);
  }
  if (!Array.isArray(baseline.requiredTopologies) || baseline.requiredTopologies.length === 0) fail('Faltan topologías requeridas');
  if (!Array.isArray(baseline.requiredContracts) || baseline.requiredContracts.length === 0) fail('Faltan contratos requeridos');
  if (!Array.isArray(baseline.requiredTestFiles) || baseline.requiredTestFiles.length === 0) fail('Faltan pruebas requeridas');
  return baseline;
}

const numericRule = (metrics, budgets, metric, budget, compare) => {
  const value = metrics?.[metric];
  const limit = budgets?.[budget];
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`Métrica inválida o ausente: ${metric}`);
  if (typeof limit !== 'number' || !Number.isFinite(limit)) fail(`Presupuesto inválido: ${budget}`);
  if (!compare(value, limit)) fail(`${metric}=${value} incumple ${budget}=${limit}`);
};

export function validatePromotionEvidence(baseline, evidence) {
  if (evidence?.schemaVersion !== 1) fail('La evidencia debe usar schemaVersion 1');
  if (!/^[0-9a-f]{40}$/i.test(evidence.sourceCommit || '')) fail('sourceCommit debe ser un SHA completo');
  if (!/^\d+\.\d+\.\d+$/.test(evidence.versionName || '')) fail('versionName inválido en evidencia');
  if (!Number.isSafeInteger(evidence.versionCode) || evidence.versionCode < baseline.versionCode) {
    fail(`versionCode ${evidence.versionCode} es menor que la baseline ${baseline.versionCode}`);
  }
  for (const field of ['apkSha256', 'certificateSha256']) {
    if (!/^[0-9a-f]{64}$/i.test(evidence[field] || '')) fail(`${field} inválido en evidencia`);
  }
  if (evidence.certificateSha256.toLowerCase() !== baseline.certificateSha256.toLowerCase()) {
    fail('El certificado del APK no coincide con la baseline aprobada');
  }
  for (const topology of baseline.requiredTopologies) {
    if (evidence.topologies?.[topology] !== true) fail(`Topología no aprobada: ${topology}`);
  }
  for (const contract of baseline.requiredContracts) {
    if (evidence.contracts?.[contract] !== true) fail(`Contrato no aprobado: ${contract}`);
  }
  const budgets = baseline.runtimeBudgets;
  const metrics = evidence.metrics;
  for (const [metric, budget] of [
    ['anrCount', 'anrCountMax'],
    ['crashCount', 'crashCountMax'],
    ['unresolvedOutboxCount', 'unresolvedOutboxCountMax'],
    ['spontaneousMutationCount', 'spontaneousMutationCountMax'],
    ['pendingDrainSeconds', 'pendingDrainSecondsMax'],
    ['heartbeatAgeSeconds', 'heartbeatAgeSecondsMax'],
    ['salesTablesNavigationP95Ms', 'salesTablesNavigationP95MsMax'],
    ['idleRxBytes', 'idleRxBytesMax'],
    ['idleTxBytes', 'idleTxBytesMax'],
  ]) numericRule(metrics, budgets, metric, budget, (value, limit) => value <= limit);
  numericRule(metrics, budgets, 'idleTrafficWindowSeconds', 'idleTrafficWindowSecondsMin', (value, limit) => value >= limit);
  if (!Array.isArray(evidence.devices) || evidence.devices.length === 0) fail('La evidencia no contiene dispositivos');
  for (const device of evidence.devices) {
    if (!String(device.serial || '').trim() || !String(device.role || '').trim()) fail('Cada dispositivo requiere serial y role');
    if (device.installedWithReplace !== true || device.processStable !== true) {
      fail(`Dispositivo no aprobado: ${device.serial || 'sin serial'}`);
    }
    if (device.versionName !== evidence.versionName || device.versionCode !== evidence.versionCode) {
      fail(`Versión instalada inconsistente en ${device.serial}`);
    }
  }
  return true;
}

function validatePrebuild(baseline, options) {
  const resolvedCommit = run('git', ['rev-parse', '--verify', `${options.sourceCommit}^{commit}`]);
  run('git', ['merge-base', '--is-ancestor', baseline.requiredAncestorCommit, resolvedCommit]);
  if (options.requireClean) {
    const status = run('git', ['status', '--porcelain']);
    if (status) fail('La worktree fuente no está limpia');
  }
  const gradle = fs.readFileSync(path.join(repoRoot, 'android/app/build.gradle'), 'utf8');
  const versionCode = Number(gradle.match(/versionCode\s+(\d+)/)?.[1]);
  if (!Number.isSafeInteger(versionCode) || versionCode < baseline.versionCode) {
    fail(`versionCode fuente ${versionCode} es menor que la baseline ${baseline.versionCode}`);
  }
  for (const relative of baseline.requiredTestFiles) {
    if (!fs.existsSync(path.join(repoRoot, relative))) fail(`Falta prueba obligatoria: ${relative}`);
  }
  if (options.runTests) {
    run('npx', ['--no-install', 'tsx', '--test', ...baseline.requiredTestFiles], { inherit: true });
  }
  return { resolvedCommit, versionCode, testsExecuted: options.runTests ? baseline.requiredTestFiles : [] };
}

export function writeReport(file, report) {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const baseline = validateBaseline(loadJson(options.baseline, 'Baseline'));
  let detail;
  if (options.stage === 'prebuild') detail = validatePrebuild(baseline, options);
  else {
    const evidence = loadJson(options.evidence, 'Evidencia de promoción');
    validatePromotionEvidence(baseline, evidence);
    run('git', ['merge-base', '--is-ancestor', baseline.requiredAncestorCommit, evidence.sourceCommit]);
    detail = { sourceCommit: evidence.sourceCommit, versionCode: evidence.versionCode, evidence: options.evidence };
  }
  const report = {
    schemaVersion: 1,
    status: 'PASSED',
    stage: options.stage,
    checkedAt: new Date().toISOString(),
    baseline: { versionName: baseline.versionName, versionCode: baseline.versionCode, requiredAncestorCommit: baseline.requiredAncestorCommit },
    ...detail,
  };
  writeReport(options.report, report);
  console.log(`[apk-release-gate] PASSED (${options.stage})`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[apk-release-gate] FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}
