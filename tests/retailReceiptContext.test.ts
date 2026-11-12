import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildEscPosTicketPayload } from '../services/printer/EscPosFormatter';
import { receiptSaleOperator, receiptUsesRestaurantService } from '../utils/receiptSaleContext';

const config = (vertical = 'RETAIL', viewMode?: string): any => ({ vertical,
  companyInfo: { name: 'Absolute', rnc: '', phone: '', address: '' }, currencySymbol: 'RD$',
  taxes: [], currencies: [], receiptConfig: { showQr: false },
  terminals: [{ id: 'T', config: { ux: { viewMode }, operational: { vertical_negocio: vertical } } }],
});
const sale: any = { id: 'sale', displayId: 'TCK1', terminalId: 'T', date: '2026-11-11T12:00:00Z',
  userId: 'original', userName: 'Ana Original', serviceType: 'DINE_IN', total: 100,
  items: [{ id: 'P', cartId: 'L', name: 'Articulo', quantity: 1, price: 100 }], payments: [] };
const printed = (configuration: any, tx = sale) => Buffer.from(buildEscPosTicketPayload(tx, configuration, [{ id: 'current', name: 'Otro cajero' }])!, 'base64').toString('latin1');

for (const [ncfType, label] of [['E31', 'CREDITO FISCAL'], ['E32', 'CONSUMO FINAL']]) {
  test(`native receipt names ${ncfType} without unsigned representation notice`, () => {
    const tx = { ...sale, ncfType, ncf: `${ncfType}0000000123` };
    const configuration = config();
    configuration.receiptConfig.showQr = true;
    const output = printed(configuration, tx);
    assert.match(output, new RegExp(label));
    assert.ok(output.includes(tx.ncf));
    assert.doesNotMatch(output, /Representacion fiscal firmada aun no disponible/);
    assert.ok(!output.split(/\r?\n/).includes(ncfType));
  });
}

test('Retail never prints restaurant service even when the stored sale defaults to DINE_IN', () => {
  const before = JSON.stringify(sale);
  assert.doesNotMatch(printed(config()), /Consumo en mesa|Tipo servicio/);
  assert.match(printed(config()), /Cajero: Ana Original/);
  assert.doesNotMatch(printed(config()), /Otro cajero/);
  assert.equal(JSON.stringify(sale), before);
});
for (const mode of ['RETAIL', 'retail mode', 'POS', 'STANDARD', 'SUPERMARKET']) test(`explicit ${mode} view overrides a shared restaurant vertical`, () => {
  assert.equal(receiptUsesRestaurantService(config('RESTAURANT', mode), 'T'), false);
  assert.doesNotMatch(printed(config('RESTAURANT', mode)), /Tipo servicio/);
});
for (const [serviceType, label] of [['DINE_IN', 'Consumo en mesa'], ['TAKEOUT', 'Para llevar'], ['DELIVERY', 'Delivery']]) test(`restaurant retains ${serviceType} on its receipt`, () => {
  assert.match(printed(config('RESTAURANT'), { ...sale, serviceType }), new RegExp(`Tipo servicio: ${label}`));
});
test('a historical receipt without an operator does not borrow the current login', () => {
  assert.equal(receiptSaleOperator({ userName: ' ' }), 'No registrado');
  assert.match(printed(config(), { ...sale, userName: '' }), /Cajero: No registrado/);
});
test('a Retail terminal does not inherit restaurant service labels from a shared company', () => {
  const shared = config('RESTAURANT');
  shared.terminals[0].config.operational.vertical_negocio = 'RETAIL';
  assert.doesNotMatch(printed(shared), /Tipo servicio|Consumo en mesa/);
});

test('real HTML print path hides service in Retail and escapes the original operator', async () => {
  const { build } = await import('esbuild');
  const env = { html: '' };
  (globalThis as any).__retailReceiptTest = env;
  const mocks: Record<string, string> = {
    '../services/db': 'exports.dbAdapter={getDocument:async()=>null,getCollection:async()=>[]};',
    '../services/fiscal/FiscalPrintReadiness': 'exports.resolveFiscalPrintReadiness=async()=>undefined;',
    '../services/CheckoutPrintTracking': 'exports.trackCheckoutPrint=(_meta,action)=>action();',
    '../services/printer/PrintRuntime': 'exports.shouldSuppressBrowserPrintFallback=()=>false;',
    '../services/printer/PrintFeedback': 'exports.runPrintTask=(_key,_title,action)=>action();exports.PrintOutputError=Error;',
    '../services/printer/PrintRouterService': 'exports.PrintRouterService={routeAndPrintEscPos:async()=>false,routeAndPrintHtml:async job=>{globalThis.__retailReceiptTest.html=job.html;return true;}};',
  };
  try {
    const result = await build({ entryPoints: ['utils/printer.ts'], bundle: true, write: false,
      platform: 'node', format: 'cjs', define: { 'import.meta.env': '{}' }, plugins: [{ name: 'receipt-output', setup(b) {
        b.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: 'fixture' } : undefined);
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path] }));
      } }] });
    const module = { exports: {} as any };
    new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
    assert.equal(await module.exports.printTicket({ ...sale, userName: '<Ana & Original>' }, config()), true);
    assert.doesNotMatch(env.html, /Tipo de servicio:|Consumo en mesa/);
    assert.match(env.html, /Cajero: &lt;Ana &amp; Original&gt;/);
    for (const [ncfType, label] of [['E31', 'Crédito Fiscal'], ['E32', 'Consumo Final']]) {
      const configuration = config();
      configuration.receiptConfig.showQr = true;
      const tx = { ...sale, ncfType, ncf: `${ncfType}0000000123` };
      assert.equal(await module.exports.printTicket(tx, configuration), true);
      assert.ok(env.html.includes(label));
      assert.ok(env.html.includes(tx.ncf));
      assert.doesNotMatch(env.html, /Representación fiscal firmada aún no disponible/);
      assert.ok(!env.html.includes(`>${ncfType}</div>`));
    }
    assert.equal(await module.exports.printTicket(sale, config('RESTAURANT')), true);
    assert.match(env.html, /Tipo de servicio: Consumo en mesa/);
  } finally { delete (globalThis as any).__retailReceiptTest; }
});
