import { CartItem, Permission } from '../types';

export type CartItemEditCapabilities = {
  canApplyDiscount: boolean;
  canOverridePrice: boolean;
  canEditQuantity: boolean;
  canVoidItem: boolean;
  annotationOnly: boolean;
};

export const resolveCartItemEditCapabilities = (
  permissions: readonly Permission[],
  options: { priceLocked?: boolean; itemDispatched?: boolean } = {},
): CartItemEditCapabilities => {
  const hasAll = permissions.includes('ALL');
  const hasPermission = (permission: Permission) => hasAll || permissions.includes(permission);
  const priceLocked = Boolean(options.priceLocked);
  const itemDispatched = Boolean(options.itemDispatched);
  const canApplyDiscount = !priceLocked && hasPermission('POS_DISCOUNT');
  const canOverridePrice = !priceLocked && hasPermission('POS_PRICE_OVERRIDE');
  const canVoidItem = !itemDispatched && hasPermission('POS_VOID_ITEM');
  const canEditQuantity = !itemDispatched && (
    canApplyDiscount
    || canOverridePrice
    || hasPermission('POS_VOID_ITEM')
  );

  return {
    canApplyDiscount,
    canOverridePrice,
    canEditQuantity,
    canVoidItem,
    annotationOnly: !canApplyDiscount && !canOverridePrice && !canEditQuantity && !canVoidItem,
  };
};

export const preserveCartItemCommercialFields = (
  original: CartItem,
  candidate: CartItem,
): CartItem => ({
  ...original,
  note: candidate.note,
  salespersonId: candidate.salespersonId,
});
