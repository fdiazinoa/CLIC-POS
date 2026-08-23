import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyMasterPullFailure } from '../services/sync/masterPullFailure';

test('401 remains an authentication failure even without a backend code', () => {
    const result = classifyMasterPullFailure({
        collection: 'suppliers',
        status: 401,
    });

    assert.equal(result.kind, 'AUTHENTICATION');
    assert.equal(result.backendCode, 'AUTH_REQUIRED');
    assert.match(result.message, /Falta autenticación\/syncToken/);
});

test('an invalid sync token remains an authentication failure', () => {
    const result = classifyMasterPullFailure({
        collection: 'customers',
        status: 403,
        backendCode: 'SYNC_TOKEN_INVALID',
    });

    assert.equal(result.kind, 'AUTHENTICATION');
    assert.equal(result.backendCode, 'SYNC_TOKEN_INVALID');
    assert.match(result.message, /Falta autenticación\/syncToken/);
});

test('PULL_MASTERS_NOT_ALLOWED is reported as a license or operational block', () => {
    const result = classifyMasterPullFailure({
        collection: 'suppliers',
        status: 403,
        responseBody: JSON.stringify({
            status: 'error',
            code: 'PULL_MASTERS_NOT_ALLOWED',
            message: 'Esta terminal no tiene permitido descargar maestros desde ERP.',
            activation: {
                billing_status: 'SUSPENDED',
            },
        }),
    });

    assert.equal(result.kind, 'OPERATIONAL_ACCESS');
    assert.equal(result.authStatus, 'ACCESS_BLOCKED');
    assert.match(result.message, /licencia, facturación o permisos operativos/);
    assert.doesNotMatch(result.message, /Falta autenticación|syncToken/);
});

test('SYNC_SCOPE_FORBIDDEN identifies an inconsistent terminal scope', () => {
    const result = classifyMasterPullFailure({
        collection: 'products',
        status: 403,
        backendCode: 'SYNC_SCOPE_FORBIDDEN',
    });

    assert.equal(result.kind, 'SCOPE');
    assert.match(result.message, /tenant, empresa, sucursal y terminal/);
    assert.doesNotMatch(result.message, /Falta autenticación|syncToken/);
});

test('an unknown 403 remains forbidden without claiming that the token is missing', () => {
    const result = classifyMasterPullFailure({
        collection: 'suppliers',
        status: 403,
    });

    assert.equal(result.kind, 'OPERATIONAL_ACCESS');
    assert.equal(result.backendCode, 'PULL_MASTERS_FORBIDDEN');
    assert.doesNotMatch(result.message, /Falta autenticación|syncToken/);
});
