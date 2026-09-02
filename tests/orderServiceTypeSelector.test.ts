import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import OrderServiceTypeDialog, { SERVICE_TYPE_OPTIONS } from '../components/OrderServiceTypeDialog';
import ActionGrid from '../components/ActionGrid';
import { getInitialConfig } from '../constants';
import { SubVertical } from '../types';
import { resolveAppliedServiceTaxPolicy } from '../utils/serviceTaxPolicy';
import { buildServiceTypeReport } from '../utils/orderServiceType';

test('service selector offers all three types and reflects the selected option', () => {
  assert.deepEqual(SERVICE_TYPE_OPTIONS.map(o => o.value), ['DINE_IN', 'TAKEOUT', 'DELIVERY']);
  for (const { value, label } of SERVICE_TYPE_OPTIONS) {
    const html = renderToStaticMarkup(React.createElement(OrderServiceTypeDialog, { value, onSelect() {}, onClose() {} }));
    assert.match(html, /role="dialog"/);
    assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1);
    assert.ok(html.includes(label));
  }
});

test('Uber delivery cannot be changed; close remains available', () => {
  const html = renderToStaticMarkup(React.createElement(OrderServiceTypeDialog, { value: 'DELIVERY', locked: true, onSelect() {}, onClose() {} }));
  assert.equal((html.match(/disabled=""/g) || []).length, 3);
  assert.match(html, /Uber Eats/);
  assert.match(html, /Cerrar tipo de servicio/);
});

test('all action grid layouts retain legacy action ID and display Delivery', () => {
  for (const orientation of ['horizontal', 'vertical'] as const) {
    const html = renderToStaticMarkup(React.createElement(ActionGrid, {
      config: getInitialConfig(SubVertical.SUPERMARKET), onAction() {}, parkedTicketsCount: 0,
      globalDiscountValue: 0, isReturnMode: false, hasCartItems: false,
      showTakeout: true, serviceType: 'DELIVERY', orientation,
    }));
    assert.match(html, /data-action-id="TAKEOUT"/);
    assert.match(html, /Delivery ✓/);
  }
});

test('manual Delivery uses its configured policy, not Takeout, and is reported separately', () => {
  const config = getInitialConfig(SubVertical.SUPERMARKET);
  config.serviceTaxPolicies = {
    DINE_IN: { taxIds: ['vat'], legalTip: { enabled: true, percentage: 10 } },
    TAKEOUT: { taxIds: ['vat'], legalTip: { enabled: false, percentage: 0 } },
    DELIVERY: { taxIds: [], legalTip: { enabled: true, percentage: 5 } },
  };
  const policy = resolveAppliedServiceTaxPolicy(config, undefined, 'DELIVERY');
  assert.deepEqual(policy.taxIds, []);
  assert.deepEqual(policy.legalTip, { enabled: true, percentage: 5 });
  const report = buildServiceTypeReport([{ id: 'manual-delivery', serviceType: 'DELIVERY', total: 100, date: '2026-09-02' } as any]);
  assert.equal(report.summary.find(s => s.serviceType === 'DELIVERY')?.transactionCount, 1);
  assert.equal(report.summary.find(s => s.serviceType === 'TAKEOUT')?.transactionCount, 0);
  assert.equal(report.transactions[0].serviceType, 'DELIVERY');
});

test('POS routes existing action to selector and suspends barcode handling while open', () => {
  const source = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
  const action = source.slice(source.indexOf("case 'TAKEOUT':"), source.indexOf("case 'TABLES':"));
  assert.match(action, /setShowServiceTypeDialog\(true\)/);
  assert.doesNotMatch(action, /setOrderServiceType/);
  assert.match(source, /const isAnyModalOpen = !!\(\s*showServiceTypeDialog/);
  assert.match(source, /locked=\{isRecoveredUberOrder\}/);
  assert.match(source, /if \(isRecoveredUberOrder\) return;\s*setOrderServiceType\(serviceType\)/);
  assert.match(source, /serviceType: effectiveOrderServiceType/);
});
