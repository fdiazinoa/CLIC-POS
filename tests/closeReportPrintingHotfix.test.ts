import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildEscPosZReportPayload } from '../services/printer/EscPosFormatter';
import { generateZReportReceipt } from '../services/printer/templates/ZReportReceipt';
import type { BusinessConfig, ZReport } from '../types';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const dashboardSource = readFileSync(new URL('../components/ZReportDashboard.tsx', import.meta.url), 'utf8');
const historySource = readFileSync(new URL('../components/ZReportHistory.tsx', import.meta.url), 'utf8');
const financeSource = readFileSync(new URL('../components/FinanceDashboard.tsx', import.meta.url), 'utf8');

const config = {
  companyInfo: { name: 'CLIC QA' },
  currencySymbol: 'RD$',
  currencies: [{ code: 'DOP', symbol: 'RD$', isBase: true }],
  terminals: [],
} as unknown as BusinessConfig;

const report = {
  id: 'z-hotfix',
  terminalId: 'T1',
  sequenceNumber: 'Z-000001',
  openedAt: '2026-09-03T08:00:00-04:00',
  closedAt: '2026-09-03T18:00:00-04:00',
  closedByUserId: 'u1',
  closedByUserName: 'Ana',
  baseCurrency: 'DOP',
  totalsByMethod: { CASH: 1000 },
  cashExpected: { DOP: 1000 },
  cashCounted: { DOP: 1000 },
  cashDiscrepancy: { DOP: 0 },
  cashSales: 1000,
  cashIn: 0,
  cashOut: 0,
  transactionCount: 1,
  notes: '',
  enabledSections: [],
  denominationBreakdown: {
    DOP: [{ denomination: 500, quantity: 2, total: 1000 }],
  },
} as ZReport;

test('el conteo por denominaciones siempre aparece en cierres X/Z impresos', () => {
  const html = generateZReportReceipt(report, [], config);
  const escPos = Buffer.from(buildEscPosZReportPayload(report, [], config)!, 'base64').toString('latin1');

  for (const output of [html, escPos]) {
    assert.match(output, /DESGLOSE DE MONEDA/);
    assert.match(output, /500 x 2/);
  }
});

test('el Z automático imprime el reporte definitivo después de guardarlo', () => {
  const start = appSource.indexOf('const handleZReport = async');
  const end = appSource.indexOf('// --- VIEW RENDERING LOGIC ---', start);
  const block = appSource.slice(start, end);
  const saveIndex = block.indexOf("await db.saveDocument('zReports', newZReport)");
  const printIndex = block.indexOf('ThermalPrinterService.printZReport(newZReport');

  assert.ok(saveIndex >= 0);
  assert.ok(printIndex > saveIndex);
  assert.doesNotMatch(dashboardSource, /PRE-CLOSE|ThermalPrinterService\.printZReport/);
});

test('los anexos completos quedan persistidos y la reimpresión aplica opciones actuales', () => {
  assert.ok((appSource.match(/buildCloseReportDetails\([^;]+ALL_CLOSE_REPORT_SECTIONS\)/gs) || []).length >= 2);
  assert.match(historySource, /resolveCloseReportSections\([\s\S]*?'Z'/);
  assert.match(historySource, /ALL_CLOSE_REPORT_SECTIONS/);
  assert.match(appSource, /resolveCloseReportSections\(config, printTerminal\?\.id \|\| report\.terminalId, currentUser\?\.id, 'X'\)/);
});

test('el flujo X solicita y conserva el conteo por denominaciones cuando está activo', () => {
  assert.match(financeSource, /setShowXCloseModal\(true\)/);
  assert.match(financeSource, /forceDenominationCount/);
  assert.match(financeSource, /denominationBreakdown: \{ \[currencyCode\]: denominationLines \}/);
  assert.match(appSource, /denominationBreakdown: reportData\?\.denominationBreakdown/);
  assert.match(appSource, /denomination_breakdown: reportData\?\.denominationBreakdown/);
});
