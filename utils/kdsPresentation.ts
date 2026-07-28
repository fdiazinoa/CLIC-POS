import type { CartItem, ParkedTicket } from '../types';

const PENDING_KDS_STATUSES = new Set(['PENDIENTE', 'PENDING', 'RETRY_PENDING', 'RETURN_PENDING']);

export const hasPendingKdsItem = (item?: Partial<CartItem> | null): boolean => (
  PENDING_KDS_STATUSES.has(String(item?.kdsStatus || '').trim().toUpperCase())
);

export const hasPendingKdsDispatch = (ticket?: Pick<ParkedTicket, 'items'> | null): boolean => (
  Boolean(ticket?.items?.some(hasPendingKdsItem))
);

const isTechnicalTerminalId = (value: string): boolean => (
  /^(?:T-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
);

export const formatKdsIdentityLabel = (code?: unknown, name?: unknown): string => {
  const rawCode = String(code || '').trim();
  const rawName = String(name || '').trim();
  const normalizedCode = isTechnicalTerminalId(rawCode) ? '' : rawCode;
  const normalizedName = isTechnicalTerminalId(rawName) ? '' : rawName;
  if (normalizedCode && normalizedName && normalizedCode.toLowerCase() !== normalizedName.toLowerCase()) {
    return `${normalizedCode} - ${normalizedName}`;
  }
  return normalizedName || normalizedCode || 'Terminal cocina';
};
