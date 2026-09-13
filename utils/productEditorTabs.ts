export interface ProductEditorCapabilities {
  inventory: boolean;
  variants: boolean;
  production: boolean;
}

export const resolveProductEditorCapabilities = (
  productTypeValue: unknown,
  restaurantContext: boolean,
): ProductEditorCapabilities => {
  const productType = String(productTypeValue || 'PRODUCT').trim().toUpperCase();

  return {
    inventory: productType !== 'SERVICE',
    variants: !restaurantContext && ['PRODUCT', 'PRODUCTO_TERMINADO', 'SIMPLE'].includes(productType),
    production: restaurantContext || ['RECETA', 'KIT', 'COMBO', 'FRACTIONABLE', 'PRODUCTO_TERMINADO'].includes(productType),
  };
};
