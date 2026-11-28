import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import LoyaltySettings from '../components/LoyaltySettings';
import { getInitialConfig } from '../constants';
import { isErpLoyaltyManaged, saveLocalConfigPreservingErpLoyalty } from '../utils/loyaltyConfigAuthority';
import { calculatePointsEarned } from '../utils/loyaltyEngine';
import { applyTerminalConfigSnapshot } from '../utils/terminalConfigSnapshot';
import type { BusinessConfig, LoyaltyConfig } from '../types';

test('a local settings save retries with the synchronized loyalty rule when ERP changes during the save', async () => {
    const config = getInitialConfig('Supermercado');
    const off: LoyaltyConfig = { ...config.loyalty!, isEnabled: false };
    let current = config;
    let attempts = 0;
    const result = await saveLocalConfigPreservingErpLoyalty({
        async getDocument<T>(collection: string, id: string) {
            assert.equal(collection, 'config');
            assert.equal(id, 'current');
            return current as T;
        },
        async saveConfigIfUnchanged(expected, next) {
            if (++attempts === 1) current = { ...current, loyalty: off };
            if (current !== expected) return false;
            current = next;
            return true;
        },
    }, { ...config, taxRate: 12 });

    assert.equal(attempts, 2);
    assert.equal(result?.taxRate, 12);
    assert.equal(current.loyalty?.isEnabled, false);
});

test('Settings only allows edits in the local program and shows ERP rules read-only', () => {
    const config = getInitialConfig('Supermercado');
    const render = (erpManaged: boolean) => renderToStaticMarkup(createElement(LoyaltySettings, {
        config, erpManaged, onClose() {}, onUpdateConfig(_config: BusinessConfig) {},
    }));

    const erp = isErpLoyaltyManaged({ contractedProduct: 'POS_ERP', cloudChannel: 'POS_MASTER' });
    const local = isErpLoyaltyManaged({ contractedProduct: 'POS_ONLY', cloudChannel: 'POS_CLOUD_STAGING' });
    assert.match(render(erp), /El ERP administra las reglas de este programa/);
    assert.match(render(erp), /type="checkbox" disabled/);
    assert.doesNotMatch(render(erp), /Guardar Cambios/);
    assert.match(render(local), /Guardar Cambios/);
    assert.doesNotMatch(render(local), /type="checkbox" disabled/);
});

test('an offline fallback cannot turn a disabled ERP loyalty program back on', () => {
    const config = getInitialConfig('Supermercado');
    const terminalId = config.terminals[0].id;
    const cart = [{ price: 100, quantity: 1 }] as Parameters<typeof calculatePointsEarned>[0];
    const disabled = applyTerminalConfigSnapshot(config, {
        terminalId, incomingSnapshot: { terminal_id: terminalId, resolved: {
            loyalty: { config: { ...config.loyalty, isEnabled: false } },
        } },
    }).config;
    const oldSnapshot = { terminal_id: terminalId, resolved: { loyalty: { config: config.loyalty } } };
    const offline = applyTerminalConfigSnapshot(disabled, { terminalId, cachedSnapshot: oldSnapshot }).config;
    assert.equal(calculatePointsEarned(cart, offline), 0);
    const reenabled = applyTerminalConfigSnapshot(offline, { terminalId, incomingSnapshot: oldSnapshot }).config;
    assert.equal(calculatePointsEarned(cart, reenabled), 10);
});
