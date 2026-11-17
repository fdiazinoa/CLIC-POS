import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPosReportDocument, buildPosReportText } from '../utils/posReports';
import { reportMoney, type PosReportDocument } from '../services/printer/PosReportDocument';
import { buildQueryReportEscPos, buildQueryReportHtml, encodeQueryReportText, layoutQueryReport, queryReportPlainText, QUERY_THERMAL_80MM, QUERY_THERMAL_80MM_48 } from '../services/printer/PosReportThermalLayout';

const config: any = { companyInfo: { name: 'Compañía Ñandú & Café' }, currencies: [{ code: 'DOP', isBase: true }], terminals: [], paymentMethods: [] };
const filters = { start: '2026-11-01', end: '2026-11-17', terminalId: '', productLimit: 10 };
const sale: any = { id: 's', displayId: 'T-001', date: '2026-11-17T12:30:00Z', userId: 'a', userName: 'José Muñoz', terminalId: 'local', status: 'COMPLETED', documentType: 'TICKET', total: 1234567.89, taxAmount: 100, discountAmount: 10,
  items: [{ id: 'a', name: 'Café orgánico con azúcar especial de origen y presentación familiar muy larga', price: 20, originalPrice: 25, quantity: 2.125 }], payments: [{ method: 'CASH', amount: 1234567.89, appliedAmount: 1234567.89, currencyCode: 'DOP' }] };
const source: any = { transactions: [sale, { ...sale, id: 'nc', displayId: 'NC-001', documentType: 'REFUND', total: -30, refundReason: 'Devolución de prueba', originalTransactionId: '00000000-1111-2222-3333-444444444444' }],
  movements: [{ id: 'm', type: 'IN', amount: 1234567890123.45, timestamp: sale.date, userName: sale.userName, reason: 'Fondo de caja para apertura extraordinaria con descripción larga', currencyCode: 'USD', terminalId: 'local' }], reports: [] };
const issuedAt = new Date('2026-11-17T13:00:00Z');
const kinds = ['SALES', 'PAYMENTS', 'PRODUCTS', 'CASHIERS', 'HOURS', 'ADJUSTMENTS', 'CASH'] as const;

for (const profile of [QUERY_THERMAL_80MM, QUERY_THERMAL_80MM_48]) for (const kind of kinds) {
  test(`${kind}: ${profile.columns} columns preserve values, center header and align numeric columns`, () => {
    const before = JSON.stringify({ source, filters, config });
    const document = buildPosReportDocument(kind, source, filters, config, issuedAt);
    const lines = layoutQueryReport(document, profile);
    assert.ok(lines.every(line => Array.from(line.text).length <= profile.columns));
    assert.equal(queryReportPlainText(document, profile), lines.map(line => line.text).join('\n'));
    assert.ok(lines[0].centered && lines[0].bold);
    const header = lines[0].text;
    assert.ok(Math.abs(header.indexOf(document.business) - (profile.columns - header.trimEnd().length)) <= 1);
    assert.ok(lines.some(line => line.text.includes('01/11/2026 - 17/11/2026')));
    assert.ok(lines.some(line => line.text.includes('CONSULTA - NO REALIZA CIERRE DE CAJA')));
    for (const block of document.blocks) {
      if (block.type === 'pair') {
        const expected = block.value;
        assert.ok(lines.some(line => line.text.endsWith(expected)), `${kind}: missing atomic pair ${expected}`);
      }
      if (block.type === 'table') for (const row of block.rows) {
        const value = row[row.length - 1].text;
        assert.ok(lines.some(line => line.text.endsWith(value) && line.text.length === profile.columns), `${kind}: amount not right aligned ${value}`);
        if (kind === 'PAYMENTS' || kind === 'PRODUCTS') assert.ok(lines.some(line => line.text.endsWith(value) && line.bold));
      }
    }
    assert.equal(JSON.stringify({ source, filters, config }), before);
    const html = buildQueryReportHtml(document, profile);
    assert.match(html, /size:80mm \d+mm/);
    assert.match(html, /width:72mm/);
    assert.match(html, /white-space:pre;/);
    assert.doesNotMatch(html, /pre-wrap|overflow-wrap:anywhere/);
  });
}
test('large amounts expand atomic columns and force controlled stacked layout, never truncate', () => {
  const document: PosReportDocument = { title: 'Prueba', business: 'Café', start: filters.start, end: filters.end, terminal: 'Caja 6', issuedAt, blocks: [
    { type: 'table', columns: [{ title: 'Concepto' }, { title: 'Cant.', align: 'right', atomic: true }, { title: 'Importe', align: 'right', atomic: true }], rows: [[
      { text: 'Descripción con palabras muy largas para probar el salto controlado' }, { text: '1,234,567.125', atomic: true }, { text: 'USD 1,234,567,890,123.45', atomic: true },
    ]] },
  ] };
  const lines = layoutQueryReport(document);
  for (const value of ['1,234,567.125', 'USD 1,234,567,890,123.45']) {
    const line = lines.find(line => line.text.endsWith(value))!;
    assert.ok(line);
    assert.equal(line.text.length, 42);
  }
});
test('accents are encoded in one-byte CP858, punctuation normalized and printer commands cannot be injected', () => {
  assert.deepEqual([...encodeQueryReportText('n\u0303')], [164]);
  assert.deepEqual([...encodeQueryReportText('ñÑáéíóúü€')], [164, 165, 160, 130, 161, 162, 163, 129, 213]);
  const document = buildPosReportDocument('PRODUCTS', source, filters, config, issuedAt);
  const decoded = Buffer.from(buildQueryReportEscPos(document), 'base64');
  assert.ok(decoded.includes(Buffer.from([0x1b, 0x4d, 0]))); // Font A
  assert.ok(decoded.includes(Buffer.from([0x1b, 0x74, 19]))); // CP858
  assert.equal(decoded.includes(Buffer.from([0x1b, 0x70])), false); // No drawer pulse
  assert.equal(decoded.includes(Buffer.from([0x1d, 0x28, 0x45])), false); // No persistent switches
  const injected = { ...document, business: 'Caja\x1bp\x00\t<script>& “niño”…' };
  const bytes = Buffer.from(buildQueryReportEscPos(injected), 'base64');
  assert.equal(bytes.includes(Buffer.from([0x1b, 0x70])), false);
  const html = buildQueryReportHtml(injected);
  assert.ok(html.includes('&lt;script&gt;&amp;'));
  assert.doesNotMatch(html, /<script>/);
  assert.ok(queryReportPlainText(injected).includes('"niño"...'));
});
test('codes and dates remain indivisible; an impossible code rejects the job instead of splitting', () => {
  const document = buildPosReportDocument('ADJUSTMENTS', source, filters, config, issuedAt);
  const lines = layoutQueryReport(document);
  assert.ok(lines.some(line => line.text.trim() === '00000000-1111-2222-3333-444444444444'));
  const impossible = { ...document, blocks: [{ type: 'pair' as const, label: 'Documento', value: 'X'.repeat(70) }] };
  assert.throws(() => layoutQueryReport(impossible), /supera el ancho/);
});
test('monetary presentation keeps original currency, sign and two decimals', () => {
  assert.equal(reportMoney(-1234567.8, 'USD'), 'USD -1,234,567.80');
  assert.equal(reportMoney(0, 'DOP'), 'DOP 0.00');
  assert.equal(reportMoney(1.005, 'DOP'), 'DOP 1.00'); // unchanged toFixed rounding
  assert.equal(reportMoney(-1.005, 'DOP'), 'DOP -1.00');
  assert.equal(reportMoney(123.456, 'EUR'), 'EUR 123.46');
  assert.equal(reportMoney(1e21, 'DOP'), 'DOP 1,000,000,000,000,000,000,000.00');
  assert.equal(buildPosReportText('SALES', source, filters, config, issuedAt).includes('Venta neta: DOP 1234537.89'), true);
  assert.ok(queryReportPlainText(buildPosReportDocument('SALES', source, filters, config, issuedAt)).includes('DOP 1,234,537.89'));
});
test('empty periods use the common header without invented totals', () => {
  for (const kind of kinds) {
    const text = queryReportPlainText(buildPosReportDocument(kind, { transactions: [], movements: [], reports: [] }, filters, config, issuedAt));
    assert.ok(text.includes('Sin registros en el período.'));
    assert.doesNotMatch(text, /NaN|undefined|Infinity/);
  }
});


test('88 mm paper uses the same computed layout without assuming more hardware columns', () => {
  const document = buildPosReportDocument('SALES', source, filters, config, issuedAt);
  const profile = { ...QUERY_THERMAL_80MM, paperWidthMm: 88 as const };
  assert.match(buildQueryReportHtml(document, profile), /size:88mm \d+mm/);
  assert.ok(layoutQueryReport(document, profile).every(line => line.text.length <= 42));
});
