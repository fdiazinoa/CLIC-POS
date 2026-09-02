import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ActionGrid from '../components/ActionGrid';
import SupermarketTicketSummary from '../components/SupermarketTicketSummary';
import type { BusinessConfig } from '../types';

const props = { onAction: () => {}, config: {} as BusinessConfig, parkedTicketsCount: 2, globalDiscountValue: 0, isReturnMode: false, hasCartItems: true, showLogout: false, showTakeout: true };
const actions = (region: 'all' | 'ticket' | 'other', allowWaitList = true) => [...renderToStaticMarkup(React.createElement(ActionGrid, { ...props, actionRegion: region, allowWaitList })).matchAll(/data-action-id="([^"]+)"/g)].map(m => m[1]);

test('ticket actions move to checkout without duplication or losing secondary actions', () => {
  assert.deepEqual(actions('ticket'), ['DISCOUNT', 'COUPON', 'PARK_LIST', 'SAVE']);
  const combined = [...actions('ticket'), ...actions('other')];
  assert.equal(new Set(combined).size, combined.length);
  assert.deepEqual(combined.sort(), actions('all').sort());
});
test('wait list visibility still honors existing context', () => {
  assert.ok(!actions('ticket', false).includes('PARK_LIST'));
  assert.ok(actions('ticket', false).includes('SAVE'));
});
test('summary renders supplied totals, units and projected points without changing them', () => {
  const html = renderToStaticMarkup(React.createElement(SupermarketTicketSummary, {symbol: 'RD$', subtotal: 2625, discount: 0, tax: 400.42, total: 2625, units: 3, points: 262}));
  assert.match(html, /RD\$2,625.00/);
  assert.match(html, /RD\$400.42/);
  assert.match(html, />3<\/span>/);
  assert.match(html, /Ganarás/);
  assert.match(html, />262<\/strong>/);
  assert.doesNotMatch(html, /Puntos ganados|Descuento/);
});
test('empty points are hidden and single unit has singular label', () => {
  const html = renderToStaticMarkup(React.createElement(SupermarketTicketSummary, {symbol: '$', subtotal: 1, discount: .5, tax: 0, total: .5, units: 1, points: 0}));
  assert.match(html, />unidad<\/span>/);
  assert.match(html, /Descuento/);
  assert.doesNotMatch(html, /Ganarás/);
});
test('supermarket description separates code and highlights existing variant; money order is fixed', () => {
  const source = readFileSync(new URL('../components/ProductTableSupermarket.tsx', import.meta.url), 'utf8');
  assert.ok(source.indexOf('>Precio<') < source.indexOf('>ITBIS<'));
  assert.ok(source.indexOf('>ITBIS<') < source.indexOf('>Total</th>'));
  assert.match(source, /supermarket-code mt-1 block/);
  assert.match(source, /item\.variantInfo &&/);
  assert.match(source, /item\.sku \|\| item\.id/);
  // This is a presentation-only change: preserve the existing calculation.
  assert.match(source, /const taxAmount = item\.price \* item\.quantity \* \(config\.taxRate \|\| 0\.18\)/);
  assert.match(source, /const total = item\.price \* item\.quantity/);
});
test('checkout retains existing fiscal/session guards and shared action dispatcher', () => {
  const source = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
  const footer = source.slice(source.indexOf('// --- RETAIL MODE FOOTER'), source.indexOf('// --- VISUAL MODE FOOTER'));
  assert.match(footer, /validateTerminalDocument\(config, terminalId, 'TICKET'\)/);
  assert.match(footer, /canProceedWithOperationalSession\(\)/);
  assert.match(footer, /cart\.length === 0 \|\| !canCheckoutWithFiscalPolicy/);
  assert.equal((footer.match(/onAction=\{handleGridAction\}/g) || []).length, 2);
});
