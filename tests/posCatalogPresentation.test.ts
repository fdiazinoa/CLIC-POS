import assert from 'node:assert/strict';
import test from 'node:test';

import {
  comparePosProducts,
  normalizeCategoryColor,
  resolveClassificationActive,
  resolveClassificationSortOrder,
  resolveProductPosSortOrder,
} from '../utils/posCatalogPresentation';

test('normaliza metadata de presentación recibida en camelCase o snake_case', () => {
  assert.equal(resolveClassificationSortOrder({ sort_order: 3 }), 3);
  assert.equal(resolveClassificationSortOrder({ displayOrder: 4 }), 4);
  assert.equal(resolveClassificationActive({ is_active: false }), false);
  assert.equal(resolveClassificationActive({}), true);
  assert.equal(normalizeCategoryColor('#0af'), '#00AAFF');
  assert.equal(normalizeCategoryColor('red'), undefined);
});

test('ordena artículos por posición POS y usa el nombre como desempate estable', () => {
  const corona = { id: '2', name: 'Corona', category: 'Cervezas', price: 1, pos_sort_order: 2 } as any;
  const presidente = { id: '1', name: 'Presidente', category: 'Cervezas', price: 1, posSortOrder: 1 } as any;
  assert.equal(resolveProductPosSortOrder(corona), 2);
  assert.deepEqual([corona, presidente].sort(comparePosProducts).map(product => product.name), ['Presidente', 'Corona']);
});
