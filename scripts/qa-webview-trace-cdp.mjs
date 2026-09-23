import WebSocket from 'ws';

const port = Number(process.env.CLIC_POS_CDP_PORT || 9229);
const direction = process.env.CLIC_POS_DIRECTION || 'toTables';
const page = (await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json()))
  .find(candidate => candidate.type === 'page' && candidate.url?.includes('localhost'));
if (!page) throw new Error('CLIC-POS WebView not found');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
let nextId = 0;
const pending = new Map();
let completeTrace;
const completed = new Promise(resolve => { completeTrace = resolve; });
socket.on('message', raw => {
  const message = JSON.parse(raw.toString());
  if (message.method === 'Tracing.tracingComplete') completeTrace(message.params);
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
const tap = async label => {
  const point = await evaluate(`(() => {
    const node = [...document.querySelectorAll('button')].find(button => button.innerText.trim() === ${JSON.stringify(label)}
      && button.getBoundingClientRect().width > 0 && getComputedStyle(button).visibility === 'visible');
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  if (!point) throw new Error(`Button not visible: ${label}`);
  await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
  await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const destination = direction === 'toTables' ? 'data-table-map-persistent-host' : 'data-pos-persistent-host';
const label = direction === 'toTables' ? 'MESAS' : 'Cerrar';

try {
  await call('Tracing.start', {
    categories: 'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing,cc,disabled-by-default-cc.debug',
    transferMode: 'ReturnAsStream',
  });
  await wait(100);
  await tap(label);
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (await evaluate(`getComputedStyle(document.querySelector('[${destination}]')).visibility === 'visible'`)) break;
    await wait(35);
  }
  await wait(700);
  await call('Tracing.end');
  const { stream } = await completed;
  let traceJson = '';
  for (;;) {
    const chunk = await call('IO.read', { handle: stream, size: 1024 * 1024 });
    traceJson += chunk.data;
    if (chunk.eof) break;
  }
  await call('IO.close', { handle: stream });
  const events = JSON.parse(traceJson).traceEvents || [];
  const marks = events.filter(event => /SALES_TO_TABLES|TABLES_TO_SALES|CLIC_TABLE_QA/.test(event.name || ''))
    .map(event => ({ name: event.name, ph: event.ph, ts: event.ts, dur: event.dur }));
  const prefix = direction === 'toTables' ? 'SALES_TO_TABLES' : 'TABLES_TO_SALES';
  const windowStart = marks.find(mark => mark.name === `${prefix}_INPUT`)?.ts;
  const windowEnd = marks.find(mark => mark.name === `${prefix}_VISIBLE`)?.ts;
  const summaries = new Map();
  for (const event of events) {
    if (event.ph !== 'X' || !Number.isFinite(event.dur)) continue;
    if (Number.isFinite(windowStart) && Number.isFinite(windowEnd)
      && (event.ts < windowStart || event.ts > windowEnd)) continue;
    const row = summaries.get(event.name) || { count: 0, totalMs: 0, maxMs: 0 };
    row.count += 1;
    row.totalMs += event.dur / 1000;
    row.maxMs = Math.max(row.maxMs, event.dur / 1000);
    summaries.set(event.name, row);
  }
  const wanted = /Style|Layout|Paint|Composite|DrawFrame|BeginFrame|UpdateLayer|Accessibility|Task|FunctionCall|EventDispatch|Commit/i;
  const top = [...summaries].filter(([name]) => wanted.test(name))
    .sort((a, b) => b[1].totalMs - a[1].totalMs).slice(0, 40)
    .map(([name, row]) => ({ name, count: row.count, totalMs: Math.round(row.totalMs * 10) / 10, maxMs: Math.round(row.maxMs * 10) / 10 }));
  const styleDetails = events.filter(event => event.name === 'UpdateLayoutTree'
    && event.ph === 'X' && (!Number.isFinite(windowStart) || (event.ts >= windowStart && event.ts <= windowEnd)))
    .map(event => ({ durationMs: Math.round(event.dur / 100) / 10, args: event.args }));
  console.log(JSON.stringify({ direction, eventCount: events.length, traceBytes: traceJson.length,
    inputToVisibleMarkMs: Number.isFinite(windowStart) && Number.isFinite(windowEnd) ? Math.round((windowEnd - windowStart) / 100) / 10 : null,
    top, styleDetails, marks }));
} finally {
  socket.close();
}
