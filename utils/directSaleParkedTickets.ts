import type { ParkedTicket, RoleDefinition, User } from '../types';

const hasIdentifier = (value: unknown): boolean =>
  value !== null && value !== undefined && String(value).trim() !== '';

/** Table accounts stay in Mesas; only standalone sales belong in Recuperar. */
export const isDirectSaleParkedTicket = (ticket: ParkedTicket): boolean => {
  if (
    hasIdentifier(ticket.tableId)
    || hasIdentifier(ticket.primaryTableId)
    || (ticket.joinedTableIds || []).some(hasIdentifier)
    || hasIdentifier(ticket.barTabId)
    || hasIdentifier(ticket.barTabName)
    || hasIdentifier(ticket.tableDisplayLabel)
    || hasIdentifier(ticket.tableRoomLabel)
  ) return false;

  // Old table tickets may predate the explicit tableId field.
  if (/^TABLE-/i.test(ticket.id) || /^Mesa\s*:/i.test(ticket.name)) return false;
  return true;
};

export const ACTIVE_CART_DRAFT_STORAGE_KEY = 'clic_pos_active_cart_draft_v1';
export const RECOVER_OTHER_SELLER_PARKED_SALES = 'POS_RECOVER_OTHER_SELLER_PARKED_SALES';

export const canRecoverDirectSale = (
  ownerId: string | null | undefined,
  user: User | null,
  roles: readonly RoleDefinition[],
): boolean => {
  if (!user?.id || user.isActive === false) return false;
  if (ownerId === user.id) return true;

  const role = roles.find(candidate => candidate.id === (user.roleId || user.role));
  return Boolean(role && role.isActive !== false
    && Array.isArray(role.permissions) && role.permissions.includes(RECOVER_OTHER_SELLER_PARKED_SALES));
};
