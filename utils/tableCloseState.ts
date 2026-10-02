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
  remainingTickets?: ParkedTicket[];
}): { tables: Table[]; targetTable: Table } => {
  const tableId = String(input.closedTable.id ?? '').trim();
  const closedOrderId = String(input.closedOrderId || '').trim();
  const remainingTickets = (input.remainingTickets || []).filter(ticket =>
    !closedOrderId || String(ticket.id) !== closedOrderId
  );
  const tableTickets = remainingTickets.filter(ticket => parkedTicketBelongsToTable(ticket, tableId));
  const nextTicket = tableTickets[0];
  const remainingTotal = tableTickets.reduce((sum, ticket) => sum + ticketTotal(ticket), 0);
  const targetTable = nextTicket
    ? ({
        ...input.closedTable,
        status: 'OCCUPIED',
        currentOrderId: nextTicket.id,
        currentOrderTotal: remainingTotal,
        timeSeated: input.closedTable.timeSeated || nextTicket.timestamp,
      } as Table)
    : clearJoinedMembership({
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

  const explicitMembership = nextTicket ? ticketMembershipIds(nextTicket) : new Set<string>();
  explicitMembership.add(tableId);
  const primaryId = String(nextTicket?.primaryTableId || nextTicket?.tableId || '').trim();
  const primaryTable = input.tables.find(table => String(table.id) === primaryId);
  const primaryTableName = String(primaryTable?.nombre || primaryTable?.name || '').trim();
  const isSharedAccount = Boolean(nextTicket && primaryId && explicitMembership.size > 1);
  const foundTarget = input.tables.some(table => String(table.id) === tableId);
  const tables = input.tables.map(table => {
    const currentId = String(table.id);
    if (currentId === tableId && !nextTicket) return targetTable;
    if (!nextTicket || !explicitMembership.has(currentId)) return table;
    const isSecondaryTable = isSharedAccount && currentId !== primaryId;
    return {
      ...(currentId === tableId ? targetTable : table),
      status: 'OCCUPIED',
      currentOrderId: nextTicket.id,
      currentOrderTotal: currentId === primaryId ? ticketTotal(nextTicket) : 0,
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
  });
  return { tables: foundTarget ? tables : [...tables, targetTable], targetTable };
};
