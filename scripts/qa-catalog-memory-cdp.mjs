import WebSocket from 'ws';

const port = Number(process.env.CLIC_POS_CDP_PORT || 9229);
const cycles = Number(process.env.CLIC_POS_CYCLES || 50);
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
const snapshot = async () => {
  await call('HeapProfiler.collectGarbage');
  const heap = await call('Runtime.getHeapUsage');
  const dom = await evaluate(`({
    nodes: document.getElementsByTagName('*').length,
    cards: document.querySelectorAll('.pos-product-card').length,
    total: Number(document.querySelector('[data-catalog-product-count]')?.dataset.catalogProductCount || 0),
  })`);
  return { ...heap, ...dom };
};
try {
  const before = await snapshot();
  await evaluate(`(async () => {
    const viewport = document.querySelector('[data-catalog-card-count]')?.parentElement;
    if (!viewport) throw new Error('catalog viewport missing');
    for (let i = 0; i < ${cycles}; i += 1) {
      viewport.scrollTop = viewport.scrollHeight;
      await new Promise(resolve => setTimeout(resolve, 35));
      viewport.scrollTop = 0;
      await new Promise(resolve => setTimeout(resolve, 35));
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  })()`);
  const after = await snapshot();
  console.log(JSON.stringify({ cycles, before, after }));
} finally {
  socket.close();
}
