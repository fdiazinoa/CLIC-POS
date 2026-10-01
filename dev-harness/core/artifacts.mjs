import path from 'node:path';
import { validateEvidenceFiles } from './evidence.mjs';
import { now } from './io.mjs';
import { loadTask, saveTask } from './task-state.mjs';

export async function recordApkArtifact(root, taskId, actor, metadata, signatureEvidence) {
  const task = await loadTask(root, taskId);
  if (task.status !== 'BUILDING') throw new Error('APK artifacts may only be recorded while BUILDING');
  if (task.agent_assignments?.RELEASE !== actor) throw new Error(`${actor} is not the assigned RELEASE agent`);
  if (!task.candidate_commit) throw new Error('Candidate commit must be sealed before APK registration');
  await validateEvidenceFiles(root, [path.relative(root, metadata.path), signatureEvidence]);
  const artifact = {
    type: 'APK',
    ...metadata,
    commit: task.candidate_commit,
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

