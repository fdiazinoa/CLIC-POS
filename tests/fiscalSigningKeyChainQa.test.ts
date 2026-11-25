import assert from 'node:assert/strict';
import test from 'node:test';
import { captureFiscalStatusBoundContext } from '../services/fiscal/FiscalBoundContext';
import { verifyFiscalKeyChainQa } from '../services/fiscal/FiscalSigningKeyChainQa';

const terminalId = 'test-terminal';
const issuer = '101010101';
const fingerprint = '0a'.repeat(32);

function fixture() {
    const identity = {
        erpSyncBaseUrl: 'https://erp.example.invalid/api/sync',
        tenantId: 'tenant', terminalId, deviceId: 'device', syncToken: 'synthetic-sync-token',
    };
    let credentials = {
        ...identity, companyId: 'company', storeId: 'store', deviceToken: 'synthetic-device-token',
        authStatus: 'AUTHENTICATED', deviceTokenSource: 'ERP_REGISTER',
    };
    return {
        supported: () => true,
        readAuth: () => captureFiscalStatusBoundContext(() => identity, () => credentials),
        readCertificate: async (value: string) => { assert.equal(value, issuer); return fingerprint; },
        rotate: () => { credentials = { ...credentials, deviceToken: 'rotated-synthetic-token' }; },
    };
}

test('checks the ERP fingerprint before and after the explicit Android selection', async () => {
    const deps = fixture();
    const events: string[] = [];
    await verifyFiscalKeyChainQa(terminalId, issuer, {
        ...deps,
        readCertificate: async value => { events.push('ERP'); return deps.readCertificate(value); },
        native: { verify: async input => {
            assert.deepEqual(input, { certificateSha256: fingerprint });
            events.push('KeyChain');
            return { verified: true };
        } },
    });
    assert.deepEqual(events, ['ERP', 'KeyChain', 'ERP']);
});

test('skips the picker for an unsupported package, different terminal or missing approval', async () => {
    const deps = { ...fixture(), native: { verify: async () => assert.fail('Unexpected KeyChain selection') } };
    await assert.rejects(verifyFiscalKeyChainQa(terminalId, issuer, { ...deps, supported: () => false }),
        /KEYCHAIN_UNAVAILABLE/);
    await assert.rejects(verifyFiscalKeyChainQa('other', issuer, deps), /TERMINAL_CHANGED/);
    await assert.rejects(verifyFiscalKeyChainQa(terminalId, issuer, { ...deps, readCertificate: async () => null }),
        /CERTIFICATE_AUTHORITY_REQUIRED/);
});

test('rejects a rotated device token or a withdrawn approval during selection', async () => {
    const rotated = fixture();
    await assert.rejects(verifyFiscalKeyChainQa(terminalId, issuer, {
        ...rotated,
        native: { verify: async () => { rotated.rotate(); return { verified: true }; } },
    }), /SCOPE_CHANGED/);
    let reads = 0;
    await assert.rejects(verifyFiscalKeyChainQa(terminalId, issuer, {
        ...fixture(),
        readCertificate: async () => ++reads === 1 ? fingerprint : null,
        native: { verify: async () => ({ verified: true }) },
    }), /CERTIFICATE_AUTHORITY_CHANGED/);
});
