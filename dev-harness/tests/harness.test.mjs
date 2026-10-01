import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { verifyApkSignature } from '../core/apk.mjs';
import { redact, writeEvidence } from '../core/evidence.mjs';
import { recordGate, verifyInternalRelease } from '../core/gates.mjs';
import { assessRisk } from '../core/risk.mjs';
import { createTask, loadTask, reassessTask, saveTask, transitionTask } from '../core/task-state.mjs';

const config = {
  gate_order: ['BUILD_GATE', 'REVIEW_GATE', 'QA_GATE', 'SYNC_GATE'],
  impact_matrix: [
    { module: 'docs', risk: 'LOW', patterns: ['^docs/'], gates: ['BUILD_GATE', 'REVIEW_GATE', 'QA_GATE'] },
    { module: 'sync', risk: 'HIGH', patterns: ['sync|outbox'], gates: ['BUILD_GATE', 'REVIEW_GATE', 'QA_GATE', 'SYNC_GATE'] }
  ]
};

async function tempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clic-harness-'));
  await mkdir(path.join(root, 'dev-harness/tasks'), { recursive: true });
  return root;
}

async function evidenceFile(root, name = 'evidence.json') {
  await writeFile(path.join(root, name), '{}\n');
  return name;
}

test('risk engine prevents sync changes from being LOW', () => {
  const result = assessRisk(['services/sync/SyncManager.ts'], config);
  assert.equal(result.risk, 'HIGH');
  assert.deepEqual(result.required_gates, ['BUILD_GATE', 'REVIEW_GATE', 'QA_GATE', 'SYNC_GATE']);
});

test('unknown and empty file sets default to MEDIUM', () => {
  for (const files of [[], ['new/unknown.ts']]) {
    const result = assessRisk(files, config);
    assert.equal(result.risk, 'MEDIUM');
    assert.deepEqual(result.required_gates, ['BUILD_GATE', 'REVIEW_GATE', 'QA_GATE']);
  }
});

test('mixed file sets retain an unclassified impact', () => {
  const result = assessRisk(['docs/a.md', 'server/unknown.mjs'], config);
  assert.deepEqual(result.affected_modules, ['docs', 'unclassified']);
  assert.deepEqual(result.impacts[1].files, ['server/unknown.mjs']);
});

test('an unclassified file never downgrades a classified HIGH risk', () => {
  const result = assessRisk(['services/sync/SyncManager.ts', 'unknown/file.xyz'], config);
  assert.equal(result.risk, 'HIGH');
});

test('state machine rejects illegal transitions', async () => {
  const root = await tempRoot();
  const task = await createTask(root, { title: 'test', base_commit: 'abc', branch: 'feature/test' });
  await assert.rejects(() => transitionTask(root, task.task_id, 'RELEASED', 'orchestrator'), /Illegal transition/);
});

test('state machine cannot skip the gate owned by the current phase', async () => {
  const root = await tempRoot();
  const task = await createTask(root, { title: 'test', base_commit: 'abc', branch: 'feature/test' });
  task.status = 'REVIEWING';
  task.required_gates = ['REVIEW_GATE', 'QA_GATE'];
  await saveTask(root, task);
  await assert.rejects(
    () => transitionTask(root, task.task_id, 'QA', 'orchestrator'),
    /REVIEW_GATE is incomplete/
  );
  const current = await loadTask(root, task.task_id);
  current.gates.REVIEW_GATE = { result: 'PASS' };
  await saveTask(root, current);
  const qa = await transitionTask(root, task.task_id, 'QA', 'orchestrator');
  assert.equal(qa.status, 'QA');
  await assert.rejects(
    () => transitionTask(root, task.task_id, 'SYNC_VALIDATION', 'orchestrator'),
    /QA_GATE is incomplete/
  );
});

test('state machine forces every required domain gate in order', async () => {
  const root = await tempRoot();
  const task = await createTask(root, { title: 'test', base_commit: 'abc', branch: 'feature/test' });
  task.status = 'QA';
  task.required_gates = ['BUILD_GATE', 'REVIEW_GATE', 'QA_GATE', 'SYNC_GATE', 'OFFLINE_GATE', 'PERFORMANCE_GATE'];
  task.gates = { REVIEW_GATE: { result: 'PASS' }, QA_GATE: { result: 'PASS' }, BUILD_GATE: { result: 'PASS' } };
  await saveTask(root, task);
  await assert.rejects(
    () => transitionTask(root, task.task_id, 'PERFORMANCE', 'orchestrator'),
    /next state must be SYNC_VALIDATION/
  );
  const sync = await transitionTask(root, task.task_id, 'SYNC_VALIDATION', 'orchestrator');
  sync.gates.SYNC_GATE = { result: 'PASS' };
  await saveTask(root, sync);
  await assert.rejects(
    () => transitionTask(root, task.task_id, 'PERFORMANCE', 'orchestrator'),
    /next state must be OFFLINE_VALIDATION/
  );
});

async function selfApprovalFixture(result) {
  const root = await tempRoot();
  const task = await createTask(root, { title: 'test', base_commit: 'abc', branch: 'feature/test' });
  task.status = 'REVIEWING';
  task.implementation = { actor: 'agent-dev' };
  task.candidate_commit = 'def';
  task.agent_assignments.REVIEWER = 'agent-dev';
  task.required_gates = ['REVIEW_GATE'];
  await saveTask(root, task);
  const evidence = await evidenceFile(root, 'review.json');
  return assert.rejects(() => recordGate(root, task.task_id, {
    gate: 'REVIEW_GATE', result, actor: 'agent-dev', role: 'REVIEWER', evidence: [evidence], allowed_roles: ['REVIEWER']
  }), result === 'NOT_REQUIRED' ? /requires PASS/ : /cannot approve their own work/);
}

test('implementer cannot PASS their own review', () => selfApprovalFixture('PASS'));
test('implementer cannot mark their own review NOT_REQUIRED', () => selfApprovalFixture('NOT_REQUIRED'));

test('release check fails closed on failed gates', () => {
  const result = verifyInternalRelease({
    status: 'BUILDING', required_gates: ['REVIEW_GATE', 'QA_GATE'],
    gates: { REVIEW_GATE: { result: 'PASS' }, QA_GATE: { result: 'BLOCKED' } }
  });
  assert.equal(result.pass, false);
  assert.deepEqual(result.failing, [{ gate: 'QA_GATE', result: 'BLOCKED' }]);
});

test('evidence redacts structured and embedded secret formats', async () => {
  const value = redact({
    token: 'visible',
    text: 'Authorization: Basic dXNlcjpwYXNz ghp_abcdefghijklmnop eyJabc.def.ghi GITHUB_TOKEN=secretvalue'
  });
  assert.equal(value.token, '[REDACTED]');
  assert.doesNotMatch(value.text, /dXNlcjpwYXNz|ghp_|eyJabc|secretvalue/);
  const root = await tempRoot();
  const file = await writeEvidence(root, 'POS-2026-0001', 'qa', { password: 'never-store-this' });
  assert.match(file, /^dev-harness\/evidence\/POS-2026-0001\/qa\//);
});

test('concurrent evidence writes always get unique immutable paths', async () => {
  const root = await tempRoot();
  const paths = await Promise.all(Array.from({ length: 100 }, (_, index) =>
    writeEvidence(root, 'POS-2026-0001', 'qa', { index })
  ));
  assert.equal(new Set(paths).size, 100);
});

test('APK signature verification fails for missing APK or non-verifier command', async () => {
  assert.equal(verifyApkSignature('/definitely/missing.apk', '/usr/bin/true').verified, false);
  const root = await tempRoot();
  const fakeApk = path.join(root, 'fake.apk');
  await writeFile(fakeApk, 'PK-not-a-real-apk');
  assert.equal(verifyApkSignature(fakeApk, '/usr/bin/true').verified, false);
});

test('gate PASS requires assigned allowed role and existing evidence', async () => {
  const root = await tempRoot();
  const task = await createTask(root, { title: 'test', base_commit: 'abc', branch: 'feature/test' });
  task.status = 'REVIEWING';
  task.implementation = { actor: 'agent-dev' };
  task.candidate_commit = 'def';
  task.agent_assignments.QA = 'agent-qa';
  task.agent_assignments.REVIEWER = 'agent-review';
  task.required_gates = ['REVIEW_GATE'];
  await saveTask(root, task);
  const qaEvidence = await evidenceFile(root, 'qa.json');
  await assert.rejects(() => recordGate(root, task.task_id, {
    gate: 'REVIEW_GATE', result: 'PASS', actor: 'agent-qa', role: 'QA', evidence: [qaEvidence], allowed_roles: ['REVIEWER']
  }), /cannot approve REVIEW_GATE/);
  const reviewEvidence = await evidenceFile(root, 'review.json');
  const approved = await recordGate(root, task.task_id, {
    gate: 'REVIEW_GATE', result: 'PASS', actor: 'agent-review', role: 'REVIEWER', evidence: [reviewEvidence], allowed_roles: ['REVIEWER']
  });
  assert.equal(approved.gates.REVIEW_GATE.result, 'PASS');
  assert.equal((await loadTask(root, task.task_id)).gates.REVIEW_GATE.actor, 'agent-review');
});

test('strict release gates cannot be NOT_REQUIRED and evidence must exist', async () => {
  const root = await tempRoot();
  const task = await createTask(root, { title: 'test', base_commit: 'abc', branch: 'feature/test' });
  task.status = 'QA';
  task.candidate_commit = 'def';
  task.agent_assignments.QA = 'qa-1';
  task.required_gates = ['QA_GATE'];
  await saveTask(root, task);
  await assert.rejects(() => recordGate(root, task.task_id, {
    gate: 'QA_GATE', result: 'NOT_REQUIRED', actor: 'qa-1', role: 'QA', evidence: ['missing.json'], allowed_roles: ['QA']
  }), /requires PASS/);
  await assert.rejects(() => recordGate(root, task.task_id, {
    gate: 'QA_GATE', result: 'PASS', actor: 'qa-1', role: 'QA', evidence: ['missing.json'], allowed_roles: ['QA']
  }), /does not exist/);
});

test('internal testing approval requires every gate and signed APK', async () => {
  const root = await tempRoot();
  const task = await createTask(root, { title: 'test', base_commit: 'abc', branch: 'feature/test' });
  task.status = 'BUILDING';
  task.required_gates = ['BUILD_GATE', 'REVIEW_GATE'];
  task.gates = { BUILD_GATE: { result: 'PASS' } };
  await saveTask(root, task);
  await assert.rejects(
    () => transitionTask(root, task.task_id, 'APPROVED_FOR_INTERNAL_TESTING', 'orchestrator'),
    /incomplete gates: REVIEW_GATE/
  );
});

test('internal testing approval rejects complete gates without a signed APK', async () => {
  const root = await tempRoot();
  const task = await createTask(root, { title: 'test', base_commit: 'abc', branch: 'feature/test' });
  task.status = 'BUILDING';
  task.candidate_commit = 'def';
  task.required_gates = ['BUILD_GATE', 'REVIEW_GATE', 'QA_GATE'];
  task.gates = {
    BUILD_GATE: { result: 'PASS' }, REVIEW_GATE: { result: 'PASS' }, QA_GATE: { result: 'PASS' }
  };
  await saveTask(root, task);
  await assert.rejects(
    () => transitionTask(root, task.task_id, 'APPROVED_FOR_INTERNAL_TESTING', 'orchestrator'),
    /signed, checksummed APK/
  );
});

test('reimplementation invalidates every previous gate without deleting evidence history', async () => {
  const root = await tempRoot();
  const task = await createTask(root, { title: 'test', base_commit: 'abc', branch: 'feature/test' });
  task.status = 'QA_FAILED';
  task.gates = { REVIEW_GATE: { result: 'PASS' }, QA_GATE: { result: 'FAIL' } };
  task.evidence = ['old-review.json', 'old-qa.json'];
  await saveTask(root, task);
  const updated = await transitionTask(root, task.task_id, 'IMPLEMENTING', 'orchestrator');
  assert.deepEqual(updated.gates, {});
  assert.deepEqual(updated.evidence, ['old-review.json', 'old-qa.json']);
  assert.equal(updated.history.at(-2).event, 'GATES_INVALIDATED_FOR_REIMPLEMENTATION');
});

test('retry exhaustion replaces an old PASS with BLOCKED', async () => {
  const root = await tempRoot();
  const task = await createTask(root, { title: 'test', base_commit: 'abc', branch: 'feature/test' });
  task.status = 'QA';
  task.candidate_commit = 'def';
  task.agent_assignments.QA = 'qa-1';
  task.required_gates = ['QA_GATE'];
  task.gates = { QA_GATE: { result: 'PASS' } };
  await saveTask(root, task);
  const evidence = await evidenceFile(root, 'qa-fail.json');
  for (let attempt = 1; attempt < 3; attempt += 1) {
    const failed = await recordGate(root, task.task_id, {
      gate: 'QA_GATE', result: 'FAIL', actor: 'qa-1', role: 'QA', evidence: [evidence], allowed_roles: ['QA'], max_attempts: 3
    });
    assert.equal(failed.gates.QA_GATE.result, 'FAIL');
    failed.status = 'QA'; // Fixture simulates completed reimplementation/review before the next QA attempt.
    await saveTask(root, failed);
  }
  const blocked = await recordGate(root, task.task_id, {
    gate: 'QA_GATE', result: 'FAIL', actor: 'qa-1', role: 'QA', evidence: [evidence], allowed_roles: ['QA'], max_attempts: 3
  });
  assert.equal(blocked.status, 'BLOCKED');
  assert.equal(blocked.gates.QA_GATE.result, 'BLOCKED');
  assert.equal(verifyInternalRelease(blocked).pass, false);
});

test('concurrent task creation reserves unique ids', async () => {
  const root = await tempRoot();
  const tasks = await Promise.all(Array.from({ length: 20 }, (_, index) => createTask(root, {
    title: `task-${index}`, base_commit: 'abc', branch: 'feature/test'
  })));
  assert.equal(new Set(tasks.map((task) => task.task_id)).size, 20);
});

test('release check rejects strict NOT_REQUIRED gates and ineligible state', () => {
  const result = verifyInternalRelease({
    status: 'NEW', required_gates: ['BUILD_GATE', 'REVIEW_GATE', 'QA_GATE'],
    gates: {
      BUILD_GATE: { result: 'NOT_REQUIRED' }, REVIEW_GATE: { result: 'NOT_REQUIRED' }, QA_GATE: { result: 'NOT_REQUIRED' }
    }
  });
  assert.equal(result.pass, false);
  assert.equal(result.failing.length, 3);
  assert.match(result.state_error, /not release-eligible/);
});

test('non-release tasks can complete only after strict core gates pass', async () => {
  const root = await tempRoot();
  const task = await createTask(root, { title: 'test', base_commit: 'abc', branch: 'feature/test' });
  task.status = 'QA';
  task.required_gates = ['BUILD_GATE', 'REVIEW_GATE', 'QA_GATE'];
  task.gates = {
    BUILD_GATE: { result: 'PASS' }, REVIEW_GATE: { result: 'PASS' }, QA_GATE: { result: 'PASS' }
  };
  await saveTask(root, task);
  const completed = await transitionTask(root, task.task_id, 'COMPLETED', 'orchestrator');
  assert.equal(completed.status, 'COMPLETED');
});

test('risk reassessment updates the auditable affected-file scope', async () => {
  const root = await tempRoot();
  const task = await createTask(root, {
    title: 'test', base_commit: 'abc', branch: 'feature/test', affected_files: ['docs/old.md']
  });
  task.status = 'IMPLEMENTING';
  task.gates = { REVIEW_GATE: { result: 'PASS' } };
  await saveTask(root, task);
  const evidence = await evidenceFile(root, 'reassess.json');
  const assessment = assessRisk(['services/sync/SyncManager.ts'], config);
  const updated = await reassessTask(root, task.task_id, 'orchestrator', assessment, evidence);
  assert.deepEqual(updated.affected_files, ['services/sync/SyncManager.ts']);
  assert.equal(updated.risk, 'HIGH');
  assert.deepEqual(updated.gates, {});
  assert.deepEqual(updated.history.at(-1).previous.affected_files, ['docs/old.md']);
  assert.deepEqual(updated.history.at(-1).invalidated_gates, ['REVIEW_GATE']);
});
