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
  const primaryId = String(nextTicket?.primaryTableId || nextTicket?.tableId || '').trim();
  const primaryTable = input.tables.find(table => String(table.id) === primaryId);
  const primaryTableName = String(primaryTable?.nombre || primaryTable?.name || '').trim();
  const isSharedAccount = Boolean(nextTicket && primaryId && explicitMembership.size > 1);
  const foundTarget = input.tables.some(table => String(table.id) === tableId);
  const tables = input.tables.map(table => {
    const currentId = String(table.id);
    if (nextTicket && explicitMembership.has(currentId)) {
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
    }
    if (!closedMembership.has(currentId)) return table;
    const currentOrderId = String(table.currentOrderId || '').trim();
    const ownsAnotherOrder = Boolean(currentOrderId && currentOrderId !== closedOrderId);
    const hasRemainingAccount = remainingTickets.some(ticket => parkedTicketBelongsToTable(ticket, currentId));
    if (ownsAnotherOrder || hasRemainingAccount) return table;
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
  const nextTables = foundTarget ? tables : [...tables, targetTable];
  const resolvedTarget = nextTables.find(table => String(table.id) === tableId) || targetTable;
  const affectedTables = nextTables.filter((table, index) => table !== input.tables[index]);
  return { tables: nextTables, targetTable: resolvedTarget, affectedTables };
};
