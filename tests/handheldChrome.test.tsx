import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ActionGrid from '../components/ActionGrid';
import { HandheldPOSHeader } from '../components/HandheldPOSChrome';
import { FiscalStatusBadge } from '../components/POSStatusIndicators';
import OrderServiceTypeButton from '../components/OrderServiceTypeButton';
import { DeviceFormFactor, SubVertical } from '../types';
import { getInitialConfig } from '../constants';
import { usesHandheldSalePresentation } from '../utils/handheldPresentation';

const noop = () => {};
const props = { onAction: noop, config: getInitialConfig(SubVertical.SUPERMARKET), parkedTicketsCount: 2,
  globalDiscountValue: 0, isReturnMode: false, hasCartItems: true, orientation: 'vertical' as const,
  allowHistory: true, showLogout: false, allowWaitList: true, allowSave: true };
const ids = (html: string) => [...html.matchAll(/data-action-id="([^"]+)"/g)].map(match => match[1]);

test('handheld options expose each secondary action once and leave Settings in its shared header', () => {
  const actions = ids(renderToStaticMarkup(<ActionGrid {...props} compact />));
  assert.equal(actions.length, new Set(actions).size);
  assert.ok(!actions.includes('SETTINGS'));
  for (const action of ['DISCOUNT', 'COUPON', 'SAVE', 'PARK_LIST', 'HISTORY', 'RESERVATION', 'RECOVER_RESERVATION', 'ATTENDANCE', 'Z_REPORT']) assert.ok(actions.includes(action), action);
  const restricted = ids(renderToStaticMarkup(<ActionGrid {...props} compact allowSave={false} allowWaitList={false} allowHistory={false} hideFinancialClosings />));
  for (const action of ['SAVE', 'PARK_LIST', 'HISTORY', 'Z_REPORT']) assert.ok(!restricted.includes(action), action);
});

test('normal POS, tablet and kiosk retain the complete existing actions and service controls', () => {
  const configBefore = JSON.stringify(props.config);
  for (const profile of [DeviceFormFactor.DESKTOP_POS, DeviceFormFactor.TABLET, DeviceFormFactor.KIOSK]) {
    const compact = usesHandheldSalePresentation(profile, true, false);
    const html = renderToStaticMarkup(<ActionGrid {...props} compact={compact} />);
    assert.equal(html, renderToStaticMarkup(<ActionGrid {...props} />));
    assert.ok(ids(html).includes('SETTINGS'));
    assert.doesNotMatch(renderToStaticMarkup(<OrderServiceTypeButton value="DINE_IN" onClick={noop} compact={compact} />), /handheld-service-type/);
  }
  assert.equal(JSON.stringify(props.config), configBefore);
});

test('shared handheld navigation has one Settings control, one tariff and one Options entry', () => {
  const html = renderToStaticMarkup(<HandheldPOSHeader restaurant={false} operator="Jonás" terminal="CAJA03" view="TICKET" quantity="2" status={<span>Online</span>}
    tariff={<select aria-label="Tarifa activa"><option>Público general</option></select>} actionsOpen onView={noop} onActions={noop} onSettings={noop} />);
  assert.equal((html.match(/aria-label="Abrir ajustes"/g) || []).length, 1);
  assert.equal((html.match(/aria-label="Tarifa activa"/g) || []).length, 1);
  assert.equal((html.match(/aria-label="Abrir acciones rápidas"/g) || []).length, 1);
  assert.match(html, /aria-label="Abrir acciones rápidas" aria-pressed="true"/);
});

test('compact fiscal status retains full accessible detail and explicitly exposes exhaustion', () => {
  const status = {type:'E32',hasNCF:false,isTerminalBlock:true};
  const inline = renderToStaticMarkup(<FiscalStatusBadge visible allowed={false} status={status} inline />);
  assert.match(inline, /<details/);assert.match(inline, /Agotado/);assert.match(inline, /aria-label="Estado fiscal: E32 Agotado"/);
  const legacy = renderToStaticMarkup(<FiscalStatusBadge visible allowed={false} status={status} />);
  assert.doesNotMatch(legacy, /<details/);assert.match(legacy, /Status Fiscal: E32 Agotado/);
});
