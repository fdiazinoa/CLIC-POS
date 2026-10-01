import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { LEGAL_TRANSITIONS, TASK_STATUSES } from './constants.mjs';
import { validateEvidenceFiles } from './evidence.mjs';
import { assertSafeId, now, readJson, withFileLock, writeJsonAtomic } from './io.mjs';

export function taskFile(root, taskId) {
  return path.join(root, 'dev-harness/tasks', `${assertSafeId(taskId, 'task id')}.json`);
}

export async function nextTaskId(root, date = new Date()) {
  const year = date.getUTCFullYear();
  const directory = path.join(root, 'dev-harness/tasks');
  const entries = await readdir(directory).catch(() => []);
  const sequence = entries
    .map((name) => new RegExp(`^POS-${year}-(\\d{4})\\.json$`).exec(name))
    .filter(Boolean)
    .reduce((maximum, match) => Math.max(maximum, Number(match[1])), 0) + 1;
  return `POS-${year}-${String(sequence).padStart(4, '0')}`;
}

export async function createTask(root, input) {
  const directory = path.join(root, 'dev-harness/tasks');
  return withFileLock(path.join(directory, '.task-id.lock'), async () => {
    const taskId = input.task_id || await nextTaskId(root);
    const existing = await readJson(taskFile(root, taskId)).catch(() => null);
    if (existing) throw new Error(`Task already exists: ${taskId}`);
    const timestamp = now();
    const task = {
    task_id: taskId,
    title: input.title,
    description: input.description || '',
    type: input.type || 'INFRASTRUCTURE',
    risk: input.risk || 'MEDIUM',
    status: 'NEW',
    created_at: timestamp,
    updated_at: timestamp,
    base_commit: input.base_commit,
    branch: input.branch,
    affected_modules: input.affected_modules || [],
    affected_files: input.affected_files || [],
    required_agents: input.required_agents || ['ORCHESTRATOR', 'ANALYST', 'DEVELOPER', 'REVIEWER', 'QA'],
    required_gates: input.required_gates || ['BUILD_GATE', 'REVIEW_GATE', 'QA_GATE'],
    baseline: {},
    implementation: {},
    tests: [],
    metrics: {},
    evidence: [],
    artifacts: [],
    gates: {},
    retries: {},
    result: null,
    revision: 1,
    agent_assignments: { ORCHESTRATOR: input.actor || 'orchestrator' },
    human_approvals: {},
    history: [{
      at: timestamp,
      event: 'TASK_CREATED',
      actor: input.actor || 'orchestrator',
      affected_files: input.affected_files || [],
      required_gates: input.required_gates || ['BUILD_GATE', 'REVIEW_GATE', 'QA_GATE']
    }]
    };
    await writeJsonAtomic(taskFile(root, taskId), task);
    return task;
  });
}

export async function loadTask(root, taskId) {
  const task = await readJson(taskFile(root, taskId));
  task.revision ||= 1;
  task.agent_assignments ||= { ORCHESTRATOR: task.history?.[0]?.actor || 'orchestrator' };
  task.human_approvals ||= {};
  task.gate_attempts ||= {};
  return task;
}

export async function saveTask(root, task) {
  const file = taskFile(root, task.task_id);
  return withFileLock(`${file}.lock`, async () => {
    const current = await readJson(file);
    if ((task.revision || 1) !== (current.revision || 1)) {
      throw new Error(`Stale task update for ${task.task_id}; reload and retry`);
    }
    task.updated_at = now();
    task.revision = (current.revision || 1) + 1;
    await writeJsonAtomic(file, task);
    return task;
  });
}

export async function transitionTask(root, taskId, nextStatus, actor, reason = '') {
  if (!TASK_STATUSES.includes(nextStatus)) throw new Error(`Unknown task status: ${nextStatus}`);
  const task = await loadTask(root, taskId);
  if (task.agent_assignments?.ORCHESTRATOR !== actor) throw new Error('Only the assigned ORCHESTRATOR may transition task state');
  if (!LEGAL_TRANSITIONS[task.status]?.includes(nextStatus)) {
    throw new Error(`Illegal transition: ${task.status} -> ${nextStatus}`);
  }
  if (nextStatus === 'READY_FOR_INTERNAL_RELEASE') {
    const preBuildGates = task.required_gates.filter((gate) => !['BUILD_GATE', 'INTERNAL_RELEASE_GATE'].includes(gate));
    const incomplete = preBuildGates.filter((gate) => {
      const result = task.gates[gate]?.result;
      return ['REVIEW_GATE', 'QA_GATE'].includes(gate) ? result !== 'PASS' : !['PASS', 'NOT_REQUIRED'].includes(result);
    });
    if (incomplete.length > 0) throw new Error(`Cannot prepare release; incomplete gates: ${incomplete.join(', ')}`);
  }
  if (nextStatus === 'COMPLETED') {
    const strictPass = new Set(['BUILD_GATE', 'REVIEW_GATE', 'QA_GATE']);
    const incomplete = task.required_gates.filter((gate) => {
      const result = task.gates[gate]?.result;
      return strictPass.has(gate) ? result !== 'PASS' : !['PASS', 'NOT_REQUIRED'].includes(result);
    });
    if (incomplete.length > 0) throw new Error(`Cannot complete task; incomplete gates: ${incomplete.join(', ')}`);
    if (task.required_gates.includes('INTERNAL_RELEASE_GATE')) {
      throw new Error('Release-targeted tasks cannot use COMPLETED; follow the internal release lifecycle');
    }
  }
  if (nextStatus === 'REVIEWING' && (!task.candidate_commit || !task.implementation?.completed_at)) {
    throw new Error('Implementation must be completed and sealed to a candidate commit before review');
  }
  if (nextStatus === 'APPROVED_FOR_INTERNAL_TESTING') {
    const strictPass = new Set(['BUILD_GATE', 'REVIEW_GATE', 'QA_GATE', 'INTERNAL_RELEASE_GATE']);
    const incomplete = task.required_gates.filter((gate) => {
      const result = task.gates[gate]?.result;
      return strictPass.has(gate) ? result !== 'PASS' : !['PASS', 'NOT_REQUIRED'].includes(result);
    });
    if (incomplete.length > 0) throw new Error(`Cannot approve internal testing; incomplete gates: ${incomplete.join(', ')}`);
    const apk = task.artifacts?.find((artifact) => artifact.type === 'APK' && artifact.commit === task.candidate_commit && artifact.signature_verified === true && artifact.sha256);
    if (!apk) throw new Error('Cannot approve internal testing without a signed, checksummed APK bound to the candidate commit');
  }
  if (nextStatus === 'DEPLOYING_INTERNAL' && !task.human_approvals?.internal_deploy) {
    throw new Error('Internal deployment requires recorded human approval');
  }
  if (nextStatus === 'APPROVED_FOR_PRODUCTION' && !task.human_approvals?.production) {
    throw new Error('Production approval requires recorded human approval');
  }
  const previous = task.status;
  task.status = nextStatus;
  if (nextStatus === 'IMPLEMENTING') {
    const invalidated = Object.keys(task.gates || {});
    task.gates = {};
    if (invalidated.length > 0) {
      task.history.push({ at: now(), event: 'GATES_INVALIDATED_FOR_REIMPLEMENTATION', gates: invalidated, actor });
    }
  }
  task.history.push({ at: now(), event: 'STATUS_CHANGED', from: previous, to: nextStatus, actor, reason });
  return saveTask(root, task);
}

export async function recordHumanApproval(root, taskId, stage, actor, evidence) {
  if (!['internal_deploy', 'production'].includes(stage)) throw new Error(`Unsupported human approval stage: ${stage}`);
  if (!actor || !evidence) throw new Error('Human approval actor and evidence are required');
  const task = await loadTask(root, taskId);
  if (task.implementation?.actor === actor) throw new Error('The implementer cannot provide the required human approval');
  await validateEvidenceFiles(root, [evidence]);
  task.human_approvals ||= {};
  task.human_approvals[stage] = { actor, evidence, recorded_at: now() };
  task.evidence = [...new Set([...(task.evidence || []), evidence])];
  task.history.push({ at: now(), event: 'HUMAN_APPROVAL_RECORDED', stage, actor, evidence });
  return saveTask(root, task);
}

export async function assignAgent(root, taskId, role, actor, assignedBy) {
  if (!role || !actor || !assignedBy) throw new Error('Role, actor and assigner are required');
  const task = await loadTask(root, taskId);
  if (task.agent_assignments?.ORCHESTRATOR !== assignedBy) throw new Error('Only the assigned orchestrator may assign agents');
  task.agent_assignments ||= {};
  task.agent_assignments[role] = actor;
  task.history.push({ at: now(), event: 'AGENT_ASSIGNED', role, actor, assigned_by: assignedBy });
  return saveTask(root, task);
}

export async function reassessTask(root, taskId, actor, assessment, evidence) {
  const task = await loadTask(root, taskId);
  if (task.agent_assignments?.ORCHESTRATOR !== actor) throw new Error('Only the assigned ORCHESTRATOR may reassess risk');
  if (!['ANALYZING', 'PLAN_READY', 'IMPLEMENTING'].includes(task.status)) {
    throw new Error(`Risk can only be reassessed during analysis or implementation, not ${task.status}`);
  }
  await validateEvidenceFiles(root, [evidence]);
  const previous = {
    risk: task.risk,
    affected_modules: task.affected_modules,
    affected_files: task.affected_files,
    required_gates: task.required_gates
  };
  const invalidatedGates = Object.keys(task.gates || {});
  task.risk = assessment.risk;
  task.affected_modules = assessment.affected_modules;
  task.affected_files = [...new Set(assessment.impacts.flatMap((impact) => impact.files))];
  task.required_gates = assessment.required_gates;
  task.risk_impacts = assessment.impacts;
  task.gates = {};
  task.evidence = [...new Set([...(task.evidence || []), evidence])];
  task.history.push({
    at: now(), event: 'RISK_REASSESSED', actor, previous, next: assessment,
    next_affected_files: task.affected_files, invalidated_gates: invalidatedGates, evidence
  });
  return saveTask(root, task);
}

export async function setImplementer(root, taskId, actor, summary) {
  const task = await loadTask(root, taskId);
  if (task.status !== 'IMPLEMENTING') throw new Error('Implementer can only be recorded in IMPLEMENTING');
  if (task.agent_assignments?.DEVELOPER !== actor) throw new Error(`${actor} is not the assigned DEVELOPER`);
  if (task.implementation?.actor && task.implementation.actor !== actor) throw new Error('Implementation actor is immutable within an implementation attempt');
  task.implementation = { actor, completed_at: null, summary: summary || '' };
  return saveTask(root, task);
}

export async function sealCandidate(root, taskId, actor, commit, branch) {
  const task = await loadTask(root, taskId);
  if (task.status !== 'IMPLEMENTING') throw new Error('Candidate can only be sealed in IMPLEMENTING');
  if (task.agent_assignments?.DEVELOPER !== actor || task.implementation?.actor !== actor) {
    throw new Error(`${actor} is not the recorded DEVELOPER/implementer`);
  }
  task.implementation.completed_at = now();
  task.candidate_commit = commit;
  task.candidate_branch = branch;
  task.history.push({ at: now(), event: 'CANDIDATE_SEALED', actor, commit, branch });
  return saveTask(root, task);
}
