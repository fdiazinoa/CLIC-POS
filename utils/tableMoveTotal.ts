import type { ParkedTicket } from '../types';

/** Moving a whole account changes its table, not its saved discounts or taxes. */
export const getWholeTableMoveTotal = (
  sourceTicket: Pick<ParkedTicket, 'total' | 'items'>,
): number => {
  if (typeof sourceTicket.total === 'number' && Number.isFinite(sourceTicket.total)) {
    return sourceTicket.total;
  }

  return (sourceTicket.items || []).reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
    0,
  );
};
