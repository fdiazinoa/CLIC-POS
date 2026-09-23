import WebSocket from 'ws';

const port = Number(process.env.CLIC_POS_CDP_PORT || 9229);
const search = process.env.CLIC_POS_SEARCH || 'Veggie';
const addSearchedProduct = process.env.CLIC_POS_ADD_SEARCH_RESULT === 'true';
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
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const snapshot = () => evaluate(`(() => {
  const catalog = document.querySelector('[data-catalog-card-count]');
  const viewport = catalog?.parentElement;
  const cards = [...document.querySelectorAll('.pos-product-card')];
  return {
    total: Number(catalog?.dataset.catalogProductCount || 0),
    mounted: cards.length,
    nodes: document.getElementsByTagName('*').length,
    scrollTop: viewport?.scrollTop || 0,
    maxScroll: viewport ? viewport.scrollHeight - viewport.clientHeight : 0,
    names: cards.map(card => card.querySelector('.pos-product-name')?.textContent || ''),
    intersectsViewport: cards.some(card => {
      const cardRect = card.getBoundingClientRect();
      const viewportRect = viewport?.getBoundingClientRect();
      return viewportRect && cardRect.bottom > viewportRect.top && cardRect.top < viewportRect.bottom;
    }),
  };
})()`);
try {
  const initial = await snapshot();
  const scrollSamples = [];
  for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
    await evaluate(`(() => {
      const viewport = document.querySelector('[data-catalog-card-count]')?.parentElement;
      if (!viewport) return false;
      viewport.scrollTop = (viewport.scrollHeight - viewport.clientHeight) * ${fraction};
      return true;
    })()`);
    await delay(150);
    const current = await snapshot();
    scrollSamples.push({ fraction, ...current });
  }
  await evaluate(`document.querySelector('input[placeholder="Buscar..."]')?.focus(); true`);
  await call('Input.insertText', { text: search });
  await delay(250);
  const searchResult = await snapshot();
  let cartAfterAdd = null;
  if (addSearchedProduct) {
    await evaluate(`document.querySelector('.pos-product-card')?.click(); true`);
    await delay(250);
    cartAfterAdd = await evaluate(`document.body.innerText.slice(-600)`);
  }
  await evaluate(`document.querySelector('button[aria-label="Limpiar búsqueda"]')?.click(); true`);
  await delay(150);
  const cleared = await snapshot();
  console.log(JSON.stringify({ initial, scrollSamples, search, searchResult, cartAfterAdd, cleared }));
} finally {
  socket.close();
}
