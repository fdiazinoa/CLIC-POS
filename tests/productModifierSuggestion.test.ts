import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeRestaurantSuggestionTemplate } from '../components/ProductForm';

test('lee modificadores cuando la sugerencia ERP viene dentro de template', () => {
  const suggestion = normalizeRestaurantSuggestionTemplate({
    id: 'burger-template',
    name: 'Hamburguesa',
    template: {
      product_type: 'SIMPLE',
      modifier_groups: [{
        id: 'cooking',
        name: 'Término',
        selection_type: 'SINGLE',
        modifiers: [
          { id: 'medium', name: 'Término medio', price_delta: 0 },
          { id: 'well-done', name: 'Bien cocida', price_delta: 0 },
        ],
      }],
    },
  }, 'fallback', 'Plantilla');

  assert.equal(suggestion?.id, 'burger-template');
  assert.equal(suggestion?.modifier_groups.length, 1);
  assert.deepEqual(
    suggestion?.modifier_groups[0].modifiers.map(modifier => modifier.name),
    ['Término medio', 'Bien cocida'],
  );
});

test('lee modificadores cuando la sugerencia ERP viene dentro de data/config', () => {
  const suggestion = normalizeRestaurantSuggestionTemplate({
    config: {
      name: 'Extras',
      available_modifiers: [
        { modifier_id: 'cheese', nombre: 'Queso extra', precio: 35 },
      ],
    },
  }, 'extras', 'Extras');

  assert.equal(suggestion?.modifier_groups.length, 1);
  assert.equal(suggestion?.modifier_groups[0].modifiers[0].name, 'Queso extra');
  assert.equal(suggestion?.modifier_groups[0].modifiers[0].price_delta, 35);
});
