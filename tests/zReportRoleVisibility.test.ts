import assert from 'node:assert/strict';
import test from 'node:test';
import type { BusinessConfig, ZReport, ZReportModule } from '../types';
import { normalizeErpRole } from '../utils/erpSecuritySnapshot';
import { generateZReportReceipt } from '../services/printer/templates/ZReportReceipt';
import { buildEscPosZReportPayload } from '../services/printer/EscPosFormatter';

const report: ZReport = {
  id: 'z1', terminalId: 'T1', sequenceNumber: 'Z0001', openedAt: '2026-11-15T10:00:00Z', closedAt: '2026-11-15T12:00:00Z',
  closedByUserId: 'u1', closedByUserName: 'Ana', baseCurrency: 'DOP', totalsByMethod: { CASH: 100 },
  cashExpected: { DOP: 100 }, cashCounted: { DOP: 100 }, cashDiscrepancy: { DOP: 0 },
  cashSales: 100, cashIn: 0, cashOut: 0, transactionCount: 1, notes: '',
  stats: { grossSales: 100, netSales: 100, averageTicket: 100, itemsPerSale: 1,
    peakHour: '10:00 - 11:00', topProduct: null, returnsCount: 0, returnsTotal: 0,
    discountsTotal: 0, advancementsTotal: 0, collectionsTotal: 0 },
};
const config = { companyInfo: { name: 'CLIC' }, currencySymbol: 'RD$', terminals: [] } as unknown as BusinessConfig;
const labels: Record<ZReportModule, RegExp> = {
  FINANCIAL: /RESUMEN FINANCIERO/, PAYMENTS: /FORMAS DE PAGO/, CASH_DETAILS: /ARQUEO DE CAJA/,
  KPIS: /ESTADÍSTICAS DEL TURNO/, AUDIT: /AUDITORÍA/,
};

for (const reportType of ['X', 'Z']) {
  test(`${reportType}: normalized role restrictions reach HTML sections and existing ESC/POS sections`, () => {
    const data = { ...report, reportType };
    const visibleHtml = generateZReportReceipt(data, [], config);
    const visibleEsc = Buffer.from(buildEscPosZReportPayload(data, [], config)!, 'base64').toString('latin1');
    for (const module of Object.keys(labels) as ZReportModule[]) {
      const hidden = normalizeErpRole({ id: 'CUSTOM', permissions: [], zReportConfig: { hiddenModules: [module] } })!.zReportConfig!.hiddenModules;
      const html = generateZReportReceipt(data, hidden, config);
      assert.match(visibleHtml, labels[module]);
      assert.doesNotMatch(html, labels[module]);
      for (const other of Object.keys(labels) as ZReportModule[]) {
        if (other !== module) assert.match(html, labels[other]);
      }
      if (module !== 'KPIS') {
        const escLabel = module === 'AUDIT' ? /AUDITORIA/ : labels[module];
        assert.match(visibleEsc, escLabel);
        const esc = Buffer.from(buildEscPosZReportPayload(data, hidden, config)!, 'base64').toString('latin1');
        assert.doesNotMatch(esc, escLabel);
      }
    }
    // ESC/POS currently has no KPI block; this test does not add one or claim hardware coverage.
    assert.doesNotMatch(visibleEsc, /ESTADISTICAS DEL TURNO|Ticket Promedio/);
  });
}
