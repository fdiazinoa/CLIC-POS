import { LargeMasterSyncV3Error } from './LargeMasterSyncV3Types';
import { v3TaxSemantics } from './LargeMasterSyncV3StockAuthority';

type Row = Record<string, any>;
/** Only explicit authenticated ERP type declarations may reinterpret an unchanged tax. */
export const authorizeV3TaxClassification = (before: Row[], after: Row[]): Array<{ id: string; before: string; after: string }> => {
  const index = (rows: Row[]) => {
    const map = new Map<string, Row>();
    for (const row of rows) {
      if (typeof row.id !== 'string' || !row.id.trim() || map.has(row.id)) throw new LargeMasterSyncV3Error('SYNC_V3_TAX_INVALID');
      map.set(row.id, row);
    }
    return map;
  };
  const old = index(before), next = index(after);
  if (old.size !== next.size) throw new LargeMasterSyncV3Error('SYNC_V3_CATALOG_SEMANTICS_CHANGED');
  const changes = [];
  for (const [id, row] of old) {
    const target = next.get(id);
    if (!target) throw new LargeMasterSyncV3Error('SYNC_V3_CATALOG_SEMANTICS_CHANGED');
    if (v3TaxSemantics(row) === v3TaxSemantics(target)) continue;
    if (row.type !== 'VAT' || target.type !== 'SERVICE_CHARGE' || row.rate !== 0.1 || target.rate !== 0.1
      || row.active !== target.active || row.active === false || (target.fiscalAdditionalTaxCode !== undefined && target.fiscalAdditionalTaxCode !== '001')) {
      throw new LargeMasterSyncV3Error('SYNC_V3_CATALOG_SEMANTICS_CHANGED');
    }
    changes.push({ id, before: v3TaxSemantics(row), after: v3TaxSemantics(target) });
  }
  return changes.sort((a,b) => a.id.localeCompare(b.id));
};
