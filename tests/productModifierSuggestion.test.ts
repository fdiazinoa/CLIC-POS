import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractRestaurantSuggestionTemplates,
  LOCAL_RESTAURANT_SUGGESTION_TYPES,
  normalizeRestaurantSuggestionTemplate,
} from '../components/ProductForm';

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

test('ofrece tipos de negocio seleccionables cuando el contrato ERP real trae listas vacías', () => {
  const suggestions = extractRestaurantSuggestionTemplates({
    id: '533cd4e9-bb3b-4a24-b255-f382b5af69be',
    name: 'Hamburguesa Clásica',
    category: 'Comida rápida',
    price: 350,
    images: [],
    attributes: [],
    variants: [],
    tariffs: [],
    appliedTaxIds: [],
    modifier_groups: [],
    modifierGroups: [],
    combo_groups: [],
    comboGroups: [],
    restaurant: {
      modifier_groups: [],
      combo_groups: [],
    },
  });

  assert.equal(suggestions.length, LOCAL_RESTAURANT_SUGGESTION_TYPES.length);
  assert.equal(suggestions[0].id, 'fast_food');
  assert.deepEqual(
    new Set(suggestions.map(suggestion => suggestion.id)),
    new Set(['fast_food', 'pizzeria', 'casual', 'cafeteria_bar', 'heladeria_postres', 'dark_kitchen']),
  );
  assert.ok(suggestions.every(suggestion => suggestion.origin === 'LOCAL'));
  const restaurantSuggestion = suggestions.find(suggestion => suggestion.id === 'casual');
  assert.ok(restaurantSuggestion?.modifier_groups.some(group => group.name === 'Término de cocción'));
  assert.ok(restaurantSuggestion?.note_presets.includes('Para llevar'));
});

test('prioriza el tipo inferido pero permite cambiar a cualquier concepto', () => {
  const suggestions = extractRestaurantSuggestionTemplates({
    id: 'pizza-1',
    name: 'Pizza especial',
    category: 'Pizzería',
    price: 500,
    images: [],
    attributes: [],
    variants: [],
    tariffs: [],
    appliedTaxIds: [],
  });

  assert.equal(suggestions[0].id, 'pizzeria');
  assert.ok(suggestions.some(suggestion => suggestion.id === 'cafeteria_bar'));
  assert.ok(suggestions.some(suggestion => suggestion.id === 'fast_food'));
});

test('mantiene autoritativa una sugerencia ERP y no agrega plantillas locales', () => {
  const suggestions = extractRestaurantSuggestionTemplates({
    id: 'pizza-1',
    name: 'Pizza especial',
    category: 'Pizzería',
    price: 500,
    images: [],
    attributes: [],
    variants: [],
    tariffs: [],
    appliedTaxIds: [],
    restaurantSuggestionTemplate: {
      id: 'erp-pizza',
      template: {
        modifier_groups: [{
          id: 'erp-size',
          name: 'Tamaño ERP',
          modifiers: [{ id: 'large', name: 'Grande' }],
        }],
      },
    },
  } as any);

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].id, 'erp-pizza');
  assert.equal(suggestions[0].modifier_groups[0].name, 'Tamaño ERP');
});
