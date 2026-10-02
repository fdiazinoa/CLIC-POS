import type { ParkedTicket, Table } from '../types';
import { parkedTicketBelongsToTable } from './parkedTicketTableMembership';

const ticketTotal = (ticket: ParkedTicket): number => typeof ticket.total === 'number'
  ? Number(ticket.total || 0)
  : (ticket.items || []).reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);

const ticketMembershipIds = (ticket: ParkedTicket): Set<string> => new Set([
  String(ticket.tableId ?? '').trim(),
  String(ticket.primaryTableId ?? '').trim(),
  ...(Array.isArray(ticket.joinedTableIds) ? ticket.joinedTableIds.map(id => String(id).trim()) : []),
].filter(Boolean));

const clearJoinedMembership = <T extends Table>(table: T): T => ({
  ...table,
  joinedTableId: undefined,
  joinedTableName: undefined,
  joinedSourceTableId: undefined,
  joinedSourceTableName: undefined,
});

export const updateTablesAfterAccountClose = (input: {
  tables: Table[];
  closedTable: Table;
  closedOrderId?: string;
  closedTicket?: ParkedTicket;
  remainingTickets?: ParkedTicket[];
}): { tables: Table[]; targetTable: Table; affectedTables: Table[] } => {
  const tableId = String(input.closedTable.id ?? '').trim();
  const closedOrderId = String(input.closedOrderId || '').trim();
  const remainingTickets = (input.remainingTickets || []).filter(ticket =>
    !closedOrderId || String(ticket.id) !== closedOrderId
  );
  const closedMembership = input.closedTicket
    ? ticketMembershipIds(input.closedTicket)
    : new Set<string>();
  closedMembership.add(tableId);
  if (closedOrderId) {
    input.tables.forEach(table => {
      if (String(table.currentOrderId || '').trim() === closedOrderId) {
        closedMembership.add(String(table.id));
      }
    });
  }
  const foundTarget = input.tables.some(table => String(table.id) === tableId);
  const tables = input.tables.map(table => {
    const currentId = String(table.id);
    if (!closedMembership.has(currentId)) return table;
    const currentOrderId = String(table.currentOrderId || '').trim();
    if (currentOrderId && currentOrderId !== closedOrderId) return table;

    const tableTickets = remainingTickets.filter(ticket => parkedTicketBelongsToTable(ticket, currentId));
    const nextTicket = tableTickets[0];
    if (nextTicket) {
      const explicitMembership = ticketMembershipIds(nextTicket);
      const primaryId = String(nextTicket.primaryTableId || nextTicket.tableId || '').trim();
      const primaryTable = input.tables.find(candidate => String(candidate.id) === primaryId);
      const primaryTableName = String(primaryTable?.nombre || primaryTable?.name || '').trim();
      const isSharedAccount = Boolean(primaryId && explicitMembership.size > 1);
      const isSecondaryTable = isSharedAccount && currentId !== primaryId;
      const remainingTotal = tableTickets.reduce((sum, ticket) => sum + ticketTotal(ticket), 0);
      return {
        ...table,
        status: 'OCCUPIED',
        currentOrderId: nextTicket.id,
        currentOrderTotal: isSecondaryTable ? 0 : remainingTotal,
        timeSeated: table.timeSeated || nextTicket.timestamp,
        joinedSourceTableId: isSharedAccount ? primaryId : undefined,
        joinedSourceTableName: isSharedAccount ? primaryTableName : undefined,
        joinedTableId: isSharedAccount
          ? (isSecondaryTable ? primaryId : table.joinedTableId)
          : undefined,
        joinedTableName: isSharedAccount
          ? (isSecondaryTable ? primaryTableName : table.joinedTableName)
          : undefined,
      } as Table;
    }
    return clearJoinedMembership({
      ...table,
      status: 'FREE',
      currentOrderId: undefined,
      currentOrderTotal: undefined,
      timeSeated: undefined,
      waiterId: undefined,
      waiterName: undefined,
      guests: undefined,
      barTabId: undefined,
      barTabName: undefined,
    } as Table);
  });
  const fallbackTarget = clearJoinedMembership({
    ...input.closedTable,
    status: 'FREE',
    currentOrderId: undefined,
    currentOrderTotal: undefined,
    timeSeated: undefined,
    waiterId: undefined,
    waiterName: undefined,
    guests: undefined,
    barTabId: undefined,
    barTabName: undefined,
  } as Table);
  const nextTables = foundTarget ? tables : [...tables, fallbackTarget];
  const resolvedTarget = nextTables.find(table => String(table.id) === tableId) || fallbackTarget;
  const affectedTables = nextTables.filter((table, index) => table !== input.tables[index]);
  return { tables: nextTables, targetTable: resolvedTarget, affectedTables };
};
