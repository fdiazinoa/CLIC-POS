import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildReceiptEmailPayload } from '../services/email/receiptEmailPayload';
import { buildEscPosTicketPayload } from '../services/printer/EscPosFormatter';
import { createWeightPresentation, weightLineLabel } from '../utils/scaleWeight';

const config = { companyInfo: { name: 'CLIC POS', rnc: '', phone: '', address: '' }, currencySymbol: '$',
  receiptConfig: {}, taxes: [], terminals: [], currencies: [] } as any;
test('email preserves canonical financial DTO and adds captured unit in existing options', () => {
  const line = { id: 'P', cartId: 'L', name: 'BAL', quantity: 1, price: 1, originalPrice: 1.25,
    weightPresentation: createWeightPresentation('scale', 'lb', 'kg') };
  const tx = { id: 'T', date: '2026-10-08', total: 1, items: [line], payments: [], terminalId: 'terminal', userName: 'User' } as any;
  const before = JSON.stringify(tx);
  const payload = buildReceiptEmailPayload(tx, 'fixture@example.invalid', config, '$') as any;
  const output = payload.items?.[0] || payload.cart?.[0];
  assert.ok(output);
  assert.equal(output.quantity, 1); assert.equal(output.price, 1);
  assert.equal(output.unitPrice, 1); assert.equal(output.originalUnitPrice, 1.25);
  assert.ok(output.options.includes(weightLineLabel(line, '$')));
  assert.equal(JSON.stringify(tx), before);
});
test('actual ESC/POS receipt and HTML consumers show captured units without changing total', () => {
  const line = { id: 'P', cartId: 'L', name: 'BAL', quantity: 1, price: 1,
    weightPresentation: createWeightPresentation('scale', 'lb', 'kg') };
  const tx = { id: 'T', date: '2026-10-08', total: 1, items: [line], payments: [], terminalId: 'terminal', userName: 'User' } as any;
  const bytes = buildEscPosTicketPayload(tx, config);
  assert.ok(bytes);
  const text = Buffer.from(bytes, 'base64').toString('latin1');
  assert.match(text, /0.45359237\/lb/);
  assert.match(text, /lb x/);
  assert.equal(tx.items[0].quantity, 1); assert.equal(tx.items[0].price, 1);
  const html = readFileSync(new URL('../utils/printer.ts', import.meta.url), 'utf8');
  assert.ok((html.match(/weightLineLabel\(item, currencySymbol/g) || []).length >= 3);
});
