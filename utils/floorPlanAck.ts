type Entity = { id?: unknown };

const TABLE_LAYOUT_FIELDS = [
  'id', 'code', 'label', 'room_id', 'sort_order', 'active', 'roomId', 'nombre', 'name',
  'posX', 'posY', 'width', 'height', 'shape', 'rotation', 'capacity',
  'consumo_minimo_mesa', 'comensales_minimos',
] as const;

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value;
};

const wireValue = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

const assertExactIds = (expected: Entity[], acknowledged: unknown, label: string): Entity[] => {
  if (!Array.isArray(acknowledged)) throw new Error(`${label}_ACK_REQUIRED`);
  const actual = acknowledged as Entity[];
  const expectedIds = expected.map(entity => String(entity?.id ?? '').trim());
  const actualIds = actual.map(entity => String(entity?.id ?? '').trim());
  if (expectedIds.some(id => !id) || actualIds.some(id => !id)
    || new Set(expectedIds).size !== expectedIds.length
    || new Set(actualIds).size !== actualIds.length
    || expectedIds.length !== actualIds.length
    || expectedIds.some(id => !actualIds.includes(id))) {
    throw new Error(`${label}_ACK_MISMATCH`);
  }
  return actual;
};

const projectTableLayout = (table: Entity): Entity => {
  const record = table as Record<string, unknown>;
  return Object.fromEntries(
  TABLE_LAYOUT_FIELDS
    .filter(field => record[field] !== undefined)
    .map(field => [field, record[field]]),
  );
};

const canonical = (value: unknown): string => JSON.stringify(stableValue(wireValue(value)));

export const assertFloorPlanAcknowledged = (
  expectedRooms: Entity[],
  expectedTables: Entity[],
  acknowledgedRooms: unknown,
  acknowledgedTables: unknown,
): void => {
  const actualRooms = assertExactIds(expectedRooms, acknowledgedRooms, 'LAYOUT_ROOMS');
  const actualTables = assertExactIds(expectedTables, acknowledgedTables, 'LAYOUT_TABLES');
  const actualRoomsById = new Map(actualRooms.map(room => [String(room.id), room]));
  const actualTablesById = new Map(actualTables.map(table => [String(table.id), table]));

  for (const room of expectedRooms) {
    if (canonical(room) !== canonical(actualRoomsById.get(String(room.id)))) {
      throw new Error('LAYOUT_ROOMS_ACK_MISMATCH');
    }
  }
  for (const table of expectedTables) {
    if (canonical(projectTableLayout(table)) !== canonical(projectTableLayout(actualTablesById.get(String(table.id))!))) {
      throw new Error('LAYOUT_TABLES_ACK_MISMATCH');
    }
  }
};
