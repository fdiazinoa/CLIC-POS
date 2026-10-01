import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { validateEvidenceFiles } from './evidence.mjs';
import { now } from './io.mjs';
import { loadTask, saveTask } from './task-state.mjs';

export async function recordApkArtifact(root, taskId, actor, metadata, signatureEvidence) {
  const task = await loadTask(root, taskId);
  if (task.status !== 'BUILDING') throw new Error('APK artifacts may only be recorded while BUILDING');
  if (task.agent_assignments?.RELEASE !== actor) throw new Error(`${actor} is not the assigned RELEASE agent`);
  if (!task.candidate_commit) throw new Error('Candidate commit must be sealed before APK registration');
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout?.trim();
  const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout?.trim();
  if (head !== task.candidate_commit || dirty) throw new Error('APK registration requires a clean worktree at the sealed candidate commit');
  await validateEvidenceFiles(root, [path.relative(root, metadata.path), signatureEvidence]);
  const artifact = {
    type: 'APK',
    ...metadata,
    commit: task.candidate_commit,
    source_worktree_clean: true,
    signature_verified: true,
    signature_evidence: signatureEvidence,
    recorded_at: now(),
    recorded_by: actor
  };
  task.artifacts.push(artifact);
  task.evidence = [...new Set([...task.evidence, signatureEvidence])];
  task.history.push({ at: now(), event: 'APK_ARTIFACT_RECORDED', actor, filename: metadata.filename, sha256: metadata.sha256 });
  return saveTask(root, task);
}
