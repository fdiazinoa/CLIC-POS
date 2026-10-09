import type { Table, TableShape } from '../types';

export type DesignerGeometry = Pick<Table, 'shape' | 'posX' | 'posY' | 'width' | 'height' | 'rotation'>;
const shapes = new Set<TableShape>(['SQUARE', 'CIRCLE', 'OBSTACLE', 'BAR', 'BOOTH', 'CHAISE_LONGUE']);
/** Render deduplication is never an authority to mutate more than one original row. */
export const uniqueDesignerTable = (tables: Table[], id: string, roomId: string): Table | undefined => {
  if (typeof id !== 'string' || !id.trim() || id !== id.trim() || typeof roomId !== 'string' || !roomId.trim()) return undefined;
  const matches = tables.filter(table => table.id === id);
  if (matches.length !== 1) return undefined;
  const table = matches[0];
  if ((table.roomId != null && typeof table.roomId !== 'string') || (table.room_id != null && typeof table.room_id !== 'string')) return undefined;
  const canonical = typeof table.roomId === 'string' ? table.roomId.trim() : '';
  const alias = typeof table.room_id === 'string' ? table.room_id.trim() : '';
  if ((canonical && alias && canonical !== alias) || (canonical || alias) !== roomId) return undefined;
  return table;
};
export const designerGeometry = (table: Table | undefined): DesignerGeometry | undefined => {
  if (!table || !shapes.has(table.shape) || ![table.posX, table.posY, table.width, table.height].every(Number.isFinite)
    || table.width <= 0 || table.height <= 0) return undefined;
  const rotation = table.rotation ?? 0;
  if (!Number.isFinite(rotation)) return undefined;
  return { shape: table.shape, posX: table.posX, posY: table.posY, width: table.width, height: table.height, rotation };
};
export const applyDesignerGeometry = (tables: Table[], id: string, roomId: string, geometry: DesignerGeometry,
  updates: Partial<Table>): Table[] => {
  const target = uniqueDesignerTable(tables, id, roomId);
  if (!target || (updates.id !== undefined && updates.id !== target.id)
    || (updates.roomId !== undefined && updates.roomId !== roomId)
    || (updates.room_id !== undefined && updates.room_id !== target.room_id) || !designerGeometry({ ...target, ...geometry, ...updates } as Table)) return tables;
  return tables.map(table => table === target ? { ...table, ...geometry, ...updates, roomId } : table);
};
