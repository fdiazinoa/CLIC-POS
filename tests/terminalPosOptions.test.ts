import assert from 'node:assert/strict';
import test from 'node:test';
import { getInitialConfig } from '../constants';
import { applyTerminalConfigSnapshot } from '../utils/terminalConfigSnapshot';
import { mergeTerminalPosOptions, terminalPosOptionsPatch } from '../utils/terminalPosOptions';

test('canonical false wins aliases and absence/invalid values preserve policy', () => {
  const local = { security: { requirePinForVoid: true, requirePinForDiscount: true }, ux: { showProductImages: true }, operational: { showGlobalSales: true } };
  const result = mergeTerminalPosOptions(local, { security: { requirePinForVoid: false, requireManagerForVoid: true }, operational: { showGlobalSales: false }, ux: { showProductImages: false } });
  assert.equal(result.security.requirePinForVoid, false);
  assert.equal(result.security.requirePinForDiscount, true);
  assert.equal(result.security.clerkCanSeeOtherSales, false);
  assert.equal(result.ux.showProductImages, false);
  assert.deepEqual(mergeTerminalPosOptions(local, { security: { requirePinForVoid: null }, ux: { viewMode: 'bad' } }), mergeTerminalPosOptions(local));
});

test('partial nested preferences retain reservation percentage, delivery and local order counter', () => {
  const local = { operational: { reservationPolicy: { validityDays: 30, printCopies: 3, minimumAdvancePercent: 45, requireAdvance: true }, deliveryAlerts: { isDeliveryTerminal: true, showUberEatsToast: false, autoOpenUberEatsModal: true }, orderNumbers: { enabled: true, nextNumber: 109, prefix: 'A', padding: 5 } } };
  const result = mergeTerminalPosOptions(local, { business_config: { reservationPolicy: { requireAdvance: false }, deliveryAlerts: { isDeliveryTerminal: false }, orderNumbers: { enabled: false, nextNumber: 1, prefix: 'ERP', padding: 1 } } });
  assert.deepEqual(result.operational.reservationPolicy, { ...local.operational.reservationPolicy, requireAdvance: false });
  assert.deepEqual(result.operational.deliveryAlerts, { ...local.operational.deliveryAlerts, isDeliveryTerminal: false, autoOpenUberEatsModal: false });
  assert.deepEqual(result.operational.orderNumbers, { ...local.operational.orderNumbers, enabled: false });
});

test('invalid reservation ranges are ignored; valid boundaries are accepted', () => {
  assert.deepEqual(terminalPosOptionsPatch({ operational: { reservationPolicy: { validityDays: 0, printCopies: 101, minimumAdvancePercent: NaN } } }).operational, {});
  assert.deepEqual(terminalPosOptionsPatch({ operational: { reservationPolicy: { validityDays: 3650, printCopies: 100, minimumAdvancePercent: 0 } } }).operational.reservationPolicy, { validityDays: 3650, printCopies: 100, minimumAdvancePercent: 0 });
});

for (const shape of ['config', 'resolved', 'resolvedTerminal', 'resolvedConfig', 'configTerminal', 'configProfile', 'root'] as const) {
  test(`snapshot ${shape} applies UX and agenda only to A and survives offline reload`, () => {
    const config = structuredClone(getInitialConfig('Supermercado' as any));
    const id = config.terminals[0].id;
    config.terminals.push({ id: 'B', config: structuredClone(config.terminals[0].config) });
    config.terminals[0].config.operational.orderNumbers = { enabled: true, nextNumber: 77, prefix: 'A', padding: 3 };
    const b = JSON.parse(JSON.stringify(config.terminals.find(row => row.id === 'B')));
    const options = { ux: { showProductImages: false, viewMode: 'RETAIL' }, startWithAgenda: true, operational: { orderNumbers: { enabled: false, nextNumber: 1 }, reservationPolicy: { printCopies: 4 } } };
    const snapshot = shape === 'resolvedConfig' ? { resolved: { config: options } } : shape === 'configTerminal' ? { config: { terminal: { config: options } } } : shape === 'configProfile' ? { config: { profile: { config: options } } } : shape === 'config' ? { config: options } : shape === 'resolved' ? { resolved: options } : shape === 'resolvedTerminal' ? { resolved: { terminal: { config: options } } } : options;
    const applied = applyTerminalConfigSnapshot(config, { terminalId: id, incomingSnapshot: { terminal_id: id, ...snapshot } as any });
    const a = applied.config.terminals[0].config;
    assert.equal(a.ux.showProductImages, false);
    assert.equal(a.ux.viewMode, 'RETAIL');
    assert.equal(a.startWithAgenda, true);
    assert.equal(a.operational.orderNumbers?.nextNumber, 77);
    assert.equal(a.operational.reservationPolicy?.validityDays, 7);
    assert.equal(a.operational.reservationPolicy?.printCopies, 4);
    assert.deepEqual(applied.config.terminals.find(row => row.id === 'B'), b);
    const persisted = JSON.parse(JSON.stringify(applied.config));
    const offline = applyTerminalConfigSnapshot(persisted, { terminalId: id, incomingSnapshot: null });
    assert.deepEqual(offline.config.terminals[0].config.ux, a.ux);
    assert.deepEqual(offline.config.terminals[0].config.operational.orderNumbers, a.operational.orderNumbers);
  });
}

test('new terminal uses default preferences rather than another terminal choices', () => {
  const config = structuredClone(getInitialConfig('Supermercado' as any));
  config.terminals[0].config.ux.showProductImages = false;
  config.terminals[0].config.security.requirePinForVoid = false;
  const applied = applyTerminalConfigSnapshot(config, { terminalId: 'NEW', incomingSnapshot: { terminal_id: 'NEW', config: {} } as any });
  const terminal = applied.config.terminals.find(row => row.id === 'NEW')!.config;
  assert.equal(terminal.ux.showProductImages, true);
  assert.equal(terminal.security.requirePinForVoid, true);
});

test('business envelope and canonical operational block combine partial nested settings', () => {
  const patch = terminalPosOptionsPatch({ business_config: { reservationPolicy: { validityDays: 12 }, deliveryAlerts: { showUberEatsToast: false } }, operational: { reservationPolicy: { printCopies: 2 }, deliveryAlerts: { isDeliveryTerminal: true } } });
  assert.deepEqual(patch.operational.reservationPolicy, { validityDays: 12, printCopies: 2 });
  assert.deepEqual(patch.operational.deliveryAlerts, { showUberEatsToast: false, isDeliveryTerminal: true });
});
