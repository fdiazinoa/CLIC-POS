import { stat } from 'node:fs/promises';
import path from 'node:path';
import { assertSafeId, now, writeJsonAtomic } from './io.mjs';

const SECRET_KEY = /(authorization|api[-_]?key|token|password|secret|private[-_]?key|credential|cookie)/i;
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi,
  /\b(Bearer|Basic)\s+[A-Za-z0-9+/._~=-]+/gi,
  /\b(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,}|glpat-[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|AKIA[A-Z0-9]{12,})\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /\b[A-Z0-9_]*(TOKEN|PASSWORD|SECRET|API_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*=\s*[^\s]+/gi
];

function redactString(value) {
  return SECRET_PATTERNS.reduce((current, pattern) => current.replace(pattern, '[REDACTED]'), value);
}

export function redact(value, key = '') {
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)]));
  }
  return value;
}

export async function writeEvidence(root, taskId, category, payload) {
  assertSafeId(taskId, 'task id');
  assertSafeId(category, 'evidence category');
  const timestamp = now();
  const filename = `${timestamp.replaceAll(':', '-')}.json`;
  const relativePath = path.join('dev-harness/evidence', taskId, category, filename);
  await writeJsonAtomic(path.join(root, relativePath), redact({ ...payload, recorded_at: timestamp }));
  return relativePath.replaceAll('\\', '/');
}

export async function validateEvidenceFiles(root, evidence) {
  for (const entry of evidence) {
    const resolved = path.resolve(root, entry);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Evidence must stay inside repository root: ${entry}`);
    const metadata = await stat(resolved).catch(() => null);
    if (!metadata?.isFile()) throw new Error(`Evidence file does not exist: ${entry}`);
  }
}
