import type { Product } from '../types';
import { normalizeRestaurantProductConfig, resolveRestaurantProductConfig } from './restaurantProductConfig';

export type ProductionRoutingStrategy = 'NO_PRODUCTION_AREAS' | 'PROMPT_ASSIGNMENT' | 'DISPATCH';

export const shouldRefreshClientProductionRouting = (input: {
  isClientTerminal: boolean;
  pendingItemCount: number;
  unresolvedRouteCount: number;
}): boolean => (
  input.isClientTerminal
  && input.pendingItemCount > 0
  && input.unresolvedRouteCount > 0
);

export const selectProductionRoutingStrategy = (input: {
  productionAreaCount: number;
  pendingItemCount: number;
  unassignedItemCount: number;
}): ProductionRoutingStrategy => {
  if (input.productionAreaCount <= 0) return 'NO_PRODUCTION_AREAS';
  if (input.pendingItemCount > 0 && input.unassignedItemCount > 0) return 'PROMPT_ASSIGNMENT';
  return 'DISPATCH';
};

export const applyProductionAreaAssignments = (
  products: Product[],
  assignments: Readonly<Record<string, string>>,
  updatedAt = new Date().toISOString(),
): { products: Product[]; updatedProducts: Product[] } => {
  const updatedProducts: Product[] = [];
  const nextProducts = products.map((product) => {
    const productionAreaId = String(assignments[String(product.id)] || '').trim();
    if (!productionAreaId) return product;

    const current = resolveRestaurantProductConfig(product);
    if (current.production_area_id === productionAreaId) return product;

    const updated = normalizeRestaurantProductConfig({
      ...product,
      production_area_id: productionAreaId,
      restaurant: {
        ...(product.restaurant || {}),
        production_area_id: productionAreaId,
        product_type: current.product_type || product.product_type || 'SIMPLE',
      },
      updatedAt,
    });
    updatedProducts.push(updated);
    return updated;
  });

  return { products: nextProducts, updatedProducts };
};
