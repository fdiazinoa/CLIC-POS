type TableTicket = {
  tableId?: string | number;
  joinedTableIds?: Array<string | number>;
};

export const parsePersistedParkedTickets = (raw: string | null, strict = false): unknown[] => {
  try {
    const parsed = raw === null ? [] : JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    throw new Error('PARKED_TICKETS_SNAPSHOT_INVALID');
  } catch (error) {
    if (strict) throw error;
    return [];
  }
};

const referencesTable = (ticket: TableTicket, tableId: string): boolean =>
  String(ticket.tableId || '') === tableId ||
  (Array.isArray(ticket.joinedTableIds) && ticket.joinedTableIds.some(id => String(id) === tableId));

export const mergeParkedTicketsForTable = <T extends TableTicket>(
  current: T[],
  incoming: T[],
  tableId: string,
): T[] => {
  if (!tableId) return incoming;
  const affectedTableIds = new Set<string>([tableId]);
  for (const ticket of incoming) {
    if (!referencesTable(ticket, tableId)) continue;
    if (ticket.tableId) affectedTableIds.add(String(ticket.tableId));
    for (const joinedId of Array.isArray(ticket.joinedTableIds) ? ticket.joinedTableIds : []) {
      if (joinedId) affectedTableIds.add(String(joinedId));
    }
  }
  return [
    ...current.filter(ticket => ![...affectedTableIds].some(id => referencesTable(ticket, id))),
    ...incoming.filter(ticket => referencesTable(ticket, tableId)),
  ];
};
