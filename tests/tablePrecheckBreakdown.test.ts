import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildEscPosSubtotalPayload } from '../services/printer/EscPosFormatter';

const config = {
  companyInfo: { name: 'CLIC POS', rnc: '', phone: '', address: '' },
  currencySymbol: 'RD$', receiptConfig: {}, taxes: [], terminals: [],
} as any;

test('pre-cuenta ESC/POS conserva impuestos configurados de cada artículo', () => {
  const payload = buildEscPosSubtotalPayload(config, {
    items: [{ id: 'p1', cartId: 'c1', name: 'Producto', quantity: 1, price: 100 } as any],
    subtotal: 100, discountTotal: 0, taxTotal: 28, finalTotal: 128,
    taxBreakdown: [
      { name: 'ITBIS', rate: 0.18, amount: 18 },
      { name: 'Impuesto Ley', rate: 0.1, amount: 10 },
    ],
  });
  const printed = Buffer.from(payload || '', 'base64').toString('latin1');
  assert.match(printed, /ITBIS 18%/);
  assert.match(printed, /Impuesto Ley 10%/);
  assert.doesNotMatch(printed, /IMPUESTOS/);
});

test('pre-cuenta ESC/POS no contradice una propina legal incluida', () => {
  const payload = buildEscPosSubtotalPayload(config, {
    items: [{ id: 'p1', cartId: 'c1', name: 'Producto', quantity: 1, price: 100 } as any],
    subtotal: 100, netSubtotal: 100, isTaxIncluded: false,
    discountTotal: 0, taxTotal: 0, serviceChargeAmount: 10, serviceChargeRate: 10, finalTotal: 110,
  });
  const printed = Buffer.from(payload || '', 'base64').toString('latin1');
  assert.match(printed, /Propina legal incluida en el total/);
  assert.doesNotMatch(printed, /Propina legal no incluida/);
});

test('HTML y App usan las mismas líneas fiscales y lote sin repetir ticketId', () => {
  const printer = readFileSync(new URL('../utils/printer.ts', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  assert.match(printer, /params\.taxBreakdown\?\.length/);
  assert.match(printer, /formatTaxLineLabel\(tax\)/);
  assert.match(app, /new Set\(\(requestedTicketIds\?\.length/);
  assert.match(app, /const printedIds = new Set<string>\(\)/);
  assert.match(app, /if \(printedIds\.size > 0\)/);
  assert.match(app, /order\.paymentFraction\?\.parts\.some\(part => part\.status === 'PAID'\)/);
  assert.match(app, /authoritativeTickets\.map\(ticket => printedIds\.has/);
  assert.match(app, /resolveValidatedOperationalApiUrl\('\/api\/mesas'\)/);
  assert.match(app, /masterRestaurantRevisionRef\.current/);
});
