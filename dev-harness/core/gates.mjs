import { APPROVAL_GATES, GATE_RESULTS } from './constants.mjs';
import { validateEvidenceFiles } from './evidence.mjs';
import { now } from './io.mjs';
import { loadTask, saveTask } from './task-state.mjs';

const FAILURE_STATUS = {
  REVIEW_GATE: 'REVIEW_FAILED',
  QA_GATE: 'QA_FAILED',
  SYNC_GATE: 'SYNC_FAILED',
  PERFORMANCE_GATE: 'PERFORMANCE_FAILED',
  BUILD_GATE: 'BUILD_FAILED',
  OFFLINE_GATE: 'BLOCKED',
  INTERNAL_RELEASE_GATE: 'BLOCKED'
};

const STRICT_PASS_GATES = new Set(['BUILD_GATE', 'REVIEW_GATE', 'QA_GATE', 'INTERNAL_RELEASE_GATE']);

export async function recordGate(root, taskId, input) {
  if (!GATE_RESULTS.includes(input.result)) throw new Error(`Invalid gate result: ${input.result}`);
  const task = await loadTask(root, taskId);
  if (!task.required_gates.includes(input.gate)) throw new Error(`${input.gate} is not required for ${taskId}`);
  if (!input.actor || !input.role) throw new Error('Gate actor and role are required');
  if (task.agent_assignments?.[input.role] !== input.actor) {
    throw new Error(`${input.actor} is not the assigned ${input.role}`);
  }
  if (['PASS', 'NOT_REQUIRED'].includes(input.result) && !task.candidate_commit) {
    throw new Error('Cannot approve a gate before the candidate commit is sealed');
  }
  if (input.result === 'NOT_REQUIRED' && STRICT_PASS_GATES.has(input.gate)) {
    throw new Error(`${input.gate} requires PASS and cannot be NOT_REQUIRED`);
  }
  if (['PASS', 'NOT_REQUIRED'].includes(input.result) && APPROVAL_GATES.has(input.gate)) {
    if (task.implementation?.actor && task.implementation.actor === input.actor) {
      throw new Error('An implementer cannot approve their own work');
    }
    const allowedRoles = input.allowed_roles || [];
    if (allowedRoles.length > 0 && !allowedRoles.includes(input.role)) {
      throw new Error(`${input.role} cannot approve ${input.gate}`);
    }
  }
  if (!input.evidence || input.evidence.length === 0) throw new Error('A gate result requires evidence');
  await validateEvidenceFiles(root, input.evidence);

  const attempt = (task.gate_attempts?.[input.gate] || 0) + 1;
  task.gate_attempts ||= {};
  task.gate_attempts[input.gate] = attempt;
  const failureCount = (task.retries[input.gate] || 0) + (input.result === 'FAIL' ? 1 : 0);
  if (input.result === 'FAIL' && Number.isFinite(input.max_attempts) && failureCount > input.max_attempts) {
    task.status = 'BLOCKED';
    task.retries[input.gate] = failureCount;
    task.gates[input.gate] = {
      result: 'BLOCKED', actor: input.actor, role: input.role, evidence: input.evidence,
      attempt, recorded_at: now(), reason: 'automatic retry limit exceeded'
    };
    task.evidence = [...new Set([...(task.evidence || []), ...input.evidence])];
    task.history.push({ at: now(), event: 'RETRY_LIMIT_EXCEEDED', gate: input.gate, actor: input.actor, attempt });
    return saveTask(root, task);
  }
  if (input.result === 'FAIL') task.retries[input.gate] = failureCount;
  task.gates[input.gate] = {
    result: input.result,
    actor: input.actor,
    role: input.role,
    evidence: input.evidence,
    attempt,
    recorded_at: now(),
    candidate_commit: task.candidate_commit
  };
  task.evidence = [...new Set([...(task.evidence || []), ...input.evidence])];
  if (input.result === 'FAIL' && FAILURE_STATUS[input.gate]) task.status = FAILURE_STATUS[input.gate];
  task.history.push({ at: now(), event: 'GATE_RECORDED', gate: input.gate, result: input.result, actor: input.actor, attempt });
  return saveTask(root, task);
}

export function verifyInternalRelease(task) {
  const missing = [];
  const failing = [];
  for (const gate of task.required_gates) {
    const result = task.gates[gate]?.result;
    if (!result) missing.push(gate);
    else if (STRICT_PASS_GATES.has(gate) ? result !== 'PASS' : !['PASS', 'NOT_REQUIRED'].includes(result)) failing.push({ gate, result });
  }
  const eligibleStatuses = new Set(['BUILDING', 'APPROVED_FOR_INTERNAL_TESTING', 'DEPLOYING_INTERNAL', 'INTERNAL_TESTING', 'INTERNAL_TESTING_PASSED', 'APPROVED_FOR_PRODUCTION', 'RELEASED']);
  const state_error = eligibleStatuses.has(task.status) ? null : `Task state ${task.status} is not release-eligible`;
  return { pass: missing.length === 0 && failing.length === 0 && !state_error, missing, failing, state_error };
}
