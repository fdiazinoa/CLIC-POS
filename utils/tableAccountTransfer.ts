import type { CartItem, ParkedTicket } from '../types';

const total = (items: CartItem[]) => Math.round(items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0) * 100) / 100;

/** Pure same-table transfer. The caller persists the returned collection in one write. */
export const transferTableAccountItems = (
  tickets: ParkedTicket[],
  tableId: string,
  sourceId: string,
  targetId: string,
  quantities: Record<string, number>,
): ParkedTicket[] => {
  if (!sourceId || !targetId || sourceId === targetId) throw new Error('Seleccione dos cuentas distintas de la mesa.');
  const source = tickets.find(ticket => String(ticket.id) === sourceId);
  const target = tickets.find(ticket => String(ticket.id) === targetId);
  if (!source || !target || String(source.tableId) !== tableId || String(target.tableId) !== tableId) throw new Error('Las cuentas ya no pertenecen a la misma mesa. Actualice el mapa.');
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
  const nextSource = { ...source, items: remaining, total: total(remaining) };
  const nextTargetItems = [...target.items, ...moved];
  const nextTarget = { ...target, items: nextTargetItems, total: total(nextTargetItems) };
  return tickets.map(ticket => String(ticket.id) === sourceId ? nextSource : String(ticket.id) === targetId ? nextTarget : ticket);
};
