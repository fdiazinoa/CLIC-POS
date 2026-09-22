#!/usr/bin/env node
// Read only aggregate freeze counters and selected WebView memory metrics.
import fs from 'node:fs';

const [endpoint, output] = process.argv.slice(2);
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint || '') || !output) {
  throw new Error('Usage: snapshot-freeze.mjs http://127.0.0.1:PORT OUTPUT.json');
}
const tabs = await (await fetch(`${endpoint}/json`)).json();
const tab = tabs.find((item) => item.type === 'page' && item.url.startsWith('https://localhost'));
if (!tab) throw new Error('CLIC-POS WebView not found on this forwarded device');
const socket = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const pending = new Map();
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (!message.id) return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timer);
  message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
};
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 5000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
try {
  await call('Performance.enable');
  const [result, metricsResult] = await Promise.all([
    call('Runtime.evaluate', { expression: 'JSON.stringify(globalThis.__CLIC_FREEZE_DIAG__?.snapshot() ?? null)', returnByValue: true }),
    call('Performance.getMetrics'),
  ]);
  const allowed = new Set(['JSHeapUsedSize', 'JSHeapTotalSize', 'Nodes', 'LayoutCount', 'RecalcStyleCount', 'TaskDuration']);
  const metrics = Object.fromEntries((metricsResult.metrics || []).filter((row) => allowed.has(row.name)).map((row) => [row.name, row.value]));
  const snapshot = { capturedAt: new Date().toISOString(), counters: JSON.parse(result.result?.value ?? 'null'), metrics };
  fs.writeFileSync(output, JSON.stringify(snapshot, null, 2));
  console.log(JSON.stringify({ output, counters: Object.keys(snapshot.counters?.counters || {}), metrics }));
} finally {
  socket.close();
}
