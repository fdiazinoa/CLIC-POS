import { db } from '../../utils/db';

const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const outputFields: Record<string, string[]> = { modo_salida: ['modo_salida', 'outputMode'], printer_id: ['printer_id', 'printerId'],
  target_terminal_id: ['target_terminal_id', 'targetTerminalId'], target_terminal_name: ['target_terminal_name', 'targetTerminalName'],
  kds_host: ['kds_host'], kds_port: ['kds_port'], kds_delivery_mode: ['kds_delivery_mode'],
  kds_warning_minutes: ['kds_warning_minutes'], kds_critical_minutes: ['kds_critical_minutes'] };

export function productionAreaRows(snapshot: unknown): unknown[] | undefined {
  const root = object(snapshot);
  const catalog = object(object(object(root.terminal_config || root).resolved).catalog);
  for (const key of ['production_areas', 'productionAreas']) if (Object.prototype.hasOwnProperty.call(catalog, key)) {
    if (!Array.isArray(catalog[key])) throw Error('PRODUCTION_AREAS_SNAPSHOT_INVALID');
    return catalog[key];
  }
  return undefined;
}

/** Omitted output fields preserve device configuration; explicit null/empty fields clear it. */
export function mergeProductionAreaSnapshot(rows: unknown[], local: unknown[]): Record<string, any>[] {
  const byId = new Map(local.map(object).map(row => [text(row.id), row]));
  const seen = new Set<string>();
  return rows.map(object).filter(row => row.active !== false && row.is_active !== false).map(row => {
    const id = text(row.id); const name = text(row.name || row.nombre || row.code);
    if (!id || id.length > 128 || !name || name.length > 256 || seen.has(id)) throw Error('PRODUCTION_AREAS_SNAPSHOT_INVALID');
    seen.add(id);
    const merged: Record<string, any> = { ...byId.get(id), id, name, nombre: name, active: true, is_active: true };
    for (const field of ['code', 'description', 'station_type', 'sort_order', 'updated_at']) {
      if (Object.prototype.hasOwnProperty.call(row, field)) merged[field] = row[field];
    }
    for (const [field, aliases] of Object.entries(outputFields)) {
      const key = aliases.find(alias => Object.prototype.hasOwnProperty.call(row, alias));
      if (!key) continue;
      const value = row[key];
      if (value != null && typeof value !== 'string' && typeof value !== 'number') throw Error('PRODUCTION_AREAS_SNAPSHOT_INVALID');
      if (typeof value === 'string' && value.length > 256) throw Error('PRODUCTION_AREAS_SNAPSHOT_INVALID');
      for (const alias of aliases) delete merged[alias];
      merged[field] = value == null ? null : typeof value === 'string' ? value.trim() : value;
    }
    return merged;
  });
}

export async function persistProductionAreaSnapshot(snapshot: unknown, assertCurrent: () => Promise<void> = async () => {}): Promise<number | null> {
  const rows = productionAreaRows(snapshot);
  if (rows === undefined) return null;
  await assertCurrent();
  const stored = await db.get('productionAreas' as any);
  const next = mergeProductionAreaSnapshot(rows, Array.isArray(stored) ? stored : []);
  await assertCurrent();
  if (JSON.stringify(stored) !== JSON.stringify(next)) {
    await db.save('productionAreas' as any, next);
    await assertCurrent();
    const verified = await db.get('productionAreas' as any);
    await assertCurrent();
    if (JSON.stringify(verified) !== JSON.stringify(next)) throw Error('PRODUCTION_AREAS_READBACK_FAILED');
    window.dispatchEvent(new CustomEvent('productionAreasUpdated'));
  }
  return next.length;
}
