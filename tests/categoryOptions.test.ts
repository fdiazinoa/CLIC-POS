import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCategoryOption, preferCategoryOptionWithErpIdentity } from '../utils/categoryOptions';

const modaErpId = '727a51b9-1338-4253-9dc0-b11cee4ff7f7';

test('a synchronized ERP category replaces a same-name legacy POS option', () => {
  const legacy = normalizeCategoryOption('Moda');
  const synchronized = normalizeCategoryOption({ id: modaErpId, name: 'Moda' });
  assert.ok(legacy);
  assert.ok(synchronized);
  assert.deepEqual(preferCategoryOptionWithErpIdentity(legacy, synchronized), {
    id: modaErpId,
    name: 'Moda',
  });
});

test('category aliases expose their ERP category identity', () => {
  assert.deepEqual(normalizeCategoryOption({
    pos_category_id: modaErpId,
    pos_category_name: 'Moda',
  }), {
    id: modaErpId,
    name: 'Moda',
  });
});

test('a later legacy duplicate cannot replace an ERP identity', () => {
  const synchronized = { id: modaErpId, name: 'Moda' };
  assert.equal(preferCategoryOptionWithErpIdentity(synchronized, { id: 'Moda', name: 'Moda' }), synchronized);
});
