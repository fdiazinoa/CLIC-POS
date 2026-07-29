import type { ComboGroup, ModifierGroup, Product, ProductFractionRule } from '../types';

export interface RestaurantProductConfig {
  product_type?: string;
  production_area_id?: string;
  modifier_groups: ModifierGroup[];
  fraction_rule?: ProductFractionRule;
  combo_groups: ComboGroup[];
  note_presets: string[];
  restaurant?: Record<string, unknown>;
}

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const asArray = <T = unknown>(value: unknown): T[] =>
  Array.isArray(value) ? value as T[] : [];

const asTrimmedString = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

export const resolveRestaurantProductConfig = (product?: Partial<Product> | null): RestaurantProductConfig => {
  const source = asObject(product || {});
  const restaurant = asObject(source.restaurant);

  const productType =
    asTrimmedString(source.product_type)
    || asTrimmedString(source.productType)
    || asTrimmedString(restaurant.product_type)
    || asTrimmedString(restaurant.productType)
    || asTrimmedString(source.type)
    || 'SIMPLE';

  const productionAreaId =
    asTrimmedString(source.production_area_id)
    || asTrimmedString(source.productionAreaId)
    || asTrimmedString(restaurant.production_area_id)
    || asTrimmedString(restaurant.productionAreaId)
    || asTrimmedString(asObject(source.metadata).production_area_id)
    || asTrimmedString(asObject(source.metadata).productionAreaId);

  return {
    product_type: productType || 'SIMPLE',
    production_area_id: productionAreaId || undefined,
    modifier_groups: asArray<ModifierGroup>(source.modifier_groups).length > 0
      ? asArray<ModifierGroup>(source.modifier_groups)
      : asArray<ModifierGroup>(source.modifierGroups).length > 0
        ? asArray<ModifierGroup>(source.modifierGroups)
        : asArray<ModifierGroup>(restaurant.modifier_groups).length > 0
          ? asArray<ModifierGroup>(restaurant.modifier_groups)
          : asArray<ModifierGroup>(restaurant.modifierGroups),
    fraction_rule: (source.fraction_rule || source.fractionRule || restaurant.fraction_rule || restaurant.fractionRule) as ProductFractionRule | undefined,
    combo_groups: asArray<ComboGroup>(source.combo_groups).length > 0
      ? asArray<ComboGroup>(source.combo_groups)
      : asArray<ComboGroup>(source.comboGroups).length > 0
        ? asArray<ComboGroup>(source.comboGroups)
        : asArray<ComboGroup>(restaurant.combo_groups).length > 0
          ? asArray<ComboGroup>(restaurant.combo_groups)
          : asArray<ComboGroup>(restaurant.comboGroups),
    note_presets: asArray<string>(source.note_presets).length > 0
      ? asArray<string>(source.note_presets)
      : asArray<string>(source.notePresets).length > 0
        ? asArray<string>(source.notePresets)
        : asArray<string>(restaurant.note_presets).length > 0
          ? asArray<string>(restaurant.note_presets)
          : asArray<string>(restaurant.notePresets),
    restaurant,
  };
};

export const normalizeRestaurantProductConfig = <T extends Record<string, any>>(product: T): T => {
  const resolved = resolveRestaurantProductConfig(product);
  const restaurant = {
    ...resolved.restaurant,
    product_type: resolved.product_type || 'SIMPLE',
    production_area_id: resolved.production_area_id,
    modifier_groups: resolved.modifier_groups,
    fraction_rule: resolved.fraction_rule,
    combo_groups: resolved.combo_groups,
    note_presets: resolved.note_presets,
  };

  return {
    ...product,
    product_type: resolved.product_type || 'SIMPLE',
    production_area_id: resolved.production_area_id,
    modifier_groups: resolved.modifier_groups,
    fraction_rule: resolved.fraction_rule,
    combo_groups: resolved.combo_groups,
    note_presets: resolved.note_presets,
    restaurant,
  };
};

export const productHasRestaurantConfiguration = (product?: Partial<Product> | null): boolean => {
  const resolved = resolveRestaurantProductConfig(product);
  const productType = String(resolved.product_type || '').toUpperCase();
  return (
    resolved.modifier_groups.length > 0
    || resolved.combo_groups.length > 0
    || Boolean(resolved.fraction_rule)
    || resolved.note_presets.length > 0
    || productType === 'COMBO'
    || productType === 'FRACTIONABLE'
  );
};
