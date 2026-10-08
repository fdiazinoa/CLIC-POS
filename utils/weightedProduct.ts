/** Existing POS weight classification shared by click and barcode entry. */
export function isWeightedProduct(product: { type?: string; name?: string }): boolean {
  return product.type === 'SERVICE' || (product.name || '').toLowerCase().includes('(peso)');
}
