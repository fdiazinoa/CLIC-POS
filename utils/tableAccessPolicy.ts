import type { Permission } from '../types';

export const canAccessOtherSellerTables = (
  permissions: Permission[],
  isAdmin = false,
): boolean => isAdmin
  || permissions.includes('ALL')
  || permissions.includes('POS_ACCESS_OTHER_SELLER_TABLES');

export const isTableLockedForUser = ({
  isBeingEdited,
  isOccupiedLike,
  waiterLockEnabled,
  waiterId,
  currentUserId,
  canAccessOtherSeller,
}: {
  isBeingEdited: boolean;
  isOccupiedLike: boolean;
  waiterLockEnabled: boolean;
  waiterId?: string;
  currentUserId: string;
  canAccessOtherSeller: boolean;
}): boolean => isBeingEdited || (
  isOccupiedLike
  && waiterLockEnabled
  && Boolean(waiterId)
  && String(waiterId) !== String(currentUserId)
  && !canAccessOtherSeller
);
