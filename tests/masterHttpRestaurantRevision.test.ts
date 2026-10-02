import assert from 'node:assert/strict';
import test from 'node:test';
import { canApplyMasterHttpRestaurantRevision } from '../utils/masterHttpRestaurantRevision';

test('a delayed HTTP 807 updater cannot overwrite native revision 808', () => {
  const responseRevision = 807;
  let knownRevision = 807;
  let appliedRevision = 807;
  const previousTables = [{ id: 'mesa-2', order: 'native-808' }];
  const staleHttpTables = [{ id: 'mesa-2', order: 'http-807' }];
  const deferredUpdater = (previous: typeof previousTables) =>
    canApplyMasterHttpRestaurantRevision({ responseRevision, knownRevision, appliedRevision })
      ? staleHttpTables
      : previous;

  knownRevision = 808;
  appliedRevision = 808;
  assert.strictEqual(deferredUpdater(previousTables), previousTables);
});

test('revisionless Master HTTP bootstrap is allowed only before native authority advances', () => {
  assert.equal(canApplyMasterHttpRestaurantRevision({
    responseRevision: 0,
    knownRevision: 0,
    appliedRevision: 0,
  }), true);
  assert.equal(canApplyMasterHttpRestaurantRevision({
    responseRevision: 0,
    knownRevision: 808,
    appliedRevision: 808,
  }), false);
});
