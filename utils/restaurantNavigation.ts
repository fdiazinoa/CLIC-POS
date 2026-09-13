export const shouldBlockTableMapForDirectSale = (
  cartItemCount: number,
  hasActiveTable: boolean,
): boolean => cartItemCount > 0 && !hasActiveTable;
