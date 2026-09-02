import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import OrderServiceTypeButton from '../components/OrderServiceTypeButton';

test('compact header button shows each current service and opens the existing selector', () => {
  for (const [value, label] of [['DINE_IN', 'En local'], ['TAKEOUT', 'Para llevar'], ['DELIVERY', 'Delivery']] as const) {
    let opens = 0;
    const props = { value, onClick: () => { opens++; } };
    const element = OrderServiceTypeButton(props);
    element.props.onClick();
    assert.equal(opens, 1);
    const html = renderToStaticMarkup(React.createElement(OrderServiceTypeButton, props));
    assert.ok(html.includes(`Tipo de servicio: ${label}`));
    assert.match(html, /aria-haspopup="dialog"/);
    assert.match(html, /h-12 w-16 shrink-0/);
    assert.match(html, /type="button"/);
  }
});

test('service is last after Actions in both responsive headers, with no ticket strip or action-grid duplicate', () => {
  const source = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
  const mobile = source.slice(source.indexOf('data-testid="mobile-sidebar-tabs"'), source.indexOf('{/* CUSTOMER PILL (MOBILE) */}'));
  const desktop = source.slice(source.indexOf('data-testid="desktop-ticket-toolbar"'), source.indexOf('{shouldApplyServiceCharge &&'));
  for (const header of [mobile, desktop]) {
    assert.equal((header.match(/<OrderServiceTypeButton /g) || []).length, 1);
    assert.ok(header.indexOf('<OrderServiceTypeButton ') > header.indexOf('aria-label="Abrir acciones rápidas"'));
    assert.match(header, /!isKioskMode && <OrderServiceTypeButton/);
    assert.match(header, /value=\{effectiveOrderServiceType\}/);
  }
  assert.equal((source.match(/<OrderServiceTypeButton /g) || []).length, 2);
  assert.doesNotMatch(source, /aria-label="Cambiar tipo de servicio"/);
  assert.doesNotMatch(source, /showTakeout=/);
});
