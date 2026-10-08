import test from 'node:test';
import assert from 'node:assert/strict';
import { zebraWeightKg } from '../utils/zebraWeight';

test('stable metric weight preserves the scale precision', () => {
  assert.equal(zebraWeightKg({ weight: '1.235', weight_mode: 'Metric', status: '6' }), 1.235);
});
test('English pounds are converted to kg before pricing', () => {
  assert.equal(zebraWeightKg({ weight: '2', weight_mode: 'English', status: '6' }), 0.90718474);
});
test('stable zero is valid for diagnostics', () => {
  assert.equal(zebraWeightKg({ weight: '0.000', weight_mode: 'Metric', status: '5' }), 0);
});
for (const status of ['0', '1', '2', '3', '4', '7', undefined]) {
  test(`rejects unsafe or unknown scale status ${status}`, () => {
    assert.throws(() => zebraWeightKg({ weight: '1.2', weight_mode: 'Metric', status }));
  });
}
for (const weight of ['', 'NaN', 'Infinity', '-1', '1,25', '1.2kg', '1e3', undefined]) {
  test(`rejects malformed weight ${weight}`, () => {
    assert.throws(() => zebraWeightKg({ weight, weight_mode: 'Metric', status: '6' }));
  });
}
test('rejects unknown units instead of assuming kg', () => {
  assert.throws(() => zebraWeightKg({ weight: '2', weight_mode: 'grams', status: '6' }));
});
test('rejects contradictory stable status and weight', () => {
  assert.throws(() => zebraWeightKg({ weight: '1', weight_mode: 'Metric', status: '5' }));
  assert.throws(() => zebraWeightKg({ weight: '0', weight_mode: 'Metric', status: '6' }));
});
