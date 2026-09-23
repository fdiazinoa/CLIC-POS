import WebSocket from 'ws';

const port = Number(process.env.CLIC_POS_CDP_PORT || 9229);
const cycles = Number(process.env.CLIC_POS_CYCLES || 30);
const qaMode = process.env.CLIC_POS_QA_MODE || 'real';
const tableLabel = process.env.CLIC_POS_TABLE || 'MESA 1';
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
const visible = host => evaluate(`getComputedStyle(document.querySelector('[${host}]')).visibility === 'visible'`);
const waitUntil = async (predicate, label, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await wait(35);
  }
  throw new Error(`Timeout waiting for ${label}`);
};
const tap = async (kind, label) => {
  const selector = kind === 'node' ? '[data-table-node]' : kind === 'account' ? '.table-account-action' : 'button';
  const point = await evaluate(`(() => {
    const label = ${JSON.stringify(label)};
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const target = nodes.find(node => (label === null || ${kind === 'node' ? 'node.innerText.includes(label)' : 'node.innerText.trim() === label'})
      && node.getBoundingClientRect().width > 0 && getComputedStyle(node).visibility === 'visible');
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  if (!point) throw new Error(`${kind} not visible: ${label}`);
  await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
  await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
const percentile = (values, fraction) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] * 10) / 10;
};
const summarize = values => ({
  n: values.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95),
  p99: percentile(values, 0.99), max: values.length ? Math.round(Math.max(...values) * 10) / 10 : null,
});
const metric = (samples, start, end) => summarize(samples.flatMap(trace => {
  const a = trace?.stages?.[start]; const b = trace?.stages?.[end];
  return Number.isFinite(a) && Number.isFinite(b) ? [b - a] : [];
}));

try {
  await evaluate(`window.__CLIC_TABLE_LATENCY_QA__.set({mode:${JSON.stringify(qaMode)}})`);
  await wait(300);
  await evaluate('window.__CLIC_POS_PERFORMANCE__.clear()');
  const selectors = [];
  const accounts = [];
  for (let index = 0; index < cycles; index += 1) {
    if (!(await visible('data-table-map-persistent-host'))) {
      await tap('button', 'MESAS');
      await waitUntil(() => visible('data-table-map-persistent-host'), 'Mesas');
    }
    const before = await evaluate(`(() => {
      const node = [...document.querySelectorAll('[data-table-node]')].find(x => x.innerText.includes(${JSON.stringify(tableLabel)}));
      return node ? { text: node.innerText, className: node.className } : null;
    })()`);
    if (!before || !before.className.includes('rose')) throw new Error(`Expected occupied ${tableLabel}, got ${JSON.stringify(before)}`);
    await tap('node', tableLabel);
    await waitUntil(() => evaluate("[...document.querySelectorAll('.table-account-action')].some(node => node.getBoundingClientRect().width > 0)"), 'account selector');
    await wait(50);
    const selector = await evaluate("window.__CLIC_POS_PERFORMANCE__.getTraces().filter(trace => trace.operation === 'OPEN_TABLE' && trace.renderTarget === 'TABLE_ACCOUNTS').at(-1)");
    if (!selector || selector.status !== 'completed') throw new Error(`Selector incomplete: ${JSON.stringify(selector)}`);
    selectors.push(selector);
    await tap('account', null);
    await waitUntil(() => visible('data-pos-persistent-host'), 'Venta account');
    await wait(100);
    const account = await evaluate("window.__CLIC_POS_PERFORMANCE__.getTraces().filter(trace => trace.operation === 'OPEN_TABLE' && trace.renderTarget === 'POS_TABLE').at(-1)");
    if (!account || account.status !== 'completed') throw new Error(`Account incomplete: ${JSON.stringify(account)}`);
    accounts.push(account);
    await tap('button', 'MESAS');
    await waitUntil(() => visible('data-table-map-persistent-host'), 'Mesas after account');
    await wait(100);
    if ((index + 1) % 10 === 0) console.error(`Completed ${index + 1}/${cycles}`);
  }
  console.log(JSON.stringify({ tableLabel, qaMode, cycles, accountMode: 'existing account selector',
    selector: {
      inputToLockEnd: metric(selectors, 'INPUT_RECEIVED', 'TABLE_LOCK_END'),
      lockStartToEnd: metric(selectors, 'TABLE_LOCK_START', 'TABLE_LOCK_END'),
      lockEndToAccountEnd: metric(selectors, 'TABLE_LOCK_END', 'ACCOUNT_RESOLVE_END'),
      inputToInteractive: metric(selectors, 'INPUT_RECEIVED', 'FIRST_FRAME_INTERACTIVE'),
    },
    account: {
      inputToCartReady: metric(accounts, 'INPUT_RECEIVED', 'CART_LOAD_END'),
      cartReadyToViewChange: metric(accounts, 'CART_LOAD_END', 'VIEW_CHANGE_REQUEST'),
      viewChangeToReactCommit: metric(accounts, 'VIEW_CHANGE_REQUEST', 'REACT_COMMIT_END'),
      reactCommitToFrameProxy: metric(accounts, 'REACT_COMMIT_END', 'FIRST_FRAME_VISIBLE'),
      frameProxyToInteractive: metric(accounts, 'FIRST_FRAME_VISIBLE', 'FIRST_FRAME_INTERACTIVE'),
      inputToInteractive: metric(accounts, 'INPUT_RECEIVED', 'FIRST_FRAME_INTERACTIVE'),
    } }));
} finally {
  socket.close();
}
