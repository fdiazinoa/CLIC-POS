import WebSocket from 'ws';

const port = Number(process.env.CLIC_POS_CDP_PORT || 9229);
const cycles = Number(process.env.CLIC_POS_CYCLES || 30);
const endpoint = `http://127.0.0.1:${port}/json`;
const pages = await fetch(endpoint).then(response => response.json());
const page = pages.find(candidate => candidate.type === 'page' && candidate.url?.includes('localhost'));
if (!page) throw new Error(`No CLIC-POS WebView page at ${endpoint}`);

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.once('open', resolve);
  socket.once('error', reject);
});
let nextId = 0;
const pending = new Map();
socket.on('message', message => {
  const reply = JSON.parse(message.toString());
  if (!reply.id || !pending.has(reply.id)) return;
  const { resolve, reject } = pending.get(reply.id);
  pending.delete(reply.id);
  if (reply.error) reject(new Error(reply.error.message));
  else resolve(reply.result);
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result?.value;
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const isVisible = async host => evaluate(`(() => { const node = document.querySelector('[${host}]'); return Boolean(node && getComputedStyle(node).visibility === 'visible'); })()`);
const waitVisible = async (host, timeoutMs = 10000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isVisible(host)) return;
    await wait(35);
  }
  throw new Error(`Timeout waiting for ${host}`);
};
const tapText = async label => {
  const findPoint = () => evaluate(`(() => {
    const label = ${JSON.stringify(label)};
    const button = [...document.querySelectorAll('button')].find(candidate =>
      candidate.innerText.trim() === label && candidate.getBoundingClientRect().width > 0 &&
      getComputedStyle(candidate).visibility === 'visible');
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  let point;
  const deadline = Date.now() + 10000;
  while (!point && Date.now() < deadline) {
    point = await findPoint();
    if (!point) await wait(35);
  }
  if (!point) throw new Error(`Visible button missing: ${label}`);
  await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
  await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
const percentile = (values, fraction) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] * 10) / 10;
};
const summarize = samples => ({
  n: samples.length,
  p50: percentile(samples, 0.5),
  p95: percentile(samples, 0.95),
  p99: percentile(samples, 0.99),
  max: samples.length ? Math.max(...samples) : null,
});

const results = { toTables: [], toSales: [] };
const output = {
  device: process.env.CLIC_POS_DEVICE || 'unknown',
  cycles,
  source: page.url,
  startedAt: new Date().toISOString(),
  method: 'CDP Input.dispatchTouchEvent; durations from in-WebView performance.now() traces',
};
try {
  const version = await evaluate("document.body.innerText.match(/APK v[^\\n]+/)?.[0] || null");
  output.version = version;
  if (await isVisible('data-table-map-persistent-host')) {
    await tapText('Cerrar');
    await waitVisible('data-pos-persistent-host');
  }
  await evaluate('window.__CLIC_POS_PERFORMANCE__?.clear()');
  for (let index = 0; index < cycles; index += 1) {
    await waitVisible('data-pos-persistent-host');
    await tapText('MESAS');
    await waitVisible('data-table-map-persistent-host');
    await wait(80);
    const toTables = await evaluate("window.__CLIC_POS_PERFORMANCE__?.getTraces().filter(trace => trace.operation === 'CHANGE_TABLE').at(-1)");
    results.toTables.push(toTables);

    await tapText('Cerrar');
    await waitVisible('data-pos-persistent-host');
    await wait(80);
    const toSales = await evaluate("window.__CLIC_POS_PERFORMANCE__?.getTraces().filter(trace => trace.operation === 'CLOSE_TABLE_MAP').at(-1)");
    results.toSales.push(toSales);
    if ((index + 1) % 10 === 0) console.error(`Completed ${index + 1}/${cycles} cycles`);
  }
  const duration = (samples, start, end) => samples.flatMap(trace => {
    const first = trace?.stages?.[start];
    const last = trace?.stages?.[end];
    return Number.isFinite(first) && Number.isFinite(last) ? [last - first] : [];
  });
  output.completedAt = new Date().toISOString();
  output.summary = {
    toTablesInputToRenderEndProxyMs: summarize(duration(results.toTables, 'INPUT_RECEIVED', 'RENDER_END')),
    toSalesInputToVisiblePrepaintProxyMs: summarize(duration(results.toSales, 'INPUT_RECEIVED', 'FIRST_FRAME_VISIBLE')),
    toSalesInputToInteractiveNextTaskProxyMs: summarize(duration(results.toSales, 'INPUT_RECEIVED', 'FIRST_FRAME_INTERACTIVE')),
  };
  if (process.env.CLIC_POS_INCLUDE_TRACES === 'true') output.traces = results;
  console.log(JSON.stringify(output));
} finally {
  socket.close();
}
