import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import LicenseAcceptance from '../components/LicenseAcceptance';
import { acceptanceKey, readLicenseAcceptance, recordLicenseAcceptance } from '../utils/licenseAcceptance';
import { licenseClause, LICENSE_DOCUMENT_HASH } from '../legal/licenseClause';

const identity = { tenantId: 'tenant-a', legalName: 'Cliente de prueba SRL', userId: 'installer-a', userName: 'Instalador' };
function memory() {
    const data = new Map<string, string>();
    return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}
test('reading and declining create no acceptance; confirmation is mandatory', () => {
    const storage = memory();
    assert.equal(readLicenseAcceptance(storage, identity.tenantId), null);
    assert.throws(() => recordLicenseAcceptance(storage, identity, false));
    assert.equal(storage.data.size, 0);
});
test('explicit acceptance stores exact tenant, user, text identity and local UTC before reuse', () => {
    const storage = memory();
    const record = recordLicenseAcceptance(storage, identity, true, new Date('2026-10-23T12:00:00Z'));
    assert.deepEqual(readLicenseAcceptance(storage, identity.tenantId), record);
    assert.equal(record.acceptedAtDeviceUtc, '2026-10-23T12:00:00.000Z');
    assert.equal(record.timeSource, 'device');
    assert.equal(record.documentHash, LICENSE_DOCUMENT_HASH);
    assert.deepEqual(recordLicenseAcceptance(storage, { ...identity, userId: 'other-user' }, true, new Date('2026-10-24')), record);
    assert.equal(storage.data.size, 1);
    assert.equal(readLicenseAcceptance(storage, 'other-tenant'), null);
    assert.equal('email' in record, false);
});
test('write denied, silent loss and damaged read fail closed; retry can succeed', () => {
    assert.throws(() => recordLicenseAcceptance({ getItem: () => null, setItem: () => { throw Error('Quota'); } }, identity, true));
    assert.throws(() => recordLicenseAcceptance({ getItem: () => null, setItem: () => {} }, identity, true));
    const storage = memory();
    storage.data.set(acceptanceKey(identity.tenantId), '{broken');
    assert.equal(readLicenseAcceptance(storage, identity.tenantId), null);
    assert.ok(recordLicenseAcceptance(storage, identity, true));
    assert.ok(readLicenseAcceptance(storage, identity.tenantId));
});
test('old version/hash and foreign tenant records cannot bypass renewed acceptance', () => {
    for (const patch of [{ version: '0.9' }, { documentHash: 'stale' }, { tenantId: 'other' }]) {
        const storage = memory();
        const original = recordLicenseAcceptance(storage, identity, true);
        storage.data.set(acceptanceKey(identity.tenantId), JSON.stringify({ ...original, ...patch }));
        assert.equal(readLicenseAcceptance(storage, identity.tenantId), null);
        assert.equal(recordLicenseAcceptance(storage, identity, true).documentHash, LICENSE_DOCUMENT_HASH);
    }
});
test('UI contains full text, unchecked checkbox, disabled primary and generic PDF link without accepting', () => {
    let calls = 0;
    const markup = renderToStaticMarkup(React.createElement(LicenseAcceptance, { identity, onAccepted: () => { calls++; } }));
    assert.match(markup, /Descargar cláusula completa en PDF/);
    assert.match(markup, /type="checkbox"/);
    assert.doesNotMatch(markup, /checked=""/);
    assert.match(markup, /<button[^>]*disabled=""/);
    for (const section of licenseClause.sections) assert.ok(markup.includes(section.text));
    assert.equal(licenseClause.sections.length, 13);
    assert.equal(calls, 0);
});
test('activation paths share the gate before identity writes; no premature success timer', () => {
    const activation = readFileSync(new URL('../components/ActivationScreen.tsx', import.meta.url), 'utf8');
    assert.equal((activation.match(/await completeActivation\(data.user, email\)/g) || []).length, 2);
    assert.match(activation, /VITE_LICENSE_ACCEPTANCE_ENABLED === 'true'/);
    assert.doesNotMatch(activation, /setTimeout|setStep\('SUCCESS'\)/);
});

test('local mode selection retains its existing identity-free callback and creates no false acceptance', () => {
    const activation = readFileSync(new URL('../components/ActivationScreen.tsx', import.meta.url), 'utf8');
    const body = activation.split('const continueToTerminalModeSelection = () => {')[1]?.split('\n    };')[0];
    assert.ok(body, 'Existing mode selector remains present');
    let selected: Record<string, unknown> | undefined;
    const run = new Function('setError', 'onActivationComplete', body);
    run(() => {}, (value: Record<string, unknown>) => { selected = value; });
    assert.equal(selected?.activationMode, 'LOCAL_OR_ERP');
    assert.equal(selected?.tenantId, '');
    assert.doesNotMatch(body, /localStorage|recordLicenseAcceptance|readLicenseAcceptance/);
});
