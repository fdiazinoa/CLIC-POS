import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeEvidence } from './evidence.mjs';
import { recordGate } from './gates.mjs';
import { loadTask } from './task-state.mjs';

export async function runConfiguredGate(root, config, input) {
  const task = await loadTask(root, input.task_id);
  const gateConfig = config.gates[input.gate];
  if (!gateConfig) throw new Error(`Unknown gate: ${input.gate}`);
  const command = gateConfig.execute_by_type?.[task.type] || gateConfig.execute_by_type?.['*'];
  if (!command) {
    const evidence = await writeEvidence(root, task.task_id, input.gate.toLowerCase(), {
      gate: input.gate,
      result: 'BLOCKED',
      reason: `No executable capability is configured for task type ${task.type}`
    });
    return recordGate(root, task.task_id, {
      gate: input.gate,
      result: 'BLOCKED',
      actor: input.actor,
      role: input.role,
      evidence: [evidence],
      allowed_roles: gateConfig.approver_roles || [],
      max_attempts: 1 + config.max_automatic_retries
    });
  }

  const startedAt = new Date().toISOString();
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout?.trim();
  const worktreeStatus = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout || '';
  const run = spawnSync(command[0], command.slice(1), {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    env: process.env
  });
  const candidateMatches = Boolean(task.candidate_commit) && task.candidate_commit === commit;
  const cleanCandidate = worktreeStatus.trim().length === 0;
  const result = run.status === 0 && candidateMatches && cleanCandidate ? 'PASS' : 'FAIL';
  const stdout = run.stdout || '';
  const stderr = run.stderr || '';
  const evidence = await writeEvidence(root, task.task_id, input.gate.toLowerCase(), {
    gate: input.gate,
    command,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    exit_code: run.status,
    signal: run.signal,
    stdout_bytes: Buffer.byteLength(stdout),
    stdout_sha256: createHash('sha256').update(stdout).digest('hex'),
    stderr_bytes: Buffer.byteLength(stderr),
    stderr_sha256: createHash('sha256').update(stderr).digest('hex'),
    note: 'Raw command output is intentionally not persisted because it may contain secrets; retain only an independently scrubbed log when required.',
    result,
    commit,
    candidate_commit: task.candidate_commit || null,
    worktree_clean: cleanCandidate,
    candidate_matches: candidateMatches
  });
  return recordGate(root, task.task_id, {
    gate: input.gate,
    result,
    actor: input.actor,
    role: input.role,
    evidence: [evidence],
    allowed_roles: gateConfig.approver_roles || [],
    max_attempts: 1 + config.max_automatic_retries
  });
}
