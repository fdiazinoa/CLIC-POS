#!/usr/bin/env node
// Tooling de procedimiento: nunca importa ni modifica código/DB funcional.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
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
  const critical = forceCritical || (changed && !procedureOnly);
  const modules = new Set();
  const patterns = {
    sales: /App\.tsx|POSInterface|transactionService|cart|promotion|tax/i,
    payments: /Payment|payment|credit|currency/i,
    tables: /Table|table|mesas|restaurant/i,
    tickets: /Ticket|ticket|ClosedTransaction/i,
    sync: /sync|masterOperational|terminalIdentity|Credential|deviceToken|erpSync/i,
    offline: /offline|recovery|db\/|utils\/db\.ts|storage/i,
    auth: /auth|Login|Activation|setup|Permission|terminal/i,
    device: /^(android\/|native-stubs\/)|WebView|capacitor/i,
    printing: /print|Printer|receipt|CustomerDisplay/i,
    z: /ZReport|zReport|closePreparation|NativeZ/i,
  };
  for (const file of files) for (const [name, regex] of Object.entries(patterns)) if (regex.test(file)) modules.add(name);
  if (critical) {
    // App/config/imports o ruta nueva pueden afectar cualquier consumidor.
    // Se conserva suite transversal anterior; metadata de módulos no reduce cobertura.
    if (!modules.size || files.some(f => /^(App\.tsx|types\.ts|constants\.ts|package|vite|services\/db|utils\/db)/.test(f))) modules.add('shared');
    modules.add('sync'); modules.add('offline');
  } else if (procedureOnly) modules.add('procedure');
  const governance = files.some(f => /^(AGENTS\.md|WORKFLOW\.md|\.codex\/)/.test(f));
  const criticalPath = files.some(f => /^(App\.tsx|types\.ts|constants\.ts|package|services\/(db|sync|payments)|server\/)|auth|Payment|transaction|storage/i.test(f));
  const isolatedAsset = files.length > 0 && files.every(f => f === 'public/favicon.png');
  const riskLevel = forceCritical || criticalPath ? 'CRITICAL' : procedureOnly ? (governance ? 'HIGH' : 'LOW') : isolatedAsset ? 'MEDIUM' : 'HIGH';
  const required = changed || forceCritical ? ['analysis', 'plan', 'review', 'qa'] : [];
  if (critical) required.push('functional', 'regression', 'sync', 'offline', 'performance');
  if (modules.has('device')) required.push('device');
  const testFiles = critical ? [...new Set(Object.values(groups).flat())].map(f => `tests/${f}.test.ts`) : [];
  if (modules.has('device')) testFiles.push('tests/androidMasterRestaurantContract.test.ts', 'tests/androidBackgroundSessionResume.test.ts');
  return { changed, procedureOnly, critical, riskLevel, affectedModules: [...modules], requiredGates: required,
    agents: ['orchestrator','analyst','developer','reviewer','qa', ...(critical ? ['sync-validator','performance'] : [])],
    checklists: critical ? ['functional','regression','sales','payments','tables','tickets','sync','offline','performance','release'] : ['regression','release'], testFiles };
}
export function safeOutput(file) {
  const absolute = path.resolve(file);
  let ancestor = absolute;
  const tail = [];
  const entryExists = file => {
    try { fs.lstatSync(file); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  };
  while (!entryExists(ancestor)) {
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
  const result = { mode: argv.shift() || 'help', base: 'origin/develop', candidate: 'HEAD', evidence: null, out: null, critical: false, stage: 'code' };
  while (argv.length) {
    const key = argv.shift();
    if (key === '--critical') result.critical = true;
    else if (['--base', '--candidate', '--evidence', '--out', '--stage'].includes(key)) {
      const value = argv.shift();
      if (!value || value.startsWith('--')) throw new Error(`Valor ausente: ${key}`);
      result[key.slice(2)] = value;
    } else throw new Error(`Argumento desconocido: ${key}`);
  }
  return result;
}
const requireValue = (ok, message) => { if (!ok) throw new Error(message); };
export const ARTIFACT_FIELDS = ['application','filename','versionName','versionCode','commitSha','buildId','buildDate','sizeBytes','sha256','certificateSha256','packageName','buildType','instrumented','diagnostic','temporary'];
export function inspectArtifact(artifact) {
  const stat = fs.statSync(artifact.localPath);
  requireValue(stat.isFile(), 'APK local no es archivo');
  const sha256 = createHash('sha256').update(fs.readFileSync(artifact.localPath)).digest('hex');
  return { sizeBytes: stat.size, sha256 };
}
export function validateEvidence(plan, evidence, exists = fs.existsSync, stage = 'code', inspect = inspectArtifact) {
  const stages = ['code','internal','deployment','testing','production','released'];
  const index = stages.indexOf(stage);
  requireValue(index >= 0, 'Etapa inválida');
  requireValue(evidence.schemaVersion === 2 || (evidence.schemaVersion === 1 && index === 0), 'schema2 obligatorio después de code');
  requireValue(typeof evidence.taskId === 'string' && evidence.taskId.trim(), 'Falta taskId');
  requireValue(evidence.baseSha === plan.baseSha && evidence.candidateSha === plan.candidateSha, 'Evidencia obsoleta: base/candidate SHA distintos');
  const authors = evidence.implementationAuthors;
  requireValue(Array.isArray(authors) && authors.length && authors.every(x => typeof x === 'string' && x.trim()), 'Faltan implementationAuthors reales');
  const expectedRoles = { analysis:'analyst',plan:'plan-approver',review:'reviewer',qa:'qa',performance:'performance',sync:evidence.schemaVersion === 1 ? 'qa' : 'sync-validator',build:'release',internalApproval:'orchestrator',internalDeployment:'internal-deploy',internalTesting:'qa',productionApproval:'release',productionRelease:'release' };
  const gates = new Set(plan.requiredGates);
  for (const [name, gate] of Object.entries(evidence.gates || {})) {
    requireValue(!['FAIL','FAILED','BLOCKED'].includes(gate?.status), `Gate ejecutado ${name} fallido/bloqueado: no ocultar gates adicionales`);
  }
  for (const extra of evidence.additionalRequiredGates || []) {
    requireValue(['functional','regression','sync','offline','performance','device'].includes(extra), `Gate adicional desconocido: ${extra}`); gates.add(extra);
  }
  const later = ['build','internalApproval','internalDeployment','internalTesting','productionApproval','productionRelease'];
  if (index) for (const name of later.slice(0,index + 1)) gates.add(name);
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
  const independent = ['review','qa','performance', ...(evidence.schemaVersion === 2 ? ['sync'] : [])];
  for (const left of independent) for (const right of independent) if (left !== right && gates.has(left) && gates.has(right)) requireValue(evidence.gates[left].agentId !== evidence.gates[right].agentId, `${left}/${right} necesitan sesiones distintas`);
  if (index) {
    const apk = evidence.approvedArtifact;
    requireValue(apk && ARTIFACT_FIELDS.every(f => apk[f] !== undefined && apk[f] !== null), 'Manifest APK incompleto');
    requireValue(apk.application === 'CLIC-POS' && apk.packageName === 'com.clicpos.app' && apk.commitSha === plan.candidateSha, 'APK aplicación/package/commit discrepantes');
    requireValue(apk.buildType === 'release' && apk.instrumented === false && apk.diagnostic === false && apk.temporary === false, 'APK no release limpio');
    requireValue(typeof apk.versionName === 'string' && apk.versionName.trim() && Number.isSafeInteger(apk.versionCode) && apk.versionCode > 0, 'Versión APK inválida');
    requireValue(typeof apk.filename === 'string' && path.basename(apk.filename) === apk.filename && apk.filename.endsWith('.apk'), 'Nombre APK inválido');
    requireValue(typeof apk.buildId === 'string' && apk.buildId.trim() && Number.isFinite(Date.parse(apk.buildDate)), 'Falta identidad build/fecha');
    requireValue(Number.isSafeInteger(apk.sizeBytes) && apk.sizeBytes > 0 && /^[a-f0-9]{64}$/i.test(apk.sha256) && /^[a-f0-9]{64}$/i.test(apk.certificateSha256), 'Hash/size/certificado inválidos');
    requireValue(typeof apk.localPath === 'string' && path.basename(apk.localPath) === apk.filename, 'Ruta local no corresponde al APK exacto');
    const actual = inspect(apk);
    requireValue(actual.sizeBytes === apk.sizeBytes && actual.sha256.toLowerCase() === apk.sha256.toLowerCase(), 'Bytes APK no coinciden con manifest aprobado');
    for (const name of later.filter(n => gates.has(n))) requireValue(ARTIFACT_FIELDS.every(f => evidence.gates[name].artifact?.[f] === apk[f]), `Artefacto discrepante en ${name}`);
    requireValue(evidence.gates.build.agentId !== evidence.gates.internalApproval.agentId, 'Orchestrator no aprueba su propia build');
  }
  if (index >= 2) {
    const deploy = evidence.gates.internalDeployment;
    requireValue(deploy.agentId !== evidence.gates.internalApproval.agentId && deploy.agentId !== evidence.gates.build.agentId, 'Deploy no puede aprobar gate/build propios');
    requireValue(deploy.environment === 'INTERNAL_TESTING' && deploy.releaseStatus === 'internal_testing', 'Deploy interno no puede publicar available/producción');
    const steps = ['IDENTIFY','VALIDATE','INSPECT_CURRENT','UPLOAD_NEW','VERIFY_STORAGE','PUBLISH_INTERNAL','VERIFY_DOWNLOAD','CLEANUP'];
    requireValue(Array.isArray(deploy.steps) && deploy.steps.length === steps.length && deploy.steps.every((s,i) => s.name === steps[i] && (s.status === 'PASS' || (s.name === 'CLEANUP' && s.status === 'RETAINED'))), 'Deployment incompleto/fuera de orden');
    requireValue(deploy.storage?.sha256 === evidence.approvedArtifact.sha256 && deploy.storage?.sizeBytes === evidence.approvedArtifact.sizeBytes && deploy.download?.sha256 === evidence.approvedArtifact.sha256 && deploy.download?.sizeBytes === evidence.approvedArtifact.sizeBytes, 'Storage/download no coinciden con APK');
    requireValue(typeof deploy.publishedReference === 'string' && deploy.publishedReference.trim() && deploy.previousInspected === true && deploy.previousRetainedUntilVerification === true, 'Falta referencia/inspección y retención anterior durante deploy');
  }
  if (index >= 3) requireValue(evidence.gates.internalTesting.agentId !== evidence.gates.internalDeployment.agentId && evidence.gates.internalTesting.agentId !== evidence.gates.build.agentId, 'Testing interno no valida su propio deploy/build');
  if (index >= 4) requireValue(evidence.gates.productionApproval.agentId !== evidence.gates.internalDeployment.agentId && evidence.gates.productionApproval.agentId !== evidence.gates.internalTesting.agentId && evidence.gates.productionApproval.agentId !== evidence.gates.build.agentId, 'Producción requiere aprobador independiente');
  if (index >= 5) requireValue(evidence.gates.productionRelease.agentId !== evidence.gates.productionApproval.agentId && evidence.gates.productionRelease.environment === 'PRODUCTION', 'Release no puede aprobar su propia publicación');
  if (index >= 5) {
    const published=evidence.gates.productionRelease;
    requireValue(typeof published.publishedReference === 'string' && published.publishedReference.trim() && published.download?.sha256 === evidence.approvedArtifact.sha256 && published.download?.sizeBytes === evidence.approvedArtifact.sizeBytes, 'Publicación/descarga de producción no verificadas');
  }
  return {status:'PASS',candidateSha:plan.candidateSha,requiredGates:[...gates],stage,
    state:['CODE_VALIDATED','APPROVED_FOR_INTERNAL_TESTING','INTERNAL_TESTING','INTERNAL_TESTING_PASSED','APPROVED_FOR_PRODUCTION','RELEASED'][index],
    approvedForInternalTesting:index >= 1, approvedForProduction:index >= 4, releaseEligible:false};
}
function main() {
  const args = options(process.argv.slice(2));
  if (args.mode === 'help') {
    console.log('plan|qa|verify --base REF --candidate REF [--critical] [--out FILE] [--evidence FILE] [--stage code|internal|deployment|testing|production|released]\nplan: clasifica diff committed. qa: ejecuta suites activadas, conserva log; no aprueba. verify: bloquea elegibilidad si falta gate/evidencia/independencia.');
    return;
  }
  requireValue(['plan', 'qa', 'verify'].includes(args.mode), 'Modo inválido');
  if (args.out) args.out = safeOutput(args.out);
  const baseSha = git('rev-parse', `${args.base}^{commit}`);
  const candidateSha = git('rev-parse', `${args.candidate}^{commit}`);
  requireValue(git('merge-base', baseSha, candidateSha) === baseSha, 'Candidate debe descender de base (usar base SHA congelado de develop)');
  const raw = execFileSync('git', ['diff', '--name-only', '-z', baseSha, candidateSha], { cwd: root, encoding: 'utf8' });
  const files = raw.split('\0').filter(Boolean);
  const plan = { schemaVersion: 2, baseSha, candidateSha, files, ...classify(files, args.critical) };
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
    if (evidence.approvedArtifact?.localPath) evidence.approvedArtifact.localPath = path.resolve(dir, evidence.approvedArtifact.localPath);
    output = validateEvidence(plan, evidence, artifact => { const file = path.resolve(dir, artifact); return fs.existsSync(file) && fs.statSync(file).isFile(); }, args.stage);
  }
  const json = JSON.stringify(output, null, 2);
  if (args.out) fs.writeFileSync(path.resolve(args.out), `${json}\n`);
  console.log(json);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`BLOCKED: ${error.message}`); process.exitCode = 1; }
}
