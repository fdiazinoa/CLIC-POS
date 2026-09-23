import WebSocket from 'ws';

const port = Number(process.env.CLIC_POS_CDP_PORT || 9229);
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
  const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result?.value;
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const state = () => evaluate(`(() => {
  const map = document.querySelector('[data-table-map-persistent-host]');
  const sales = document.querySelector('[data-pos-persistent-host]');
  const active = document.activeElement;
  return {
    modal: map?.getAttribute('aria-modal') === 'true',
    role: map?.getAttribute('role'),
    salesAriaHidden: sales?.getAttribute('aria-hidden'),
    focusInMap: Boolean(map?.contains(active)),
    activeLabel: active?.getAttribute('aria-label') || active?.innerText?.trim().slice(0, 50) || active?.tagName,
    scannerFocused: active?.dataset?.posScannerReceiver === 'true',
    barcodeTraces: window.__CLIC_POS_PERFORMANCE__?.getTraces().filter(trace => trace.operation === 'BARCODE_SCAN').length ?? null,
  };
})()`);
const tap = async label => {
  const point = await evaluate(`(() => {
    const source = document.querySelector(${JSON.stringify(label === 'MESAS' ? '[data-pos-persistent-host]' : '[data-table-map-persistent-host][aria-modal="true"]')});
    const button = [...(source?.querySelectorAll('button') || [])].find(candidate => candidate.innerText.trim() === ${JSON.stringify(label)});
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  if (!point) throw new Error(`Missing button ${label}`);
  await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
  await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
const key = async shift => {
  const params = { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: shift ? 8 : 0 };
  await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };

try {
  await call('Accessibility.enable');
  if ((await state()).modal) await tap('Cerrar');
  await wait(150);
  await tap('MESAS');
  await wait(200);
  const opened = await state();
  assert(opened.modal && opened.role === 'dialog' && opened.salesAriaHidden === 'true' && opened.focusInMap,
    `Modal boundary invalid: ${JSON.stringify(opened)}`);

  const focus = [];
  for (const shift of [...Array(8).fill(false), ...Array(8).fill(true)]) {
    await key(shift);
    const step = await state();
    focus.push({ shift, focusInMap: step.focusInMap, activeLabel: step.activeLabel });
    assert(step.focusInMap, `Focus escaped map on ${shift ? 'Shift+Tab' : 'Tab'}`);
  }

  const ax = await call('Accessibility.getFullAXTree');
  const exposedSalesProducts = (ax.nodes || []).filter(node => !node.ignored && /Agua/.test(String(node.name?.value || ''))).length;
  const accessibleDialog = (ax.nodes || []).some(node => !node.ignored && node.role?.value === 'dialog' && node.name?.value === 'Mesas');
  assert(accessibleDialog && exposedSalesProducts === 0,
    `Accessibility tree invalid: dialog=${accessibleDialog}, Agua=${exposedSalesProducts}`);

  await evaluate("window.dispatchEvent(new CustomEvent('barcodeScanned', { detail: { barcode: 'BEB-003' } })); true");
  await wait(100);
  const blockedScan = await state();
  assert(blockedScan.barcodeTraces === opened.barcodeTraces, 'Scanner event reached Venta behind Mesas');

  await tap('Cerrar');
  await wait(250);
  const closed = await state();
  assert(!closed.modal && closed.salesAriaHidden === null, `Modal did not release Venta: ${JSON.stringify(closed)}`);
  await evaluate("window.dispatchEvent(new CustomEvent('barcodeScanned', { detail: { barcode: 'BEB-003' } })); true");
  await wait(100);
  const resumed = await state();
  assert(resumed.barcodeTraces === blockedScan.barcodeTraces + 1, 'Scanner did not resume in Venta');
  console.log(JSON.stringify({ opened, focus, accessibility: { dialog: accessibleDialog, exposedSalesProducts },
    blockedScan, closed, resumed, result: 'PASS' }));
} finally {
  socket.close();
}
