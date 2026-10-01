import path from 'node:path';
import { readJson } from './io.mjs';

const ORDER = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export async function loadHarnessConfig(root) {
  return readJson(path.join(root, 'dev-harness/config/clic-pos.json'));
}

export function assessRisk(files, config) {
  const normalized = [...new Set(files.map((file) => file.replaceAll('\\', '/')))];
  const impacts = [];
  const matched = new Set();
  let riskIndex = 0;

  for (const module of config.impact_matrix) {
    const expressions = module.patterns.map((pattern) => new RegExp(pattern, 'i'));
    const matchedFiles = normalized.filter((file) => expressions.some((expression) => expression.test(file)));
    if (matchedFiles.length === 0) continue;
    matchedFiles.forEach((file) => matched.add(file));
    impacts.push({ module: module.module, risk: module.risk, files: matchedFiles, gates: module.gates });
    riskIndex = Math.max(riskIndex, ORDER.indexOf(module.risk));
  }

  const unmatchedFiles = normalized.filter((file) => !matched.has(file));
  if (unmatchedFiles.length > 0 || impacts.length === 0) {
    impacts.push({ module: 'unclassified', risk: 'MEDIUM', files: unmatchedFiles, gates: ['BUILD_GATE', 'REVIEW_GATE', 'QA_GATE'] });
    riskIndex = 1;
  }

  const gates = [...new Set(impacts.flatMap((impact) => impact.gates))];
  return {
    risk: ORDER[riskIndex],
    affected_modules: impacts.map((impact) => impact.module),
    required_gates: config.gate_order.filter((gate) => gates.includes(gate)),
    impacts
  };
}
