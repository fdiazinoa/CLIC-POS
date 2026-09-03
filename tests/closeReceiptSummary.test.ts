import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildCloseTaxSummary, getCloseReceiptSummary, closeTaxLabel } from '../utils/closeReceiptSummary';
import { buildServiceTypeReport } from '../utils/orderServiceType';
import { buildEscPosZReportPayload } from '../services/printer/EscPosFormatter';
import { generateZReportReceipt } from '../services/printer/templates/ZReportReceipt';

const transactions: any[] = [
  { id: 'local', serviceType: 'DINE_IN', total: 5000, taxAmount: 720,
    taxBreakdown: [{ name: 'ITBIS', rate: .18, amount: 720 }], serviceChargeAmount: 400,
    serviceTaxPolicySnapshot: { legalTip: { percentage: 10 } } },
  { id: 'takeout', displayId: 'TCK-DETAIL-ONLY', serviceType: 'TAKEOUT', total: 1000, taxAmount: 152.54,
    taxBreakdown: [{ name: 'ITBIS 18%', rate: 18, amount: 152.54 }] },
  { id: 'delivery', serviceType: 'DELIVERY', total: 7500, taxAmount: 900,
    taxBreakdown: [{ name: 'ITBIS', rate: .18, amount: 900 }] },
];
function report(): any {
  const service = buildServiceTypeReport(transactions);
  return { id: 'Z-test', sequenceNumber: 'Z-test', terminalId: 't1', closedAt: '2026-09-02T20:00:00Z',
    closedByUserName: 'QA', baseCurrency: 'DOP', totalsByMethod: { CASH: 13500 },
    cashExpected: { DOP: 13500 }, cashCounted: { DOP: 13500 }, cashDiscrepancy: { DOP: 0 },
    transactionCount: 3, stats: { netSales: 13500, grossSales: 13500 },
    serviceTypeSummary: service.summary, serviceTypeTransactions: service.transactions,
    closeTaxSummary: buildCloseTaxSummary(transactions), enabledSections: ['TAX_SUMMARY'],
  };
}
const config: any = { companyInfo: { name: 'QA' }, currencies: [{ code: 'DOP', symbol: 'RD$' }], terminals: [] };

test('consolidates stored taxes and legal tip without applying percentages to the close total', () => {
  const summary = getCloseReceiptSummary(report());
  assert.deepEqual(summary.services.map(line => [line.label, line.amount]), [['En local',5000],['Para llevar',1000],['Delivery',7500]]);
  assert.equal(summary.total, 13500);
  assert.deepEqual(summary.taxes, [{ name:'ITBIS',rate:18,amount:1772.54 }, { name:'Propina legal',rate:10,amount:400 }]);
});

test('different rates/concepts stay separate; legal tip configured as a tax stays visible', () => {
  const lines = buildCloseTaxSummary([{ taxBreakdown: [
    { name:'ITBIS',rate:18,amount:18 }, { name:'ITBIS',rate:16,amount:16 },
    { name:'10 % de ley',rate:10,amount:10 }, { name:'Impuesto selectivo',rate:18,amount:5 },
  ], serviceChargeAmount:0 } as any]);
  assert.equal(lines.length,4);
  assert.ok(lines.some(line => closeTaxLabel(line) === 'Propina legal 10%' && line.amount === 10));
  assert.equal(lines.reduce((sum,line) => sum+line.amount,0),49);
});

test('missing historical detail never fabricates 18% or 10% rates', () => {
  const summary = buildCloseTaxSummary([{taxAmount:33,serviceChargeAmount:10} as any]);
  assert.deepEqual(summary.map(closeTaxLabel), ['Impuestos sin desglose','Propina legal']);
  const legacy = report(); delete legacy.closeTaxSummary;
  const taxes = getCloseReceiptSummary(legacy).taxes;
  assert.ok(taxes.every(line => line.rate === undefined));
  assert.equal(taxes[0].amount,1772.54);
});

test('recovers a missing header breakdown from reconciled persisted line fiscal amounts', () => {
  const summary = buildCloseTaxSummary([{
    taxAmount: 1159.32,
    items: [
      { taxAmount: 610.17, taxRate: .18 },
      { taxAmount: 549.15, taxRate: .18 },
    ],
    serviceChargeAmount: 644.07,
    serviceTaxPolicySnapshot: { legalTip: { percentage: 10 } },
  } as any]);

  assert.deepEqual(summary, [
    { name: 'Impuesto', rate: 18, amount: 1159.32 },
    { name: 'Propina legal', rate: 10, amount: 644.07 },
  ]);
});

test('does not recover line rates when their persisted amounts do not reconcile', () => {
  const summary = buildCloseTaxSummary([{
    taxAmount: 100,
    items: [{ taxAmount: 18, taxRate: .18 }],
  } as any]);
  assert.deepEqual(summary.map(closeTaxLabel), ['Impuestos sin desglose']);
});

test('refunds and voids do not add taxes to the service sales summary; no voluntary tips', () => {
  assert.deepEqual(buildCloseTaxSummary([
    {documentType:'REFUND',taxAmount:18}, {documentType:'VOID',taxAmount:18}, {ncfType:'B04',taxAmount:18},
    {taxAmount:0,voluntaryTipAmount:10},
  ] as any), []);
});

test('HTML and ESC/POS show one compact service and tax section, no ticket list', () => {
  const data = report();
  const original = JSON.stringify(data);
  const html = generateZReportReceipt(data, [], config);
  const esc = Buffer.from(buildEscPosZReportPayload(data, [], config)!, 'base64').toString('latin1');
  for (const text of [html,esc]) {
    for (const label of ['En local','Para llevar','Delivery','Total por servicio','ITBIS 18%','Propina legal 10%']) {
      assert.equal(text.split(label).length - 1, 1, label);
    }
    assert.doesNotMatch(text, /TCK-DETAIL-ONLY|PARA LLEVAR \/ DELIVERY|Consumo en mesa/);
    assert.equal(text.split('IMPUESTOS Y PROPINA').length-1,1);
    assert.match(text,/no sumar al total/);
  }
  assert.equal(JSON.stringify(data),original);
});

test('snapshot survives roundtrip/reprint and takes priority over live config and legacy detail', () => {
  const data = JSON.parse(JSON.stringify(report()));
  data.reportDetails = { taxSummary: [{taxName:'CHANGED',rate:99,taxAmount:99999}] };
  assert.doesNotMatch(generateZReportReceipt(data, [], {...config,taxRate:.99}),/CHANGED|99999/);
  assert.deepEqual(getCloseReceiptSummary(data),getCloseReceiptSummary(data));
  data.closeTaxSummary = [];
  assert.doesNotMatch(generateZReportReceipt(data, [], config),/CHANGED|99999/);
  assert.doesNotMatch(Buffer.from(buildEscPosZReportPayload(data, [], config)!, 'base64').toString('latin1'),/CHANGED|99999/);
});

test('X y Z persisten el mismo snapshot y no imprimen un borrador previo', () => {
  const app = readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
  assert.equal(app.match(/closeTaxSummary: buildCloseTaxSummary\(terminalTransactions\)/g)?.length,2);
  const dashboard = readFileSync(new URL('../components/ZReportDashboard.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(dashboard,/tempReport|\.printZReport\(/);
});

test('checkout persists the calculated tax breakdown for regular and split sales', () => {
  const pos = readFileSync(new URL('../components/POSInterface.tsx',import.meta.url),'utf8');
  const transactionService = readFileSync(new URL('../services/transactionService.ts',import.meta.url),'utf8');
  assert.match(pos, /taxBreakdown: isRefundOnly \? undefined : taxBreakdown/);
  assert.match(pos, /taxBreakdown: saleTaxBreakdown/);
  assert.match(transactionService, /taxBreakdown: data\.taxBreakdown/);
});
