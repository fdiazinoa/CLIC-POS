import assert from 'node:assert/strict';
import test from 'node:test';

import { buildEscPosTicketPayload } from '../services/printer/EscPosFormatter';
import { consolidateTaxBreakdownForDisplay } from '../utils/fiscalBreakdown';

const taxes = [
  { id: 'legacy-tax-18', name: 'Impuesto', rate: 0.18, type: 'VAT' },
  { id: 'erp-itbis-18', code: 'ITBIS18', name: 'ITBIS', rate: 0.18, type: 'VAT' },
  { id: 'service-18', name: 'Servicio especial', rate: 0.18, type: 'SERVICE_CHARGE' },
] as any;

const duplicatedVatLines = [
  { id: 'legacy-tax-18', name: 'Impuesto', rate: 0.18, amount: 1.8, taxableBase: 10, total: 11.8, lineCount: 1 },
  { id: 'erp-itbis-18', name: 'ITBIS', rate: 0.18, amount: 0.9, taxableBase: 5, total: 5.9, lineCount: 1 },
];

test('consolida IDs equivalentes de ITBIS por tipo fiscal y tasa sin alterar el desglose original', () => {
  const original = structuredClone(duplicatedVatLines);
  const display = consolidateTaxBreakdownForDisplay(duplicatedVatLines, taxes);

  assert.deepEqual(duplicatedVatLines, original);
  assert.equal(display.length, 1);
  assert.equal(display[0].name, 'ITBIS');
  assert.equal(display[0].rate, 0.18);
  assert.equal(display[0].amount, 2.7);
  assert.equal(display[0].taxableBase, 15);
  assert.equal(display[0].lineCount, 2);
});

test('no mezcla impuestos de tipos fiscales distintos aunque compartan la misma tasa', () => {
  const display = consolidateTaxBreakdownForDisplay([
    ...duplicatedVatLines,
    { id: 'service-18', name: 'Servicio especial', rate: 0.18, amount: 2.7, taxableBase: 15, total: 17.7, lineCount: 2 },
  ], taxes);

  assert.equal(display.length, 2);
  assert.deepEqual(display.map((line) => [line.name, line.amount]), [
    ['ITBIS', 2.7],
    ['Servicio especial', 2.7],
  ]);
});

test('el ticket térmico imprime una sola línea ITBIS 18% con el total consolidado', () => {
  const transaction = {
    id: 'tax-display-1',
    displayId: 'TCK-TAX-1',
    date: '2026-09-01T16:45:00.000Z',
    items: [
      { id: 'water-1', cartId: 'water-1', name: 'Agua Dasani', quantity: 1, price: 10, appliedTaxIds: ['legacy-tax-18'] },
      { id: 'water-2', cartId: 'water-2', name: 'Agua absoluta', quantity: 1, price: 5, appliedTaxIds: ['erp-itbis-18'] },
    ],
    subtotal: 15,
    taxAmount: 2.7,
    taxBreakdown: structuredClone(duplicatedVatLines),
    total: 17.7,
    payments: [{ id: 'cash-1', method: 'CASH', amount: 17.7 }],
    userId: 'user-1',
    userName: 'Cajero',
    terminalId: 'terminal-1',
    status: 'COMPLETED',
  } as any;
  const config = {
    companyInfo: { name: 'PANCUVI SRL', rnc: '', phone: '', address: '' },
    currencySymbol: 'RD$',
    receiptConfig: {},
    taxes,
    terminals: [],
  } as any;

  const payload = buildEscPosTicketPayload(transaction, config);
  const decoded = Buffer.from(payload || '', 'base64').toString('latin1');

  assert.equal(decoded.match(/ITBIS 18%/g)?.length, 1);
  assert.match(decoded, /ITBIS 18%\s+RD\$2\.70/);
  assert.doesNotMatch(decoded, /Impuesto 18%/i);
  assert.equal(transaction.taxBreakdown.length, 2);
});
