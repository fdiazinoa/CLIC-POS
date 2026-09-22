#!/usr/bin/env node
// Summarize sampled V8 CPU time. Times are estimates from sample deltas, not wall-clock spans.
import fs from 'node:fs';
import path from 'node:path';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

const [profilePath, assetsDirectory] = process.argv.slice(2);
if (!profilePath || !assetsDirectory) throw new Error('Usage: summarize-freeze.mjs PROFILE.cpuprofile DIST/assets');
const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
const nodes = new Map((profile.nodes || []).map((node) => [node.id, node]));
const parent = new Map();
for (const node of nodes.values()) for (const child of node.children || []) parent.set(child, node.id);
const maps = new Map();
function describe(node) {
  const frame = node.callFrame || {};
  const url = frame.url || '';
  const bundle = url.startsWith('https://localhost/assets/') ? url.split('/').pop() : null;
  const mapPath = bundle ? path.join(assetsDirectory, `${bundle}.map`) : null;
  if (mapPath && !fs.existsSync(mapPath)) throw new Error(`Missing exact bundled sourcemap: ${mapPath}`);
  let mapped = null;
  if (mapPath && fs.existsSync(mapPath) && Number.isInteger(frame.lineNumber) && frame.lineNumber >= 0) {
    if (!maps.has(mapPath)) maps.set(mapPath, new TraceMap(JSON.parse(fs.readFileSync(mapPath, 'utf8'))));
    mapped = originalPositionFor(maps.get(mapPath), {
      line: frame.lineNumber + 1,
      column: Math.max(0, frame.columnNumber || 0),
    });
  }
  return {
    function: mapped?.name || frame.functionName || '(anonymous)',
    file: mapped?.source || url || '(native)',
    line: mapped?.line ?? (Number.isInteger(frame.lineNumber) ? frame.lineNumber + 1 : null),
    generated: bundle && mapped?.source ? `${bundle}:${frame.lineNumber + 1}:${(frame.columnNumber || 0) + 1}` : null,
  };
}
const frameById = new Map([...nodes].map(([id, node]) => [id, describe(node)]));
const selfUs = new Map();
const totalUs = new Map();
const stacks = new Map();
let sampledUs = 0;
for (const [index, id] of (profile.samples || []).entries()) {
  const delta = profile.timeDeltas?.[index] || 1000;
  sampledUs += delta;
  selfUs.set(id, (selfUs.get(id) || 0) + delta);
  const ancestry = [];
  const seen = new Set();
  let current = id;
  while (nodes.has(current) && !seen.has(current)) {
    seen.add(current);
    ancestry.unshift(current);
    totalUs.set(current, (totalUs.get(current) || 0) + delta);
    current = parent.get(current);
  }
  const key = ancestry.join('/');
  const row = stacks.get(key) || { ids: ancestry, sampleCount: 0, estimatedUs: 0 };
  row.sampleCount++;
  row.estimatedUs += delta;
  stacks.set(key, row);
}
const summary = {
  profile: profilePath,
  sampleCount: profile.samples?.length || 0,
  sampledMs: sampledUs / 1000,
  note: 'Self/total times and percentages are sample-weighted estimates; stack total is inclusive and must not be summed across ancestors.',
  dominantFrames: [...nodes.keys()].map((id) => ({
    ...frameById.get(id),
    selfMs: +( (selfUs.get(id) || 0) / 1000 ).toFixed(2),
    totalMs: +( (totalUs.get(id) || 0) / 1000 ).toFixed(2),
    selfPercent: sampledUs ? +((selfUs.get(id) || 0) * 100 / sampledUs).toFixed(2) : 0,
  })).filter((row) => row.selfMs > 0).sort((a, b) => b.selfMs - a.selfMs).slice(0, 30),
  dominantStacks: [...stacks.values()].sort((a, b) => b.estimatedUs - a.estimatedUs).slice(0, 15).map((row) => ({
    samples: row.sampleCount,
    estimatedMs: +(row.estimatedUs / 1000).toFixed(2),
    percent: sampledUs ? +(row.estimatedUs * 100 / sampledUs).toFixed(2) : 0,
    frames: row.ids.map((id) => frameById.get(id)),
  })),
};
const outputPath = path.join(path.dirname(profilePath), 'freeze-profile-analysis.json');
fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));
console.log(`Saved ${outputPath}`);
console.log(JSON.stringify({ sampledMs: summary.sampledMs, dominantFrames: summary.dominantFrames.slice(0, 8) }, null, 2));
