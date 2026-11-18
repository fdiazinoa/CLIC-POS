import type { V3BaselineMigrationDiagnostic } from './LargeMasterSyncV3Types';
import { v3ArticleSemantics, v3TariffSemantics, v3VariantSemantics } from './LargeMasterSyncV3StockAuthority';

type Row = Record<string, unknown>;
const definitions = {
  articles: { serialize: v3ArticleSemantics, fields: ['type', 'inventoriable', 'uom/measurementUnit', 'purchaseUnit', 'conversionFactor', 'taxable', 'taxIds', 'isWeighted', 'trackInventory', 'integersOnly', 'usesLots', 'usesSerial'] },
  tariffs: { serialize: v3TariffSemantics, fields: ['id', 'taxIncluded', 'active'] },
  variants: { serialize: v3VariantSemantics, fields: ['id', 'articleId', 'sku', 'active', 'attributeValues', 'barcodes'] },
};

/** Explain the first rejected record using exactly the same semantic projections as the guard.
 * This function cannot authorize activation, alter records or convert inventory quantities. */
export function describeV3BaselineChange(dataset: keyof typeof definitions, oldRows: Row[], newRows: Row[],
  fromVersion: number, toVersion: number): V3BaselineMigrationDiagnostic['change'] {
  const definition = definitions[dataset];
  const before = new Map(oldRows.map(row => [String(row.id), row]));
  const after = new Map(newRows.map(row => [String(row.id), row]));
  for (const id of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const oldRow = before.get(id), newRow = after.get(id);
    if (oldRow && newRow && definition.serialize(oldRow) === definition.serialize(newRow)) continue;
    const oldValues: unknown[] = oldRow ? JSON.parse(definition.serialize(oldRow)) : [];
    const newValues: unknown[] = newRow ? JSON.parse(definition.serialize(newRow)) : [];
    const fields = !oldRow || !newRow
      ? [{ field: 'registro', before: oldRow ? 'presente' : 'ausente', after: newRow ? 'presente' : 'ausente' }]
      : definition.fields.flatMap((field, index) => JSON.stringify(oldValues[index]) === JSON.stringify(newValues[index]) ? []
        : [{ field, before: JSON.stringify(oldValues[index]), after: JSON.stringify(newValues[index]) }]);
    // Never copy the raw product/document payload or any credentials into an error.
    return { dataset, recordId: id, ...(typeof (newRow?.sku ?? oldRow?.sku) === 'string' ? { sku: String(newRow?.sku ?? oldRow?.sku) } : {}), fields, fromVersion, toVersion };
  }
  return undefined;
}
