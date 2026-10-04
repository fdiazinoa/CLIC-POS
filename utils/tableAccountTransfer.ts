import type { BusinessConfig, CartItem, ParkedTicket, Table, TerminalConfig } from '../types';
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
  nextSource.total = buildTableAccountFiscalSummary(nextSource, table, config, terminalConfig, isTaxIncluded).total;
  nextTarget.total = buildTableAccountFiscalSummary(nextTarget, table, config, terminalConfig, isTaxIncluded).total;
  return tickets.map(ticket => String(ticket.id) === sourceId ? nextSource : String(ticket.id) === targetId ? nextTarget : ticket);
};
