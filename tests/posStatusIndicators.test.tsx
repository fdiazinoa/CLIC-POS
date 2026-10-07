import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { FiscalStatusBadge, SyncStatusBadge, TicketStatusControls, TicketTotalStatusRow } from '../components/POSStatusIndicators';
import SupermarketTicketSummary from '../components/SupermarketTicketSummary';

const renderSync = (online: boolean, pendingCount = 0, blockedCount = 0, hasError = false) => renderToStaticMarkup(<SyncStatusBadge online={online} state={{ pendingCount, blockedCount, hasError }} />);
test('sync preserves Online, pending, blocked and offline precedence and error colors', () => {
  assert.match(renderSync(true), />Online</);
  assert.match(renderSync(true, 3), />Online · 3</);
  assert.match(renderSync(true, 3, 2), />Bloqueado · 2</);
  assert.match(renderSync(false, 3, 2), />Offline</);
  assert.doesNotMatch(renderSync(false, 3, 2), /Bloqueado ·|Online ·/);
  assert.match(renderSync(true, 0, 0, true), /text-amber-600/);
  assert.match(renderSync(true), /role="status"/);
});
test('fiscal status retains terminal, pool, global and exhausted text and disabled visibility', () => {
  const badge = (visible: boolean, hasNCF: boolean, isTerminalBlock = false, isUsingPool = false) => renderToStaticMarkup(<FiscalStatusBadge compact visible={visible} allowed={hasNCF} status={{ type: 'B02', hasNCF, isTerminalBlock, isUsingPool }} />);
  assert.match(badge(true, true, true, true), /B02 Bloque Terminal/);
  assert.match(badge(true, true, false, true), /Reservado en Pool/);
  assert.match(badge(true, true), /Lote Global Activo/);
  assert.match(badge(true, false), /Agotado/);
  assert.match(badge(true, false), /text-red-600/);
  assert.equal(badge(false, true), '');
});
test('shared controls retain controls and fiscal status within the same layout wrapper', () => {
  const html = renderToStaticMarkup(<TicketStatusControls status={<FiscalStatusBadge visible allowed compact status={{type: 'B02', hasNCF: true, isTerminalBlock: true}} />}><button>Carrito</button><button>Acciones</button></TicketStatusControls>);
  assert.match(html, /supermarket-status-controls/);
  assert.match(html, /Status Fiscal:/);
  assert.match(html, /<button>Carrito<\/button><button>Acciones<\/button>/);
});
test('summary status slot preserves supplied total, tax, units and points, including large amounts', () => {
  const html = renderToStaticMarkup(<SupermarketTicketSummary symbol="RD$" subtotal={123456789.12} discount={1} tax={22.34} total={123456788.12} units={3} points={4} status={<SyncStatusBadge online state={{pendingCount: 999, blockedCount: 0, hasError: false}} />} />);
  for (const value of ['RD$123,456,788.12', 'RD$123,456,789.12', 'RD$22.34', 'Online · 999', 'unidades', 'Ganarás']) assert.ok(html.includes(value));
  assert.match(html, /supermarket-total-status-row/);
  assert.ok(html.indexOf('Total a pagar') < html.indexOf('Online · 999'));
});
test('total precedes every sync state without hiding a pending or blocked document', () => {
  for (const [online, pendingCount, blockedCount, expected] of [
    [true, 0, 0, 'Online'], [true, 999, 0, 'Online · 999'],
    [true, 0, 1, 'Bloqueado · 1'], [false, 999, 1, 'Offline'],
  ] as const) {
    const html = renderToStaticMarkup(<TicketTotalStatusRow className="flex-1 min-w-0" status={<SyncStatusBadge online={online} state={{pendingCount, blockedCount, hasError: blockedCount > 0}} />}><div>Total a pagar RD$0.00</div></TicketTotalStatusRow>);
    assert.ok(html.indexOf('Total a pagar RD$0.00') < html.indexOf('role="status"'));
    assert.ok(html.includes(`>${expected}<`));
    assert.match(html, /flex-1 min-w-0 supermarket-total-status-row/);
  }
});
test('total wrapper without a sync slot preserves its content and caller classes', () => {
  const html = renderToStaticMarkup(<TicketTotalStatusRow className="flex-1 min-w-0"><div>Total a pagar RD$9.99</div></TicketTotalStatusRow>);
  assert.equal(html, '<div class="flex-1 min-w-0 "><div>Total a pagar RD$9.99</div></div>');
  const summary = renderToStaticMarkup(<SupermarketTicketSummary symbol="RD$" subtotal={9.99} discount={0} tax={0} total={9.99} units={1} points={0} />);
  assert.match(summary, /Total a pagar/);
  assert.doesNotMatch(summary, /supermarket-total-status-row|role="status"|Sincronización/);
});
test('retail placements use existing state and preserve guards and non-retail status placement', () => {
  const source = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
  assert.equal((source.match(/status=\{isRetailMode \? <FiscalStatusBadge compact visible=\{!isOrderTakerMode && !isFiscalModeDisabled\}/g) || []).length, 2);
  assert.match(source, /!isRetailMode && <FiscalStatusBadge visible=\{!isOrderTakerMode && !isFiscalModeDisabled\}/);
  assert.equal((source.match(/<SyncStatusBadge online=\{navigator.onLine\} state=\{syncState\}/g) || []).length, 3);
  assert.match(source, /cart.length === 0 \|\| !canCheckoutWithFiscalPolicy/);
  assert.match(source, /shouldShowFiscalReserveAlert && fiscalReserveAlert/);
});
