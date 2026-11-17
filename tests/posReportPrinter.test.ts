import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { buildPosReportDocument } from '../utils/posReports';

const document = buildPosReportDocument('SALES', { transactions: [], movements: [], reports: [] },
  { start: '2026-11-01', end: '2026-11-17', terminalId: '', productLimit: 10 },
  { companyInfo: { name: 'Café & Compañía' }, currencies: [], terminals: [] } as any, new Date('2026-11-17T12:00:00Z'));

test('query-report transport uses real native bytes or nonempty HTML, without changing contracts', async () => {
  const env = { native: true, android: true, rawResult: true, jobs: [] as any[] };
  (globalThis as any).__queryPrintTest = env;
  const mocks: Record<string, string> = {
    './PrintFeedback': 'exports.runPrintTask=(_key,_title,action)=>action();',
    './PrintRuntime': 'exports.shouldSuppressBrowserPrintFallback=()=>globalThis.__queryPrintTest.android;',
    './BrowserPrint': 'exports.notifyBrowserPrint=()=>{};',
    './PrintRouterService': 'exports.PrintRouterService={routeAndPrintEscPos:async job=>{globalThis.__queryPrintTest.jobs.push({type:"raw",...job});return globalThis.__queryPrintTest.rawResult;},routeAndPrintHtml:async job=>{globalThis.__queryPrintTest.jobs.push({type:"html",...job});return true;}};',
  };
  try {
    const result = await build({ entryPoints: ['services/printer/PosReportPrinter.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', plugins: [{ name: 'query-print', setup(b) {
      b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path] }));
    } }] });
    const module = { exports: {} as any };
    new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
    const config = { terminals: [], availablePrinters: [] };
    assert.equal(await module.exports.printPosReport(document, config, 'box'), true);
    assert.equal(env.jobs.length, 1);
    assert.equal(env.jobs[0].type, 'raw');
    assert.equal(env.jobs[0].terminalId, 'box');
    assert.equal(env.jobs[0].jobType, 'TICKET');
    assert.equal(env.jobs[0].role, 'TICKET');
    assert.equal(env.jobs[0].copies, 1);
    assert.ok(Buffer.from(env.jobs[0].escPosBase64, 'base64').includes(Buffer.from([27, 77, 0])));

    env.jobs = []; env.rawResult = false;
    assert.equal(await module.exports.printPosReport(document, config, 'box'), false);
    assert.deepEqual(env.jobs.map(job => job.type), ['raw']); // no Android HTML-to-text fallback

    env.jobs = []; env.native = false; env.android = false;
    assert.equal(await module.exports.printPosReport(document, config, 'box'), true);
    assert.deepEqual(env.jobs.map(job => job.type), ['html']); // local agent expects HTML, not empty raw HTML
    assert.ok(env.jobs[0].html.includes('Café &amp; Compañía'));
    assert.ok(env.jobs[0].html.includes('width:72mm'));

    env.jobs = []; env.native = true;
    assert.equal(await module.exports.printPosReport(document, config, 'box'), true);
    assert.deepEqual(env.jobs.map(job => job.type), ['html']);

    env.jobs = [];
    const bad = { ...document, blocks: [{ type: 'pair', label: 'Código', value: 'X'.repeat(60) }] };
    await assert.rejects(module.exports.printPosReport(bad, config, 'box'), /supera el ancho/);
    assert.equal(env.jobs.length, 0);
  } finally { delete (globalThis as any).__queryPrintTest; }
});
