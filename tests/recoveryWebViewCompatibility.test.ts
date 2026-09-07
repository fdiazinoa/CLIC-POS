import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryCanonicalJson } from '../services/recovery/RecoveryJson';
import { projectNativeZConfiguration } from '../services/recovery/NativeZConfiguration';

test('capture canonicalization and historical configuration work without Object.hasOwn', () => {
  const descriptor = Object.getOwnPropertyDescriptor(Object, 'hasOwn')!;
  Object.defineProperty(Object, 'hasOwn', { ...descriptor, value: undefined });
  try {
    assert.equal(recoveryCanonicalJson({payments: [{amount: 550}], hasOwnProperty: null}), '{"hasOwnProperty":null,"payments":[{"amount":550}]}');
    assert.throws(() => recoveryCanonicalJson(new Array(1)), /RECOVERY_JSON_ARRAY/);
    const config = Object.create(null);
    config.currencies = [{code: 'DOP', exchangeRate: 1, isBase: true}];
    config.hasOwnProperty = null;
    const projected = projectNativeZConfiguration(config);
    assert.deepEqual(projected.currencies, config.currencies);
    assert.equal(Object.prototype.hasOwnProperty.call(projected, 'taxRate'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(projected, 'hasOwnProperty'), false);
  } finally {
    Object.defineProperty(Object, 'hasOwn', descriptor);
  }
});
