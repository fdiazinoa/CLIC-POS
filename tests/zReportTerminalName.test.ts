import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEscPosZReportPayload } from '../services/printer/EscPosFormatter';
import { generateZReportReceipt } from '../services/printer/templates/ZReportReceipt';

const report = {
  id: 'z-1',
  terminalId: 'terminal-internal-uuid',
  sequenceNumber: 'Z-0001',
  openedAt: '2026-08-18T10:00:00.000Z',
  closedAt: '2026-08-18T12:00:00.000Z',
  closedByUserId: 'user-1',
  closedByUserName: 'Jonas',
  baseCurrency: 'DOP',
  totalsByMethod: {},
  cashExpected: {},
  cashCounted: {},
  cashDiscrepancy: {},
  cashSales: 0,
  cashIn: 0,
  cashOut: 0,
  transactionCount: 0,
  notes: '',
} as any;

const config = {
  companyInfo: { name: 'CLIC POS' },
  currencySymbol: 'RD$',
  terminals: [{
    id: 'local-terminal',
    config: {
      terminalName: 'Caja Principal',
      erpTerminalId: 'terminal-internal-uuid',
    },
  }],
} as any;

test('el cierre Z ESC/POS usa el nombre configurado y no el identificador interno', () => {
  const payload = buildEscPosZReportPayload(report, [], config);
  assert.ok(payload);
  const decoded = Buffer.from(payload!, 'base64').toString('latin1');
  assert.match(decoded, /Caja Principal/);
  assert.doesNotMatch(decoded, /terminal-internal-uuid/);
});

test('el cierre Z HTML usa el mismo nombre configurado', () => {
  const html = generateZReportReceipt(report, [], config);
  assert.match(html, /Caja Principal/);
  assert.doesNotMatch(html, /terminal-internal-uuid/);
});
