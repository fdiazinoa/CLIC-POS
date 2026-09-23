import WebSocket from 'ws';

const port = Number(process.env.CLIC_POS_CDP_PORT || 9229);
const cycles = Number(process.env.CLIC_POS_CYCLES || 50);
const mode = process.env.CLIC_POS_QA_MODE || 'pure-switch';
const productLimit = process.env.CLIC_POS_PRODUCT_LIMIT ? Number(process.env.CLIC_POS_PRODUCT_LIMIT) : null;
const cardLimit = process.env.CLIC_POS_CARD_LIMIT ? Number(process.env.CLIC_POS_CARD_LIMIT) : null;
const page = (await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json()))
  .find(candidate => candidate.type === 'page' && candidate.url?.includes('localhost'));
if (!page) throw new Error('CLIC-POS WebView not found');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
let nextId = 0;
const pending = new Map();
socket.on('message', raw => {
  const message = JSON.parse(raw.toString());
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  message.error ? reject(new Error(message.error.message)) : resolve(message.result);
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
const percentile = (values, fraction) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] * 10) / 10;
};
const summarize = values => ({
  n: values.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95),
  p99: percentile(values, 0.99), max: values.length ? Math.round(Math.max(...values) * 10) / 10 : null,
});

const run = async (direction, method, host) => {
  await evaluate('performance.clearMarks()');
  await evaluate(`window.__CLIC_TABLE_LATENCY_QA__.${method}()`);
  const deadline = Date.now() + 15000;
  let sample;
  while (Date.now() < deadline) {
    sample = await evaluate(`(() => {
      const host = document.querySelector('[${host}]');
      const marks = performance.getEntriesByType('mark').filter(entry => entry.name.startsWith('CLIC_TABLE_QA_'));
      const stage = name => marks.find(entry => entry.name === 'CLIC_TABLE_QA_' + name &&
        (name === 'PURE_INPUT' || name === 'VIEW_CHANGE_REQUEST' || entry.detail?.direction === ${JSON.stringify(direction)}))?.startTime;
      return { visible: host && getComputedStyle(host).visibility === 'visible',
        input: stage('PURE_INPUT'), commit: stage('REACT_COMMIT_END'), frame: stage('FIRST_FRAME_VISIBLE'),
        interactive: stage('UI_INTERACTIVE'), cards: document.querySelectorAll('.pos-product-card').length,
        qa: window.__CLIC_TABLE_LATENCY_QA__.get() };
    })()`);
    if (sample?.visible && Number.isFinite(sample.interactive)) return sample;
    await wait(30);
  }
  throw new Error(`Timeout: ${direction} ${JSON.stringify(sample)}`);
};

try {
  const controls = await evaluate('Boolean(window.__CLIC_TABLE_LATENCY_QA__?.showTables && window.__CLIC_TABLE_LATENCY_QA__?.showSales)');
  if (!controls) throw new Error('QA controls unavailable; do not run this on the baseline APK');
  await evaluate(`window.__CLIC_TABLE_LATENCY_QA__.set(${JSON.stringify({ mode, productLimit, cardLimit })})`);
  await wait(400);
  const eligibleProducts = await evaluate("performance.getEntriesByName('CLIC_TABLE_QA_FILTER_END').at(-1)?.detail?.products ?? null");
  const toTables = [];
  const toSales = [];
  for (let index = 0; index < cycles; index += 1) {
    toTables.push(await run('SALES_TO_TABLES', 'showTables', 'data-table-map-persistent-host'));
    toSales.push(await run('TABLES_TO_SALES', 'showSales', 'data-pos-persistent-host'));
    if ((index + 1) % 10 === 0) console.error(`Completed ${index + 1}/${cycles}`);
  }
  const metrics = samples => ({
    inputToCommit: summarize(samples.flatMap(sample => Number.isFinite(sample.commit) ? [sample.commit - sample.input] : [])),
    commitToFrameProxy: summarize(samples.flatMap(sample => Number.isFinite(sample.frame) ? [sample.frame - sample.commit] : [])),
    frameToInteractiveProxy: summarize(samples.flatMap(sample => Number.isFinite(sample.interactive) ? [sample.interactive - sample.frame] : [])),
    inputToFrameProxy: summarize(samples.flatMap(sample => Number.isFinite(sample.frame) ? [sample.frame - sample.input] : [])),
    inputToInteractiveProxy: summarize(samples.flatMap(sample => Number.isFinite(sample.interactive) ? [sample.interactive - sample.input] : [])),
    cards: [...new Set(samples.map(sample => sample.cards))],
  });
  console.log(JSON.stringify({ mode, cycles, productLimit, eligibleProducts, cardLimit,
    method: 'pure QA API: setCurrentView only; in-WebView User Timing; frame=prepaint rAF proxy',
    toTables: metrics(toTables), toSales: metrics(toSales) }));
} finally {
  socket.close();
}
