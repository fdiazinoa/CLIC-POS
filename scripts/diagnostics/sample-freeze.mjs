#!/usr/bin/env node
// 5–10 second, on-demand V8 sample. Does not evaluate JS until after Profiler.stop.
import fs from 'node:fs';
import path from 'node:path';

const [endpoint, output, duration = '8'] = process.argv.slice(2);
const seconds = Number(duration);
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint || '') || !output || !Number.isFinite(seconds) || seconds < 5 || seconds > 10) {
  throw new Error('Usage: sample-freeze.mjs http://127.0.0.1:PORT OUTPUT_DIR [5..10]');
}
fs.mkdirSync(output, { recursive: true });
const tabs = await (await fetch(`${endpoint}/json`)).json();
const tab = tabs.find((item) => item.type === 'page' && item.url.startsWith('https://localhost'));
if (!tab) throw new Error('CLIC-POS WebView not found on this forwarded device');

const socket = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
const pending = new Map();
let sequence = 0;
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (!message.id) return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timer);
  message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
};
function call(method, params = {}, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

const startedAt = new Date().toISOString();
let profiling = false;
try {
  await call('Profiler.enable');
  await call('Profiler.setSamplingInterval', { interval: 1000 });
  await call('Profiler.start');
  profiling = true;
  console.log(`V8 profiling started for ${seconds}s`);
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  const { profile } = await call('Profiler.stop', {}, 30_000);
  profiling = false;
  fs.writeFileSync(path.join(output, 'javascript.cpuprofile'), JSON.stringify(profile));
  const summary = { startedAt, stoppedAt: new Date().toISOString(), seconds,
    nodes: profile.nodes?.length || 0, samples: profile.samples?.length || 0,
    source: tab.url };
  fs.writeFileSync(path.join(output, 'profile-summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));

  // This can time out if the event loop remains blocked; the CPU profile is already safe.
  try {
    const result = await call('Runtime.evaluate', {
      expression: 'JSON.stringify(globalThis.__CLIC_FREEZE_DIAG__?.snapshot() ?? null)',
      returnByValue: true,
    }, 3000);
    fs.writeFileSync(path.join(output, 'freeze-counters.json'), result.result?.value ?? 'null');
  } catch (error) {
    fs.writeFileSync(path.join(output, 'freeze-counters-error.txt'), String(error));
  }
} finally {
  if (profiling) {
    try {
      const { profile } = await call('Profiler.stop', {}, 30_000);
      fs.writeFileSync(path.join(output, 'javascript.cpuprofile'), JSON.stringify(profile));
    } catch (error) {
      fs.writeFileSync(path.join(output, 'profile-error.txt'), String(error));
    }
  }
  try { await call('Profiler.disable', {}, 3000); } catch { /* preserve capture */ }
  socket.close();
}
