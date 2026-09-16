#!/usr/bin/env node
// Tooling de procedimiento: nunca importa ni modifica código/DB funcional.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const groups = {
  functional: ['cartQuantitySafety', 'itemTaxAuthority', 'paymentFractions', 'salePostedContract', 'paymentFractionPersistenceContract'],
  regression: ['closedTransactionMembership', 'terminalUpgradePersistence', 'posUserReconciliation'],
  tables: ['tableMove', 'tableMoveDestinationContract', 'tablePaymentClosureContract', 'emptyTableChargeRegression', 'joinedTableTicketPersistence', 'tableAccountModalLockContract', 'clientTableBatchSyncContract'],
  z: ['zReportPaymentSummary', 'zReportSequenceContinuity', 'zReportSyncRetry', 'closePreparation'],
  print: ['printOutputControl', 'printCopies', 'paymentDrawerPolicy', 'nativeLocalRegistryTransport'],
  auth: ['terminalAuthorizationGuard', 'activationTenantIdentity', 'terminalDeviceRequests', 'erpTerminalListing', 'deviceIdentityRecovery'],
  sync: ['durableOutboxV2', 'durableOutboxBatchSender', 'operationalAcknowledgement', 'realtimeNotificationScope', 'realtimePollingContract', 'adaptivePollingScheduler', 'erpHeartbeatScheduler', 'syncTriggerCoordinator', 'catalogMultiTerminalRoundTrip'],
  offline: ['backgroundSyncRecoveryContract', 'recoveryAtomicAdapters', 'handheldInventorySync', 'terminalUpgradePersistence'],
  performance: ['checkoutLatency', 'checkoutPerformanceDiagnostics', 'tableMapOpenPerformanceContract', 'tableMapCloseDiagnostics', 'syncMetrics'],
};
export function classify(files, forceCritical = false) {
  const changed = files.length > 0;
  const procedureOnly = changed && files.every(f => /^(docs\/|AGENTS\.md$|WORKFLOW\.md$|\.codex\/)/.test(f));
  // Todo cambio fuera del procedimiento es crítico por defecto para evitar
  // falsos negativos por contratos, eliminaciones, módulos nuevos o imports indirectos.
  const critical = forceCritical || (changed && !procedureOnly);
  const required = changed || forceCritical ? ['analysis', 'plan', 'review', 'qa'] : [];
  if (critical) required.push('functional', 'regression', 'sync', 'offline', 'performance');
  const testFiles = critical ? [...new Set(Object.values(groups).flat())].map(f => `tests/${f}.test.ts`) : [];
  return { changed, procedureOnly, critical, requiredGates: required, checklists: critical ? ['functional', 'regression', 'sync', 'offline', 'performance', 'release'] : ['regression', 'release'], testFiles };
}
export function safeOutput(file) {
  const absolute = path.resolve(file);
  let ancestor = absolute;
  const tail = [];
  while (!fs.existsSync(ancestor)) {
    tail.unshift(path.basename(ancestor));
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error('Destino no resoluble');
    ancestor = parent;
  }
  const resolved = path.join(fs.realpathSync(ancestor), ...tail);
  const realRoot = fs.realpathSync(root);
  const relative = path.relative(realRoot, resolved);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Salida debe estar fuera del repositorio para preservar código');
  return resolved;
}
function options(argv) {
  const result = { mode: argv.shift() || 'help', base: 'origin/develop', candidate: 'HEAD', evidence: null, out: null, critical: false };
  while (argv.length) {
    const key = argv.shift();
    if (key === '--critical') result.critical = true;
    else if (['--base', '--candidate', '--evidence', '--out'].includes(key)) {
      const value = argv.shift();
      if (!value || value.startsWith('--')) throw new Error(`Valor ausente: ${key}`);
      result[key.slice(2)] = value;
    } else throw new Error(`Argumento desconocido: ${key}`);
  }
  return result;
}
const requireValue = (ok, message) => { if (!ok) throw new Error(message); };
export function validateEvidence(plan, evidence, exists = fs.existsSync) {
  requireValue(evidence.schemaVersion === 1, 'schemaVersion debe ser 1');
  requireValue(typeof evidence.taskId === 'string' && evidence.taskId.trim(), 'Falta taskId');
  requireValue(evidence.baseSha === plan.baseSha && evidence.candidateSha === plan.candidateSha, 'Evidencia obsoleta: base/candidate SHA distintos');
  const authors = evidence.implementationAuthors;
  requireValue(Array.isArray(authors) && authors.length && authors.every(x => typeof x === 'string' && x.trim()), 'Faltan implementationAuthors reales');
  const expectedRoles = { analysis: 'analyst', plan: 'plan-approver', review: 'reviewer', qa: 'qa', performance: 'performance' };
  const gates = new Set(plan.requiredGates);
  // Ampliaciones del expediente son acumulativas; nunca se restan gates automáticos.
  for (const extra of evidence.additionalRequiredGates || []) {
    requireValue(['functional', 'regression', 'sync', 'offline', 'performance'].includes(extra), `Gate adicional desconocido: ${extra}`);
    gates.add(extra);
  }
  for (const name of gates) {
    const gate = evidence.gates?.[name];
    requireValue(gate?.status === 'PASS', `Gate ${name} no está PASS`);
    requireValue(gate.candidateSha === plan.candidateSha, `Gate ${name} pertenece a otro SHA`);
    requireValue(typeof gate.agentId === 'string' && gate.agentId.trim(), `Gate ${name} sin agentId`);
    requireValue(!authors.includes(gate.agentId), `Autoaprobación en ${name}`);
    requireValue(gate.role === (expectedRoles[name] || 'qa'), `Rol inválido en ${name}`);
    requireValue(Array.isArray(gate.artifacts) && gate.artifacts.length && gate.artifacts.every(x => typeof x === 'string' && exists(x)), `Falta evidencia local en ${name}`);
  }
  requireValue(evidence.gates?.analysis?.agentId !== evidence.gates?.plan?.agentId, 'Autor del plan no puede aprobarlo');
  for (const left of ['review', 'qa', 'performance']) for (const right of ['review', 'qa', 'performance']) {
    if (left !== right && gates.has(left) && gates.has(right)) requireValue(evidence.gates[left].agentId !== evidence.gates[right].agentId, `${left}/${right} necesitan sesiones distintas`);
  }
  return { status: 'PASS', candidateSha: plan.candidateSha, requiredGates: [...gates], releaseEligible: true };
}
function main() {
  const args = options(process.argv.slice(2));
  if (args.mode === 'help') {
    console.log('plan|qa|verify --base REF --candidate REF [--critical] [--out FILE] [--evidence FILE]\nplan: clasifica diff committed. qa: ejecuta suites activadas, conserva log; no aprueba. verify: bloquea elegibilidad si falta gate/evidencia/independencia.');
    return;
  }
  requireValue(['plan', 'qa', 'verify'].includes(args.mode), 'Modo inválido');
  if (args.out) args.out = safeOutput(args.out);
  const baseSha = git('rev-parse', `${args.base}^{commit}`);
  const candidateSha = git('rev-parse', `${args.candidate}^{commit}`);
  requireValue(git('merge-base', baseSha, candidateSha) === baseSha, 'Candidate debe descender de base (usar base SHA congelado de develop)');
  const raw = execFileSync('git', ['diff', '--name-only', '-z', baseSha, candidateSha], { cwd: root, encoding: 'utf8' });
  const files = raw.split('\0').filter(Boolean);
  const plan = { schemaVersion: 1, baseSha, candidateSha, files, ...classify(files, args.critical) };
  requireValue(plan.changed || args.critical, 'Diff vacío: congelar candidato con commit antes de gates');
  if (args.mode === 'qa') {
    requireValue(git('rev-parse', 'HEAD') === candidateSha, 'QA debe ejecutarse en checkout del candidato');
    requireValue(!git('status', '--porcelain', '--untracked-files=no'), 'QA requiere código versionado limpio');
    requireValue(args.out, 'QA requiere --out LOG externo al código versionado');
    const missing = plan.testFiles.filter(f => !fs.existsSync(path.join(root, f)));
    requireValue(!missing.length, `Tests ausentes: ${missing.join(', ')}`);
    let status = 0;
    let log = `${JSON.stringify(plan, null, 2)}\n`;
    if (plan.testFiles.length) {
      const executable = path.join(root, 'node_modules/.bin/tsx');
      requireValue(fs.existsSync(executable), 'Faltan dependencias: npm ci');
      const run = spawnSync(executable, ['--test', ...plan.testFiles], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
      log += `${run.stdout || ''}\n${run.stderr || ''}\n${run.error || ''}`;
      status = run.status ?? 1;
    } else log += 'Procedimiento documental: suites POS no aplican. QA debe verificar enlaces, roles, script y contratos del procedimiento de forma independiente.\n';
    fs.writeFileSync(path.resolve(args.out), log);
    console.log(JSON.stringify({ ...plan, testExecution: status === 0 ? 'COMPLETED' : 'FAILED', approved: false, log: path.resolve(args.out) }, null, 2));
    process.exitCode = status;
    return;
  }
  let output = plan;
  if (args.mode === 'verify') {
    requireValue(args.evidence, 'verify requiere --evidence');
    const evidence = JSON.parse(fs.readFileSync(path.resolve(args.evidence), 'utf8'));
    const dir = path.dirname(path.resolve(args.evidence));
    output = validateEvidence(plan, evidence, artifact => { const file = path.resolve(dir, artifact); return fs.existsSync(file) && fs.statSync(file).isFile(); });
  }
  const json = JSON.stringify(output, null, 2);
  if (args.out) fs.writeFileSync(path.resolve(args.out), `${json}\n`);
  console.log(json);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`BLOCKED: ${error.message}`); process.exitCode = 1; }
}
