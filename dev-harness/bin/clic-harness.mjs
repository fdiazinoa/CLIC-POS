#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { inspectApk, verifyApkSignature } from '../core/apk.mjs';
import { recordApkArtifact } from '../core/artifacts.mjs';
import { writeEvidence } from '../core/evidence.mjs';
import { recordGate, verifyInternalRelease } from '../core/gates.mjs';
import { assessRisk, loadHarnessConfig } from '../core/risk.mjs';
import { runConfiguredGate } from '../core/runner.mjs';
import { assignAgent, createTask, loadTask, reassessTask, recordHumanApproval, sealCandidate, setImplementer, transitionTask } from '../core/task-state.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const [command, ...tokens] = process.argv.slice(2);

function options(values) {
  const parsed = { _: [] };
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith('--')) parsed._.push(token);
    else {
      const key = token.slice(2).replaceAll('-', '_');
      const value = values[index + 1];
      if (!value || value.startsWith('--')) parsed[key] = true;
      else { parsed[key] = value; index += 1; }
    }
  }
  return parsed;
}

function required(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const args = options(tokens);
  if (command === 'init') {
    const files = args.files ? args.files.split(',').filter(Boolean) : [];
    const config = await loadHarnessConfig(root);
    const assessment = assessRisk(files, config);
    return output(await createTask(root, {
      title: required(args.title, 'title'),
      description: args.description || '',
      type: args.type || 'INFRASTRUCTURE',
      base_commit: git('rev-parse', 'HEAD'),
      branch: git('branch', '--show-current'),
      affected_files: files,
      actor: args.actor || 'orchestrator',
      ...assessment
    }));
  }
  if (command === 'show') return output(await loadTask(root, required(args.task, 'task')));
  if (command === 'assess') {
    const files = required(args.files, 'files').split(',').filter(Boolean);
    return output(assessRisk(files, await loadHarnessConfig(root)));
  }
  if (command === 'reassess') {
    const config = await loadHarnessConfig(root);
    const files = required(args.files, 'files').split(',').filter(Boolean);
    return output(await reassessTask(
      root,
      required(args.task, 'task'),
      required(args.actor, 'actor'),
      assessRisk(files, config),
      required(args.evidence, 'evidence')
    ));
  }
  if (command === 'transition') {
    return output(await transitionTask(root, required(args.task, 'task'), required(args.to, 'to'), required(args.actor, 'actor'), args.reason || ''));
  }
  if (command === 'assign-agent') {
    return output(await assignAgent(root, required(args.task, 'task'), required(args.role, 'role'), required(args.actor, 'actor'), required(args.assigned_by, 'assigned-by')));
  }
  if (command === 'implementer') {
    return output(await setImplementer(root, required(args.task, 'task'), required(args.actor, 'actor'), args.summary || ''));
  }
  if (command === 'seal-candidate') {
    if (git('status', '--porcelain')) throw new Error('Candidate worktree must be clean before sealing');
    return output(await sealCandidate(root, required(args.task, 'task'), required(args.actor, 'actor'), git('rev-parse', 'HEAD'), git('branch', '--show-current')));
  }
  if (command === 'human-approve') {
    return output(await recordHumanApproval(
      root,
      required(args.task, 'task'),
      required(args.stage, 'stage'),
      required(args.actor, 'actor'),
      required(args.evidence, 'evidence')
    ));
  }
  if (command === 'evidence') {
    const payload = args.json ? JSON.parse(args.json) : { note: required(args.note, 'note') };
    return output({ path: await writeEvidence(root, required(args.task, 'task'), required(args.category, 'category'), payload) });
  }
  if (command === 'gate') {
    const config = await loadHarnessConfig(root);
    const gate = required(args.gate, 'gate');
    return output(await recordGate(root, required(args.task, 'task'), {
      gate,
      result: required(args.result, 'result'),
      actor: required(args.actor, 'actor'),
      role: required(args.role, 'role'),
      evidence: required(args.evidence, 'evidence').split(','),
      allowed_roles: config.gates[gate]?.approver_roles || [],
      max_attempts: 1 + config.max_automatic_retries
    }));
  }
  if (command === 'run-gate') {
    const config = await loadHarnessConfig(root);
    return output(await runConfiguredGate(root, config, {
      task_id: required(args.task, 'task'),
      gate: required(args.gate, 'gate'),
      actor: required(args.actor, 'actor'),
      role: required(args.role, 'role')
    }));
  }
  if (command === 'release-check') return output(verifyInternalRelease(await loadTask(root, required(args.task, 'task'))));
  if (command === 'inspect-apk') return output(await inspectApk(required(args.file, 'file'), required(args.aapt, 'aapt')));
  if (command === 'register-apk') {
    const taskId = required(args.task, 'task');
    const apkPath = path.resolve(root, required(args.file, 'file'));
    const signature = verifyApkSignature(apkPath, required(args.apksigner, 'apksigner'));
    const signatureEvidence = await writeEvidence(root, taskId, 'build', {
      check: 'apksigner verify --verbose --print-certs',
      apk: path.relative(root, apkPath),
      ...signature
    });
    if (!signature.verified) throw new Error(`APK signature verification failed; evidence: ${signatureEvidence}`);
    const metadata = await inspectApk(apkPath, required(args.aapt, 'aapt'));
    return output(await recordApkArtifact(root, taskId, required(args.actor, 'actor'), metadata, signatureEvidence));
  }
  output({
    usage: [
      'init --title T --files path[,path]',
      'show --task POS-YYYY-NNNN',
      'assess --files path[,path]',
      'reassess --task ID --files path[,path] --actor ORCHESTRATOR --evidence PATH',
      'transition --task ID --to STATUS --actor NAME',
      'assign-agent --task ID --role ROLE --actor NAME --assigned-by ORCHESTRATOR',
      'implementer --task ID --actor NAME [--summary TEXT]',
      'seal-candidate --task ID --actor NAME',
      'human-approve --task ID --stage internal_deploy|production --actor HUMAN --evidence PATH',
      'evidence --task ID --category NAME --note TEXT',
      'gate --task ID --gate NAME --result PASS|FAIL|NOT_REQUIRED|BLOCKED --actor NAME --role ROLE --evidence PATH[,PATH]',
      'run-gate --task ID --gate NAME --actor NAME --role ROLE',
      'release-check --task ID',
      'inspect-apk --file PATH --aapt PATH',
      'register-apk --task ID --file PATH --aapt PATH --apksigner PATH --actor RELEASE_AGENT'
    ]
  });
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
