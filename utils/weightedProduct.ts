/** Explicit weighted flags also support ERP products without a display-name convention. */
export function isWeightedProduct(product: { type?: string; name?: string; measurementUnit?: unknown; purchaseUnit?: unknown; conversionFactor?: unknown; operationalFlags?: { isWeighted?: boolean }; v3SaleAuthority?: unknown }): boolean {
  if (product.v3SaleAuthority) return hasV3KilogramContract(product);
  return product.operationalFlags?.isWeighted === true || product.type === 'SERVICE'
    || (product.name || '').toLowerCase().includes('(peso)');
}

const isKilogram = (value: unknown): boolean => typeof value === 'string'
  && ['kg', 'kilogramo'].includes(value.trim().toLowerCase());

/** ScaleModal supplies kilograms; V3 requires explicit compatible stock and sales units. */
export function hasV3KilogramContract(product: {
  type?: unknown; measurementUnit?: unknown; purchaseUnit?: unknown; conversionFactor?: unknown;
  operationalFlags?: unknown;
}): boolean {
  const flags = product.operationalFlags as { isWeighted?: unknown; integersOnly?: unknown; trackInventory?: unknown; usesLots?: unknown; usesSerial?: unknown } | undefined;
  return product.type === 'PRODUCT' && flags?.isWeighted === true && flags.integersOnly === false && flags.trackInventory === false
    && (flags.usesLots === undefined || flags.usesLots === false)
    && (flags.usesSerial === undefined || flags.usesSerial === false)
    && isKilogram(product.measurementUnit) && isKilogram(product.purchaseUnit)
    && product.conversionFactor === 1 && !hasUnsupportedWeightedConfiguration(product);
}

/** A multiplier is not a measured weight, including an explicit 1*SKU. */
export function assertWeightedCodeInput(product: Parameters<typeof isWeightedProduct>[0], raw: string): void {
  if (isWeightedProduct(product) && /^\d+(?:\.\d+)?\*/.test(raw.trim())) {
    throw new Error('Ingrese o lea el peso en la balanza; no use multiplicadores para este artículo.');
  }
}

function hasUnsupportedWeightedConfiguration(product: object): boolean {
  const source = product as Record<string, unknown>;
  const rows = [source, source.restaurant].filter((row): row is Record<string, unknown> =>
    Boolean(row) && typeof row === 'object' && !Array.isArray(row));
  return rows.some(row => ['variants', 'attributes', 'recipeDetails', 'modifiers', 'availableModifiers',
    'modifier_groups', 'modifierGroups', 'combo_groups', 'comboGroups', 'note_presets', 'notePresets']
    .some(key => row[key] !== undefined && (!Array.isArray(row[key]) || row[key].length > 0))
    || Boolean(row.fraction_rule || row.fractionRule)
    || ['COMBO', 'FRACTIONABLE'].includes(String(row.product_type || row.productType || '').toUpperCase()));
}
