import assert from 'node:assert/strict';
import test from 'node:test';
import { validateV3RestaurantSelection } from '../utils/v3RestaurantSelection';

const QUESO = { id: 'q', product_id: 'p-q', name: 'Queso extra', modifier_type: 'ADD', affects_price: true, price_delta: 30 };
const TOCINETA = { id: 't', product_id: 'p-t', name: 'Tocineta', modifier_type: 'ADD', affects_price: true, price_delta: 50 };

const source = (group: Record<string, unknown> = {}) => ({
  price: 100,
  product_type: 'SIMPLE',
  production_area_id: 'COCINA',
  combo_groups: [],
  modifier_groups: [{
    id: 'extras', name: 'Extras', active: true, required: false, min_select: 0, max_select: 3,
    free_quantity: 0, sort_order: 1, selection_type: 'MULTIPLE', modifiers: [QUESO, TOCINETA], ...group,
  }],
  fraction_rule: undefined,
  note_presets: [],
}) as any;

const build = (
  product: ReturnType<typeof source>,
  selection: Record<string, unknown>,
  rows: unknown[],
  price: number,
) => ({
  id: 'line', cartId: 'line', quantity: 1, price, originalPrice: price,
  restaurantConfig: {
    product_type: 'SIMPLE', production_area_id: 'COCINA',
    comboGroups: {}, modifierGroups: selection, fractions: [],
    selected_modifiers: rows, selected_combo_items: [], selected_fraction_parts: [],
  },
  selected_modifiers: rows, selected_combo_items: [], selected_fraction_parts: [],
}) as any;

const row = (extra: Record<string, unknown> = {}) => ({
  group_id: 'extras', group_name: 'Extras', modifier_id: 'q', product_id: 'p-q',
  name: 'Queso extra', modifier_type: 'ADD', affects_price: true, price_delta: 30, ...extra,
});

test('dos unidades del mismo extra cuestan dos veces y la fila lo declara', () => {
  const product: any = source();
  const rows = [row({ quantity: 2 })];
  assert.equal(validateV3RestaurantSelection(build(product, { extras: [{ id: 'q', quantity: 2 }] }, rows, 160), product), 160);
  // Pagar una sola unidad no cuadra con la autoridad.
  assert.throws(() => validateV3RestaurantSelection(build(product, { extras: [{ id: 'q', quantity: 2 }] }, rows, 130), product));
});

test('la forma antigua (solo ids) sigue valiendo y no declara cantidad', () => {
  const product: any = source();
  const rows = [row()];
  assert.equal(validateV3RestaurantSelection(build(product, { extras: ['q'] }, rows, 130), product), 130);
  // Un quantity:1 explícito compara igual que la fila sin campo.
  assert.equal(validateV3RestaurantSelection(build(product, { extras: [{ id: 'q', quantity: 1 }] }, rows, 130), product), 130);
});

test('la cantidad respeta el máximo del grupo, la unicidad y los enteros', () => {
  const product: any = source();
  const tooMany = [row({ quantity: 4, price_delta: 30 })];
  assert.throws(() => validateV3RestaurantSelection(build(product, { extras: [{ id: 'q', quantity: 4 }] }, tooMany, 220), product));
  // 2 + 2 unidades supera el máximo de 3.
  assert.throws(() => validateV3RestaurantSelection(build(product, { extras: [{ id: 'q', quantity: 2 }, { id: 't', quantity: 2 }] }, [row({ quantity: 2 }), row({ modifier_id: 't', name: 'Tocineta', product_id: 'p-t', price_delta: 50, quantity: 2 })], 260), product));
  // Ids repetidos siguen prohibidos: la repetición es cantidad.
  assert.throws(() => validateV3RestaurantSelection(build(product, { extras: ['q', 'q'] }, [row()], 130), product));
  // Cantidad 0 o fraccionaria no es una cantidad.
  assert.throws(() => validateV3RestaurantSelection(build(product, { extras: [{ id: 'q', quantity: 0 }] }, [row()], 100), product));
  assert.throws(() => validateV3RestaurantSelection(build(product, { extras: [{ id: 'q', quantity: 1.5 }] }, [row()], 145), product));
});

test('un grupo de selección única no admite cantidades', () => {
  const product: any = source({ selection_type: 'SINGLE', max_select: 1 });
  assert.throws(() => validateV3RestaurantSelection(build(product, { extras: [{ id: 'q', quantity: 2 }] }, [row({ quantity: 2 })], 160), product));
});

test('free_quantity se consume por unidad, no por opción', () => {
  const product: any = source({ free_quantity: 1 });
  const rows = [row({ quantity: 2 })];
  // La primera unidad es gratis y la segunda se cobra.
  assert.equal(validateV3RestaurantSelection(build(product, { extras: [{ id: 'q', quantity: 2 }] }, rows, 130), product), 130);
});

test('el modal ofrece cantidad solo en grupos múltiples y la envía con la selección', async () => {
  const { readFileSync } = await import('node:fs');
  const modal = readFileSync(new URL('../components/ModifierModal.tsx', import.meta.url), 'utf8');
  assert.match(modal, /const changeOptionUnits = useCallback/);
  assert.match(modal, /selection_type !== 'SINGLE' && Number\(group\.max_select \|\| 0\) > 1/);
  assert.match(modal, /\.\.\.\(unitsFor\(group\.id, modifier\.id\) > 1 \? \{ quantity: unitsFor\(group\.id, modifier\.id\) \} : \{\}\)/);
  assert.match(modal, /ids\.map\(id => \(unitsFor\(groupId, id\) > 1 \? \{ id, quantity: unitsFor\(groupId, id\) \} : id\)\)/);
  assert.match(modal, /getModifierPrice\(modifier\) \* \(units - free\)/);
});

test('la cantidad solo se ofrece cuando el ERP la anuncia', async () => {
  const { modifierQuantitiesSupported, setModifierQuantitiesSupported, resetModifierQuantitiesSupport } =
    await import('../utils/modifierQuantitiesCapability');
  const store = new Map<string, string>();
  (globalThis as any).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
    },
  };
  try {
    resetModifierQuantitiesSupport();
    assert.equal(modifierQuantitiesSupported(), false, 'sin anuncio del ERP no hay cantidades');
    setModifierQuantitiesSupported(true);
    assert.equal(modifierQuantitiesSupported(), true);
    // La observación sobrevive al arranque siguiente (la capacidad se cachea).
    resetModifierQuantitiesSupport();
    assert.equal(modifierQuantitiesSupported(), true);
    // Un equipo puede forzarlo o apagarlo para probar.
    store.set('CLIC_MODIFIER_QUANTITIES', '0');
    assert.equal(modifierQuantitiesSupported(), false);
    store.delete('CLIC_MODIFIER_QUANTITIES');
    setModifierQuantitiesSupported(false);
    assert.equal(modifierQuantitiesSupported(), false);
  } finally {
    delete (globalThis as any).window;
  }
});
