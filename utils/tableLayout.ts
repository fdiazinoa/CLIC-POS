import type { Table, TableShape } from '../types';

const TABLE_SHAPES = new Set<TableShape>([
  'SQUARE',
  'CIRCLE',
  'OBSTACLE',
  'BAR',
  'BOOTH',
  'CHAISE_LONGUE'
]);

const isFiniteLayoutNumber = (value: unknown): boolean => (
  typeof value === 'number' && Number.isFinite(value)
);

export const hasExplicitTableLayout = (table: Table): boolean => (
  TABLE_SHAPES.has(table.shape)
  && isFiniteLayoutNumber(table.posX)
  && isFiniteLayoutNumber(table.posY)
  && isFiniteLayoutNumber(table.width)
  && isFiniteLayoutNumber(table.height)
  && table.width > 0
  && table.height > 0
);

const resolveIncomingTableLabel = (table: Table): string => {
  const compatibilityTable = table as Table & { label?: string; code?: string };
  const specificLabel = String(compatibilityTable.label || '').trim();
  const currentLabel = String(table.name || table.nombre || '').trim();

  if (specificLabel && (!currentLabel || currentLabel.toLowerCase() === 'mesa')) {
    return specificLabel;
  }
  return currentLabel || specificLabel || String(compatibilityTable.code || '').trim() || 'Mesa';
};

export const getRenderableFloorTables = (tables: Table[]): Table[] => {
  const source = Array.isArray(tables) ? tables : [];
  const tablesByRoom = new Map<string, Table[]>();
  source.forEach(table => {
    const roomId = table.roomId || String(table.room_id || '');
    const roomTables = tablesByRoom.get(roomId) || [];
    roomTables.push(table);
    tablesByRoom.set(roomId, roomTables);
  });

  const renderable: Table[] = [];
  tablesByRoom.forEach(roomTables => {
    const explicitLayout = roomTables.filter(hasExplicitTableLayout);
    if (explicitLayout.length > 0) {
      renderable.push(...explicitLayout);
      return;
    }

    renderable.push(...roomTables.map((table, index) => {
      const label = resolveIncomingTableLabel(table);
      const roomId = table.roomId || String(table.room_id || '');
      const column = index % 4;
      const row = Math.floor(index / 4);

      return {
        ...table,
        roomId,
        name: label,
        nombre: label,
        shape: TABLE_SHAPES.has(table.shape) ? table.shape : 'SQUARE',
        posX: 80 + (column * 140),
        posY: 80 + (row * 140),
        width: Number(table.width) > 0 ? Number(table.width) : 100,
        height: Number(table.height) > 0 ? Number(table.height) : 100,
        rotation: Number.isFinite(Number(table.rotation)) ? Number(table.rotation) : 0
      };
    }));
  });

  return renderable;
};
