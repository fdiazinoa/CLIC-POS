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

// Las mesas de la cuadrícula inicial todavía no tienen geometría persistida. Si
// una de ellas se abre primero puede recibir coordenadas antes que las demás;
// no debe convertir a sus hermanas en registros "ocultos" de ERP.
const isBootstrapGridTable = (table: Table): boolean => {
  const rawName = String(table.name || table.nombre || '').trim();
  const hasExternalIdentity = Boolean(
    String(table.code || '').trim() || String(table.label || '').trim()
  );
  return !hasExternalIdentity && /^mesa\s*\d+$/i.test(rawName);
};

const isNumberedTable = (table: Table): boolean =>
  /^mesa\s*\d+$/i.test(resolveIncomingTableLabel(table));

const getLogicalTableKey = (table: Table): string | null => {
  const label = resolveIncomingTableLabel(table);
  const match = label.match(/^mesa\s*(\d+)$/i);
  if (!match) return null;
  const roomId = table.roomId || String(table.room_id || '');
  return `${roomId}::mesa-${Number(match[1])}`;
};

const isOperationalTable = (table: Table): boolean => Boolean(
  table.status === 'OCCUPIED'
  || table.status === 'RESERVED'
  || String(table.currentOrderId || '').trim()
  || Number(table.currentOrderTotal || 0) > 0
);

const mergeLogicalTableGroup = (group: Table[]): Table => {
  if (group.length === 1) return group[0];

  const layoutTable = group.find(hasExplicitTableLayout);
  const operationalTable = group.find(isOperationalTable);
  const identityTable = operationalTable || layoutTable || group[0];
  if (!layoutTable) return identityTable;

  return {
    ...layoutTable,
    ...identityTable,
    roomId: layoutTable.roomId || String(layoutTable.room_id || identityTable.roomId || identityTable.room_id || ''),
    name: resolveIncomingTableLabel(layoutTable),
    nombre: resolveIncomingTableLabel(layoutTable),
    shape: layoutTable.shape,
    posX: layoutTable.posX,
    posY: layoutTable.posY,
    width: layoutTable.width,
    height: layoutTable.height,
    rotation: layoutTable.rotation
  } as Table;
};

const collapseLogicalTableDuplicates = (tables: Table[]): Table[] => {
  const groups = new Map<string, Table[]>();
  const ungrouped: Table[] = [];

  tables.forEach(table => {
    const key = getLogicalTableKey(table);
    if (!key) {
      ungrouped.push(table);
      return;
    }
    const group = groups.get(key) || [];
    group.push(table);
    groups.set(key, group);
  });

  return [
    ...Array.from(groups.values(), mergeLogicalTableGroup),
    ...ungrouped
  ];
};

const tablesOverlap = (left: Table, right: Table): boolean => (
  left.posX < right.posX + right.width
  && left.posX + left.width > right.posX
  && left.posY < right.posY + right.height
  && left.posY + left.height > right.posY
);

const placeInFallbackGrid = (table: Table, index: number): Table => {
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
};

export const getRenderableFloorTables = (tables: Table[]): Table[] => {
  const source = collapseLogicalTableDuplicates(Array.isArray(tables) ? tables : []);
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
    // Algunos ERP entregan la cuadrícula inicial con code/label. El conjunto
    // completo de mesas numeradas sigue siendo una cuadrícula operativa, no
    // registros ajenos que deban ocultarse cuando solo una mesa se actualiza.
    const hasNumberedBootstrapGrid = roomTables.filter(isNumberedTable).length >= 4;
    if (explicitLayout.length > 0) {
      renderable.push(...explicitLayout);
      // Mantener visible la cuadrícula automática mientras su geometría se va
      // confirmando de forma incremental. Los registros ERP sin layout siguen
      // excluidos para no contaminar un plano diseñado manualmente.
      roomTables.forEach((table, index) => {
        if (!hasExplicitTableLayout(table) && (
          isBootstrapGridTable(table)
          || (hasNumberedBootstrapGrid && isNumberedTable(table))
        )) {
          let gridIndex = index;
          let fallbackTable = placeInFallbackGrid(table, gridIndex);
          while (renderable.some(existing => (
            (existing.roomId || String(existing.room_id || '')) === fallbackTable.roomId
            && tablesOverlap(existing, fallbackTable)
          ))) {
            gridIndex += 1;
            fallbackTable = placeInFallbackGrid(table, gridIndex);
          }
          renderable.push(fallbackTable);
        }
      });
      return;
    }

    renderable.push(...roomTables.map(placeInFallbackGrid));
  });

  return renderable;
};
