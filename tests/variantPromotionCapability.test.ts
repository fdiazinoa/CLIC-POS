import assert from 'node:assert/strict';
import test from 'node:test';

import {
  POS_SYNC_CAPABILITY_VERSIONS,
  supportsVariantPromotionsCapability,
  VARIANT_PROMOTIONS_CAPABILITY,
} from '../utils/syncCapabilities';

test('capability VARIANT_PROMOTIONS publica versión de contrato 1', () => {
  assert.equal(VARIANT_PROMOTIONS_CAPABILITY, 'VARIANT_PROMOTIONS');
  assert.equal(POS_SYNC_CAPABILITY_VERSIONS.VARIANT_PROMOTIONS, 1);
});

test('una terminal sin capability VARIANT_PROMOTIONS no se considera compatible', () => {
  assert.equal(supportsVariantPromotionsCapability([]), false);
  assert.equal(supportsVariantPromotionsCapability(['CONFIG_PUSH_V2']), false);
  assert.equal(supportsVariantPromotionsCapability(['variant_promotions']), true);
});
