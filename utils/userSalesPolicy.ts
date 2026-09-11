import type { RoleDefinition, User } from '../types';

export const normalizeSalesPercent = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(100, Math.max(0, parsed));
};

export const resolveUserMaxDiscountPercent = (
  user: User | null | undefined,
  roles: RoleDefinition[],
): number | undefined => {
  const userLimit = normalizeSalesPercent(user?.maxDiscountPercent);
  if (userLimit !== undefined) return userLimit;
  const roleId = user?.roleId || user?.role;
  const role = roles.find((candidate) => candidate.id === roleId)
    || roles.find((candidate) => candidate.id === user?.role);
  return normalizeSalesPercent(role?.maxDiscountPercent);
};

export const canGrantDiscountPercent = (
  user: User | null | undefined,
  roles: RoleDefinition[],
  requestedPercent: number,
): boolean => {
  const limit = resolveUserMaxDiscountPercent(user, roles);
  return limit === undefined || requestedPercent <= limit + 0.0001;
};

export const calculateSalesCommission = (
  total: number,
  user: User | null | undefined,
): { salesCommissionPercent?: number; salesCommissionAmount?: number } => {
  const percent = normalizeSalesPercent(user?.commissionPercent);
  if (percent === undefined || percent <= 0 || !Number.isFinite(total) || total <= 0) return {};
  return {
    salesCommissionPercent: percent,
    salesCommissionAmount: Math.round(((total * percent) / 100 + Number.EPSILON) * 100) / 100,
  };
};
