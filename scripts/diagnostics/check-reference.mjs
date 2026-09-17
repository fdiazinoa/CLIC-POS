#!/usr/bin/env node
// Read-only, bounded preflight. Never arms, launches or mutates the POS.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const checkerRepository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function canonicalPath(value) {
  let existing = path.resolve(value), suffix = [];
  while (!fs.existsSync(existing)) { suffix.unshift(path.basename(existing)); existing = path.dirname(existing); }
  return path.join(fs.realpathSync(existing), ...suffix);
}

const modes = ['reference', 'diagnostic', 'focused'];
const types = ['undefined', 'function', 'object', 'boolean', 'number', 'string', 'symbol', 'bigint'];
export function safeResult(value, mode) {
  const result = { mode, zone: types.includes(value?.zone) ? value.zone : 'unexpected',
    nativeActive: value?.nativeActive === true ? true : value?.nativeActive === false ? false : undefined,
    diagnosticApi: types.includes(value?.diagnosticApi) ? value.diagnosticApi : 'unexpected',
    origin: value?.origin === 'https://localhost' ? 'https://localhost' : 'unexpected',
    focusedMethods: value?.focusedMethods === true,
    clockMs: Number.isFinite(value?.clockMs) && value.clockMs >= 0 ? value.clockMs : undefined,
    timeOrigin: Number.isFinite(value?.timeOrigin) && value.timeOrigin > 0 ? value.timeOrigin : undefined };
  const reference = result.zone === 'undefined' && result.nativeActive === false && result.diagnosticApi === 'undefined';
  result.valid = result.origin === 'https://localhost' && (mode === 'reference' ? reference : mode === 'diagnostic'
    ? result.zone === 'function' && result.nativeActive === true && result.diagnosticApi === 'object'
    : reference && result.focusedMethods && result.clockMs !== undefined && result.timeOrigin !== undefined);
  return result;
}
export function writeExternalReport(out, result, roots) {
  const target = path.resolve(out);
  const actual = path.join(canonicalPath(path.dirname(target)), path.basename(target));
  const worktrees = roots ?? execFileSync('git', ['worktree', 'list', '--porcelain'], { encoding: 'utf8', cwd: checkerRepository })
    .split('\n').filter(line => line.startsWith('worktree ')).map(line => line.slice(9));
  // Git may retain prunable historical paths. Protect their reserved roots too,
  // resolving existing ancestors without pruning or mutating repository metadata.
  if (worktrees.some(root => { const real = canonicalPath(root); return actual === real || actual.startsWith(real + path.sep); }) || fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw Error('Report must be external and not a symlink');
  // wx prevents replacement, including a dangling symlink or a raced target.
  fs.mkdirSync(path.dirname(actual), { recursive: true });
  fs.writeFileSync(actual, JSON.stringify(result, null, 2), { flag: 'wx' });
}
export async function runPreflight(endpoint, mode, { timeoutMs = 10000, fetchImpl = fetch, WebSocketImpl = WebSocket } = {}) {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint || '') || !modes.includes(mode) || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 10000) throw Error('Invalid preflight arguments');
  const controller = new AbortController();
  const fetchTimer = setTimeout(() => controller.abort(), timeoutMs);
  let tabs;
  try {
    const response = await fetchImpl(endpoint + '/json', { signal: controller.signal, redirect: 'error' });
    if (!response.ok) throw Error('CDP inventory unavailable');
    tabs = await response.json();
  } catch { throw Error('CDP inventory failed or timed out'); }
  finally { clearTimeout(fetchTimer); }
  const tab = Array.isArray(tabs) && tabs.find(item => {
    try { return item.type === 'page' && new URL(item.url).origin === 'https://localhost'; } catch { return false; }
  });
  if (!tab) throw Error('Expected exact POS WebView missing');
  let transport;
  try { transport = new URL(tab.webSocketDebuggerUrl); } catch { throw Error('Invalid CDP transport'); }
  if (transport.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(transport.hostname) || transport.port !== new URL(endpoint).port || transport.username || transport.password || transport.hash || transport.search) throw Error('CDP transport must use the same loopback endpoint');
  transport.hostname = '127.0.0.1'; // Normalize a DevTools localhost alias, never use DNS.
  const ws = new WebSocketImpl(transport.href);
  const timers = new Set();
  const bounded = (install, label) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { timers.delete(timer); reject(Error(label)); }, timeoutMs);
    timers.add(timer);
    const finish = (value, failed = false) => { clearTimeout(timer); timers.delete(timer); failed ? reject(Error(label)) : resolve(value); };
    try { install(finish); } catch { finish(undefined, true); }
  });
  try {
    await bounded(finish => { ws.onopen = () => finish(); ws.onerror = () => finish(undefined, true); ws.onclose = () => finish(undefined, true); }, 'CDP open failed or timed out');
    const value = await bounded(finish => {
      ws.onerror = ws.onclose = () => finish(undefined, true);
      ws.onmessage = ({ data }) => {
        let message;
        try { message = JSON.parse(data); } catch { finish(undefined, true); return; }
        if (message.id !== 1) return;
        if (message.error || message.result?.exceptionDetails || !message.result?.result) finish(undefined, true);
        else finish(message.result.result.value);
      };
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { returnByValue: true,
        expression: '({zone:typeof globalThis.Zone,nativeActive:globalThis.POSDiagnostics?.enabled(),diagnosticApi:typeof globalThis.__POS_DIAGNOSTICS__,origin:location.origin,focusedMethods:typeof globalThis.__CLIC_POS_SCANNER_FOCUS__==="object"&&["startCapture","arm","disarm","snapshot","cleanup"].every(k=>typeof globalThis.__CLIC_POS_SCANNER_FOCUS__[k]==="function"),clockMs:performance.now(),timeOrigin:performance.timeOrigin})' } }));
    }, 'CDP evaluation failed or timed out');
    return safeResult(value, mode);
  } finally {
    for (const timer of timers) clearTimeout(timer);
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    ws.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [endpoint, mode, out] = process.argv.slice(2);
  if (!out) throw Error('check-reference.mjs http://127.0.0.1:PORT reference|diagnostic|focused EXTERNAL-NEW.json');
  const result = await runPreflight(endpoint, mode);
  writeExternalReport(out, result);
  if (!result.valid) throw Error('Observer mode mismatch; do not run comparison');
  console.log(out);
}
