import {normalizeV3RestaurantSelection} from './v3RestaurantSelection';
import type {Product} from '../types';
import { isInactiveFractionRule } from './inactiveFractionRule';
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};

/** Accept only bounded simple routing from the immutable V3 article. */
export function v3RestaurantContract(source: Record<string, unknown>): Pick<Product,'product_type'|'production_area_id'|'combo_groups'|'modifier_groups'|'fraction_rule'|'note_presets'> {
  if (source.restaurant_contract_version === 1 && source.restaurant_inventory_policy === 'PARENT') {
    if(source.restaurant_unsupported !== false) throw Error('Contrato restaurante inválido');
    return normalizeV3RestaurantSelection(source);
  }
  if (source.restaurant_unsupported !== undefined && source.restaurant_unsupported !== false) throw Error('Configuración avanzada de restaurante no soportada');
  const rows = [source, ...['restaurant', 'restaurantConfig', 'restaurant_config', 'comanda', 'command'].map(key => object(source[key]))];
  if (rows.some(row => ['recipeDetails', 'recipe_details', 'modifiers', 'availableModifiers', 'modifier_groups', 'modifierGroups',
    'combo_groups', 'comboGroups', 'note_presets', 'notePresets'].some(key => row[key] != null && (!Array.isArray(row[key]) || (row[key] as unknown[]).length > 0))
    || ['fraction_rule', 'fractionRule'].some(key => row[key] != null && !isInactiveFractionRule(row[key]))
    || (row.product_type != null || row.productType != null)
      && !['SIMPLE', 'SERVICE'].includes(String(row.product_type ?? row.productType).toUpperCase()))) throw Error('Configuración avanzada de restaurante no soportada');
  const type = source.product_type;
  const route = source.production_area_id;
  if (type !== undefined && type !== 'SIMPLE' && type !== 'SERVICE') throw Error('Tipo de restaurante inválido');
  if (route != null && (typeof route !== 'string' || !route.trim() || route.length > 128)) throw Error('Centro de producción inválido');
  return { ...(type === 'SIMPLE' || type === 'SERVICE' ? { product_type: type } : {}), ...(typeof route === 'string' ? { production_area_id: route.trim() } : {}) };
}
