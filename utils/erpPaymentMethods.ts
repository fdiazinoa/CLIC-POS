import type { BusinessConfig, PaymentMethod, PaymentMethodDefinition } from '../types';

const paymentTypes = new Set<PaymentMethod>(['CASH', 'CARD', 'QR', 'WALLET', 'ADVANCE', 'OTHER', 'CREDIT', 'STORE_CREDIT', 'UBER_EATS']);
const booleanValue = (value: unknown, fallback: boolean): boolean => {
  if (value === undefined || value === null) return fallback;
  if ([true, 1, 'true', '1'].includes(value as any)) return true;
  if ([false, 0, 'false', '0'].includes(value as any)) return false;
  throw new Error('PAYMENT_METHOD_BOOLEAN_INVALID');
};

/** Never interpret an error envelope or a partial page as an empty catalog. */
export const readErpPaymentMethodsSnapshot = (payload: any): unknown[] => {
  const rows = Array.isArray(payload) ? payload : payload?.items ?? payload?.data;
  if (!Array.isArray(rows) || payload?.supported === false || payload?.error || ['error', 'failed'].includes(payload?.status) || payload?.nextCursor || payload?.hasMore) {
    throw new Error('PAYMENT_METHODS_SNAPSHOT_INVALID');
  }
  if (payload?.count != null && Number(payload.count) !== rows.length) {
    throw new Error('PAYMENT_METHODS_SNAPSHOT_INCOMPLETE');
  }
  return rows;
};

export const normalizeErpPaymentMethods = (
  rows: unknown[], previous: PaymentMethodDefinition[] = [],
): PaymentMethodDefinition[] => {
  const ids = new Set<string>();
  return rows.map((value: any) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PAYMENT_METHOD_INVALID');
    const id = String(value.id || '').trim();
    const type = String(value.type || '').toUpperCase() as PaymentMethod;
    if (!id || ids.has(id) || !paymentTypes.has(type)) throw new Error('PAYMENT_METHOD_ID_OR_TYPE_INVALID');
    ids.add(id);
    // Only carry local settings across the same identity, or a legacy default
    // whose id equals the ERP code. Never match by display name or type alone.
    const prior = previous.find(method => method.id === id)
      ?? previous.find(method => method.id.toUpperCase() === String(value.code || '').toUpperCase());
    return {
      ...prior,
      ...value,
      id,
      name: String(value.name || prior?.name || value.code || id),
      type,
      isEnabled: booleanValue(value.isEnabled ?? value.is_enabled ?? value.active ?? value.isActive ?? value.is_active, prior?.isEnabled ?? true)
        && !value.deletedAt && !value.deleted_at && value._op !== 'DELETE',
      icon: value.icon ?? prior?.icon ?? (type === 'CARD' ? 'CreditCard' : type === 'CASH' ? 'Banknote' : 'Wallet'),
      color: value.color ?? prior?.color ?? 'bg-blue-500',
      opensDrawer: booleanValue(value.opensDrawer ?? value.opens_drawer, prior?.opensDrawer ?? false),
      requiresSignature: booleanValue(value.requiresSignature ?? value.requires_signature, prior?.requiresSignature ?? false),
      integration: value.integration ?? prior?.integration ?? 'NONE',
      integrationMode: value.integrationMode ?? value.integration_mode ?? prior?.integrationMode ?? 'MANUAL',
      paymentTermDays: value.paymentTermDays ?? value.payment_term_days ?? prior?.paymentTermDays,
    };
  });
};

export const allowsDefaultPaymentMethods = (config?: Pick<BusinessConfig, 'paymentMethodsSource'>): boolean =>
  config?.paymentMethodsSource !== 'ERP';
