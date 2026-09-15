import WebSocket from 'ws';

const endpoint = process.env.CLIC_POS_CDP_URL || 'http://127.0.0.1:9222/json';
const args = process.argv.slice(2);
const requestedCycles = Number(args.find(argument => /^\d+$/.test(argument)) || 20);
const offline = args.includes('--offline');
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
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  };
  socket.on('message', onMessage);
  socket.send(JSON.stringify({ id, method, params }));
});

const measureInPage = async cyclesRequested => {
  const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const waitFor = async (predicate, timeoutMs = 3000) => {
    const startedAt = performance.now();
    while (!predicate()) {
      if (performance.now() - startedAt > timeoutMs) throw new Error('Timed out waiting for POS transition');
      await sleep(5);
    }
  };
  const percentile = (values, fraction) => {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
  };
  const visibleButton = text => [...document.querySelectorAll('button')]
    .find(button => button.innerText === text && button.getBoundingClientRect().width > 0);

  const monitor = window.__CLIC_POS_PERFORMANCE__;
  if (!monitor) throw new Error('CLIC POS interaction monitor is unavailable');
  monitor.clear();

  const productNode = [...document.querySelectorAll('*')]
    .find(element => element.children.length === 0 && element.textContent?.trim() === 'Roller Ball Pen');
  const persistentHost = document.querySelector('[data-pos-persistent-host]');
  const cycles = [];

  for (let index = 0; index < cyclesRequested; index++) {
    await sleep(250);
    const openStartedAt = performance.now();
    const tablesButton = visibleButton('MESAS');
    if (!tablesButton) throw new Error(`MESAS button missing on cycle ${index + 1}`);
    tablesButton.click();
    await waitFor(() => document.querySelector('[data-table-map-overlay]'));
    const openMs = performance.now() - openStartedAt;

    await sleep(250);
    performance.clearResourceTimings();
    const closeButton = visibleButton('Cerrar');
    if (!closeButton) throw new Error(`Cerrar button missing on cycle ${index + 1}`);
    closeButton.click();
    await waitFor(() => {
      const matchingTraces = monitor.getTraces().filter(candidate => candidate.operation === 'CLOSE_TABLE_MAP');
      const trace = matchingTraces[matchingTraces.length - 1];
      return !document.querySelector('[data-table-map-overlay]')
        && trace?.stages?.FIRST_FRAME_INTERACTIVE !== undefined;
    });
    const matchingTraces = monitor.getTraces().filter(candidate => candidate.operation === 'CLOSE_TABLE_MAP');
    const trace = matchingTraces[matchingTraces.length - 1];
    const currentProductNode = [...document.querySelectorAll('*')]
      .find(element => element.children.length === 0 && element.textContent?.trim() === 'Roller Ball Pen');
    cycles.push({
      cycle: index + 1,
      openMs,
      handlerMs: trace.durations.handler,
      visualAckMs: trace.stages.VISUAL_ACK - trace.startedAt,
      navigationMs: trace.durations.navigation,
      tableMapUnmountMs: trace.durations.tableMapUnmount,
      posUpdateMs: trace.durations.posUpdate,
      visibleMs: trace.durations.inputToVisible,
      interactiveMs: trace.durations.inputToInteractive,
      longTasks: trace.longTasks,
      renderCount: trace.renderCount,
      resources: performance.getEntriesByType('resource').length,
      hostPreserved: persistentHost === document.querySelector('[data-pos-persistent-host]'),
      catalogNodePreserved: productNode === currentProductNode,
    });
  }

  return {
    cycles,
    summary: {
      samples: cycles.length,
      openP50Ms: percentile(cycles.map(cycle => cycle.openMs), 0.5),
      openP95Ms: percentile(cycles.map(cycle => cycle.openMs), 0.95),
      handlerP95Ms: percentile(cycles.map(cycle => cycle.handlerMs), 0.95),
      visualAckP95Ms: percentile(cycles.map(cycle => cycle.visualAckMs), 0.95),
      visibleP50Ms: percentile(cycles.map(cycle => cycle.visibleMs), 0.5),
      visibleP95Ms: percentile(cycles.map(cycle => cycle.visibleMs), 0.95),
      interactiveP50Ms: percentile(cycles.map(cycle => cycle.interactiveMs), 0.5),
      interactiveP95Ms: percentile(cycles.map(cycle => cycle.interactiveMs), 0.95),
      longestLongTaskMs: Math.max(0, ...cycles.flatMap(cycle => cycle.longTasks.map(task => task.durationMs))),
      totalResources: cycles.reduce((sum, cycle) => sum + cycle.resources, 0),
      hostPreserved: cycles.every(cycle => cycle.hostPreserved),
      catalogNodePreserved: cycles.every(cycle => cycle.catalogNodePreserved),
    },
  };
};

try {
  if (offline) {
    await call('Network.enable');
    await call('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
  }
  const result = await call('Runtime.evaluate', {
    expression: `(${measureInPage.toString()})(${JSON.stringify(requestedCycles)})`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  process.stdout.write(`${JSON.stringify({ scenario: offline ? 'sync-transport-offline' : 'sync-active', ...result.result.value }, null, 2)}\n`);
} finally {
  if (offline) {
    await call('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
  }
  socket.close();
}
