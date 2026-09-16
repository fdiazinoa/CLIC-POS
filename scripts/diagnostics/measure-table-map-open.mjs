import fs from 'node:fs';
import WebSocket from 'ws';

const endpoint = process.env.CLIC_POS_CDP_URL || 'http://127.0.0.1:9222/json';
const cyclesRequested = Number(process.argv[2] || 20);
const output = process.argv[3];
if (!output) throw new Error('Usage: measure-table-map-open.mjs CYCLES OUTPUT.json');

const pages = await (await fetch(endpoint)).json();
const page = pages.find(candidate => candidate.type === 'page' && candidate.url?.startsWith('https://localhost'));
if (!page?.webSocketDebuggerUrl) throw new Error(`No CLIC POS WebView found at ${endpoint}`);

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.once('open', resolve);
  socket.once('error', reject);
});

let sequence = 0;
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const onMessage = data => {
    const message = JSON.parse(data);
    if (message.id !== id) return;
    socket.off('message', onMessage);
    if (message.error) reject(new Error(`${method}: ${JSON.stringify(message.error)}`));
    else resolve(message.result);
  };
  socket.on('message', onMessage);
  socket.send(JSON.stringify({ id, method, params }));
});

const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const metrics = async () => Object.fromEntries((await call('Performance.getMetrics')).metrics.map(row => [row.name, row.value]));
const metricDelta = (before, after, name) => ((after[name] || 0) - (before[name] || 0)) * 1000;

const findButton = async label => evaluate(`(() => {
  const target = ${JSON.stringify(label.toUpperCase())};
  const button = [...document.querySelectorAll('button')].find(candidate =>
    candidate.textContent?.trim().toUpperCase() === target &&
    candidate.getBoundingClientRect().width > 0 &&
    getComputedStyle(candidate).visibility !== 'hidden'
  );
  if (!button) return null;
  const rect = button.getBoundingClientRect();
  return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
})()`);

const touchButton = async label => {
  const point = await findButton(label);
  if (!point) throw new Error(`Visible button ${label} was not found`);
  await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y, radiusX: 2, radiusY: 2, force: 1 }] });
  await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};

const waitFor = async (expression, timeoutMs = 5000) => {
  const started = Date.now();
  while (!(await evaluate(expression))) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out: ${expression}`);
    await sleep(10);
  }
};

await call('Performance.enable');
const capability = await evaluate(`({
  diagnostics: globalThis.__POS_DIAGNOSTICS__?.status?.(),
  tableMapApi: typeof window.__TABLE_MAP_DIAGNOSTICS__,
  view: document.querySelector('[data-table-map-persistent-host]')?.getAttribute('aria-hidden'),
})`);
if (!capability?.diagnostics?.active || capability.tableMapApi !== 'object') {
  throw new Error(`Diagnostic runtime is not active: ${JSON.stringify(capability)}`);
}

await evaluate(`window.__TABLE_MAP_DIAGNOSTICS__.clear()`);
const samples = [];
for (let index = 0; index < cyclesRequested; index += 1) {
  await waitFor(`!document.querySelector('[data-table-map-persistent-host]') || document.querySelector('[data-table-map-persistent-host]').getAttribute('aria-hidden') === 'true'`);
  const before = await metrics();
  const resourceCountBefore = await evaluate(`performance.getEntriesByType('resource').length`);
  await touchButton('MESAS');
  await waitFor(`window.__TABLE_MAP_DIAGNOSTICS__.getRuns().at(-1)?.stages.TABLE_MAP_FIRST_VISIBLE !== undefined`, 10000);
  const after = await metrics();
  const run = await evaluate(`window.__TABLE_MAP_DIAGNOSTICS__.getRuns().at(-1)`);
  const resourceCountAfter = await evaluate(`performance.getEntriesByType('resource').length`);
  samples.push({
    cycle: index + 1,
    ...run,
    elapsed: Object.fromEntries(Object.entries(run.stages).map(([name, at]) => [name, at - run.startedAt])),
    cdp: {
      scriptMs: metricDelta(before, after, 'ScriptDuration'),
      taskMs: metricDelta(before, after, 'TaskDuration'),
      layoutMs: metricDelta(before, after, 'LayoutDuration'),
      recalcStyleMs: metricDelta(before, after, 'RecalcStyleDuration'),
      resources: resourceCountAfter - resourceCountBefore,
    },
  });
  if (index + 1 < cyclesRequested) {
    await touchButton('CERRAR');
    await waitFor(`document.querySelector('[data-table-map-persistent-host]')?.getAttribute('aria-hidden') === 'true'`);
    await sleep(150);
  }
}

const percentile = (values, fraction) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
};
const durations = samples.map(sample => sample.elapsed.TABLE_MAP_FIRST_VISIBLE);
const report = {
  capturedAt: new Date().toISOString(),
  endpoint,
  capability,
  samples,
  summary: {
    samples: samples.length,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
    maxMs: Math.max(...durations),
  },
};
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
socket.close();
console.log(JSON.stringify(report.summary));
