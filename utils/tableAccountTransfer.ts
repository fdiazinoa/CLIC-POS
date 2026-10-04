import type { BusinessConfig, CartItem, Customer, ParkedTicket, Table, TerminalConfig } from '../types';
import { buildTableAccountFiscalSummary } from './tableAccountFiscalSummary';
import { parkedTicketBelongsToTable } from './parkedTicketTableMembership';
import { isFullyPaidParkedTicket } from './paymentFractions';

/** Pure same-table transfer. The caller persists the returned collection in one write. */
export const transferTableAccountItems = (
  tickets: ParkedTicket[],
  table: Table,
  sourceId: string,
  targetId: string,
  quantities: Record<string, number>,
  config: BusinessConfig,
  terminalConfig: TerminalConfig | undefined,
  isTaxIncluded: boolean,
  terminalId = 'T1',
  customers: Customer[] = [],
): ParkedTicket[] => {
  if (!sourceId || !targetId || sourceId === targetId) throw new Error('Seleccione dos cuentas distintas de la mesa.');
  const source = tickets.find(ticket => String(ticket.id) === sourceId);
  const target = tickets.find(ticket => String(ticket.id) === targetId);
  if (!source || !target || !parkedTicketBelongsToTable(source, table.id) || !parkedTicketBelongsToTable(target, table.id)) throw new Error('Las cuentas ya no pertenecen a la misma mesa. Actualice el mapa.');
  if (isFullyPaidParkedTicket(source) || isFullyPaidParkedTicket(target)) throw new Error('Una cuenta ya está cobrada. Actualice el mapa antes de transferir.');
  if (source.paymentFraction || target.paymentFraction) throw new Error('No se transfieren artículos de cuentas fraccionadas o con cuotas cobradas.');
  if (Number(source.discountAmount || 0) || Number(target.discountAmount || 0)) throw new Error('No se transfieren artículos con descuento activo; quite el descuento desde el POS primero.');
  if ([...source.items, ...target.items].some(item => Boolean(item.subtotalizedAt))) throw new Error('No se transfieren artículos de una pre-cuenta ya impresa; solicite autorización para editarla en el POS.');
  const moved: CartItem[] = [];
  const remaining = source.items.map((item, index) => {
    const key = String(item.cartId || `${item.id}-${index}`);
    const requested = Number(quantities[key] || 0);
    const available = Number(item.quantity || 0);
    if (!Number.isFinite(requested) || requested < 0 || requested > available || Math.round(requested * 1000) / 1000 !== requested) throw new Error(`Cantidad inválida para ${item.name}.`);
    if (requested > 0) {
      const prefix = `${key}-moved-${sourceId}-${targetId}`;
      const used = new Set([...target.items, ...moved].map(candidate => String(candidate.cartId)));
      let candidate = prefix;
      let suffix = 2;
      while (used.has(candidate)) candidate = `${prefix}-${suffix++}`;
      moved.push({ ...item, quantity: requested, cartId: candidate });
    }
    return { ...item, quantity: available - requested };
  }).filter(item => item.quantity > 0);
  if (moved.length === 0) throw new Error('Seleccione al menos un artículo para transferir.');
  const nextSource = { ...source, items: remaining };
  const nextTargetItems = [...target.items, ...moved];
  const nextTarget = { ...target, items: nextTargetItems };
  const customerFor = (ticket: ParkedTicket) => customers.find(customer => String(customer.id) === String(ticket.customerId || ''));
  nextSource.total = buildTableAccountFiscalSummary(nextSource, table, config, terminalConfig, isTaxIncluded, terminalId, customerFor(source)).total;
  nextTarget.total = buildTableAccountFiscalSummary(nextTarget, table, config, terminalConfig, isTaxIncluded, terminalId, customerFor(target)).total;
  if (remaining.length === 0) {
    const legacyPayments = (source as ParkedTicket & { payments?: unknown[]; paidAmount?: number }).payments;
    if (source.customerId || source.customerName || source.customerSnapshot || (Array.isArray(legacyPayments) && legacyPayments.length > 0)
      || Number((source as ParkedTicket & { paidAmount?: number }).paidAmount || 0) > 0) {
      throw new Error('La cuenta origen tiene cliente o pagos asociados; no se puede retirar automáticamente. Use el POS para reconciliarla.');
    }
    const sourcePrimary = String(source.primaryTableId || '').trim();
    const targetPrimary = String(target.primaryTableId || '').trim();
    if (sourcePrimary && targetPrimary && sourcePrimary !== targetPrimary) throw new Error('Las cuentas tienen mesas principales distintas; no se puede retirar la cuenta origen.');
    const joinedTableIds = Array.from(new Set([
      ...(source.joinedTableIds || []), ...(target.joinedTableIds || []),
      source.tableId, target.tableId,
    ].filter((id): id is string | number => id !== undefined && id !== null).map(String)));
    if (joinedTableIds.length > 1) {
      nextTarget.primaryTableId = sourcePrimary || targetPrimary || String(table.id);
      nextTarget.joinedTableIds = joinedTableIds;
    }
    nextTarget.items = nextTarget.items.map(item => {
      const transferred = moved.find(line => line.cartId === item.cartId);
      return transferred ? { ...item, orderNumber: item.orderNumber || source.orderNumber, transferredFromTicketId: sourceId } : item;
    });
    const sourceFiscal = buildTableAccountFiscalSummary(source, table, config, terminalConfig, isTaxIncluded, terminalId, customerFor(source)).total;
    const targetFiscal = buildTableAccountFiscalSummary(target, table, config, terminalConfig, isTaxIncluded, terminalId, customerFor(target)).total;
    if (Math.abs(sourceFiscal + targetFiscal - nextTarget.total) > 0.01) {
      throw new Error('La transferencia completa cambia el total fiscal de la mesa; no se retiró la cuenta origen. Reconcíliela en el POS.');
    }
    return tickets.filter(ticket => String(ticket.id) !== sourceId).map(ticket => String(ticket.id) === targetId ? nextTarget : ticket);
  }
  return tickets.map(ticket => String(ticket.id) === sourceId ? nextSource : String(ticket.id) === targetId ? nextTarget : ticket);
};
