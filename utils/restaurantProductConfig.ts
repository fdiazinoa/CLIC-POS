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

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const firstPresentRestaurantValue = (
  source: Record<string, unknown>,
  restaurant: Record<string, unknown>,
  snakeKey: string,
  camelKey: string,
): { present: boolean; value: unknown } => {
  if (hasOwn(source, snakeKey)) return { present: true, value: source[snakeKey] };
  if (hasOwn(source, camelKey)) return { present: true, value: source[camelKey] };
  if (hasOwn(restaurant, snakeKey)) return { present: true, value: restaurant[snakeKey] };
  if (hasOwn(restaurant, camelKey)) return { present: true, value: restaurant[camelKey] };
  return { present: false, value: undefined };
};

export const resolveRestaurantProductConfig = (product?: Partial<Product> | null): RestaurantProductConfig => {
  const source = asObject(product || {});
  const restaurant = asObject(source.restaurant);

  const productTypeValue = firstPresentRestaurantValue(source, restaurant, 'product_type', 'productType');
  const productionAreaValue = firstPresentRestaurantValue(source, restaurant, 'production_area_id', 'productionAreaId');
  const modifierGroupsValue = firstPresentRestaurantValue(source, restaurant, 'modifier_groups', 'modifierGroups');
  const fractionRuleValue = firstPresentRestaurantValue(source, restaurant, 'fraction_rule', 'fractionRule');
  const comboGroupsValue = firstPresentRestaurantValue(source, restaurant, 'combo_groups', 'comboGroups');
  const notePresetsValue = firstPresentRestaurantValue(source, restaurant, 'note_presets', 'notePresets');

  const productType =
    (productTypeValue.present ? asTrimmedString(productTypeValue.value) : '')
    || asTrimmedString(source.type)
    || 'SIMPLE';

  const productionAreaId =
    (productionAreaValue.present ? asTrimmedString(productionAreaValue.value) : '')
    || (!productionAreaValue.present
      ? asTrimmedString(asObject(source.metadata).production_area_id)
        || asTrimmedString(asObject(source.metadata).productionAreaId)
      : '');

  return {
    product_type: productType || 'SIMPLE',
    production_area_id: productionAreaId || undefined,
    modifier_groups: asArray<ModifierGroup>(modifierGroupsValue.value),
    fraction_rule: (fractionRuleValue.value || undefined) as ProductFractionRule | undefined,
    combo_groups: asArray<ComboGroup>(comboGroupsValue.value),
    note_presets: asArray<string>(notePresetsValue.value),
    restaurant,
  };
};

/**
 * Treat an incoming product as a patch only for restaurant configuration.
 * Missing families retain their local value; an explicitly present empty or
 * null family remains authoritative. Accepted aliases are stored canonically.
 */
export const mergeIncomingRestaurantProductConfig = <T extends Record<string, any>>(
  incoming: T,
  localProduct?: Partial<Product> | null,
): T => {
  const source = asObject(incoming);
  const incomingRestaurant = asObject(source.restaurant);
  const local = resolveRestaurantProductConfig(localProduct);
  const localRestaurant = asObject(localProduct?.restaurant);
  const hasLocalProduct = Boolean(localProduct);

  const familyValue = (snakeKey: string, camelKey: string, fallback: unknown): unknown => {
    const present = firstPresentRestaurantValue(source, incomingRestaurant, snakeKey, camelKey);
    return present.present ? present.value : fallback;
  };

  const productTypeRaw = familyValue('product_type', 'productType', hasLocalProduct ? local.product_type : undefined);
  const incomingProductionArea = firstPresentRestaurantValue(source, incomingRestaurant, 'production_area_id', 'productionAreaId');
  const metadataProductionArea = asTrimmedString(asObject(source.metadata).production_area_id)
    || asTrimmedString(asObject(source.metadata).productionAreaId);
  const productionAreaRaw = incomingProductionArea.present
    ? incomingProductionArea.value
    : metadataProductionArea || (hasLocalProduct ? local.production_area_id : undefined);
  const modifierGroups = asArray<ModifierGroup>(familyValue('modifier_groups', 'modifierGroups', hasLocalProduct ? local.modifier_groups : undefined));
  const fractionRule = familyValue('fraction_rule', 'fractionRule', hasLocalProduct ? local.fraction_rule : undefined) as ProductFractionRule | null | undefined;
  const comboGroups = asArray<ComboGroup>(familyValue('combo_groups', 'comboGroups', hasLocalProduct ? local.combo_groups : undefined));
  const notePresets = asArray<string>(familyValue('note_presets', 'notePresets', hasLocalProduct ? local.note_presets : undefined));
  const productType = asTrimmedString(productTypeRaw) || asTrimmedString(source.type) || 'SIMPLE';
  const productionAreaId = asTrimmedString(productionAreaRaw) || undefined;
  const normalizedFractionRule = fractionRule || undefined;
  const restaurant: Record<string, unknown> = {
    ...localRestaurant,
    ...incomingRestaurant,
    product_type: productType,
    production_area_id: productionAreaId,
    modifier_groups: modifierGroups,
    fraction_rule: normalizedFractionRule,
    combo_groups: comboGroups,
    note_presets: notePresets,
  };
  for (const alias of ['productType', 'productionAreaId', 'modifierGroups', 'fractionRule', 'comboGroups', 'notePresets']) {
    delete restaurant[alias];
  }

  const canonicalIncoming: Record<string, unknown> = { ...incoming };
  for (const alias of ['productType', 'productionAreaId', 'modifierGroups', 'fractionRule', 'comboGroups', 'notePresets']) {
    delete canonicalIncoming[alias];
  }

  return {
    ...canonicalIncoming,
    product_type: productType,
    production_area_id: productionAreaId,
    modifier_groups: modifierGroups,
    fraction_rule: normalizedFractionRule,
    combo_groups: comboGroups,
    note_presets: notePresets,
    restaurant,
  } as unknown as T;
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
