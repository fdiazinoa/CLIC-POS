import type { Customer } from '../../types';

const normalizeName = (value: unknown): string => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .replace(/\s+/g, ' ')
  .toLowerCase();

const customerCode = (customer: Customer): string => String(
  (customer as Customer & { code?: string }).code
  || customer.customer_code
  || customer.customerCode
  || customer.external_code
  || customer.externalCode
  || '',
).trim();

const hasMeaningfulValue = (value: unknown): boolean => (
  typeof value === 'string' ? value.trim().length > 0 : Number(value || 0) !== 0
);

/** A POS shadow has no information that can distinguish a real customer. */
export const isEmptyPosCustomerShadow = (customer: Customer): boolean => (
  /^POS-[A-F0-9]{12}$/i.test(customerCode(customer))
  && ![
    customer.taxId,
    customer.phone,
    customer.email,
    customer.address,
    customer.notes,
    customer.loyaltyPoints,
    customer.creditLimit,
    customer.currentDebt,
    customer.totalSpent,
  ].some(hasMeaningfulValue)
  && (customer.addresses?.length || 0) === 0
  && (customer.cards?.length || 0) === 0
);

/**
 * Presentation-only cleanup. Potentially distinct customers are preserved; an
 * empty POS-generated shadow is hidden only when the same name has a richer row.
 */
export const collapseEmptyPosCustomerShadows = (customers: Customer[]): Customer[] => {
  const namesWithCanonicalRecord = new Set(
    customers
      .filter(customer => !isEmptyPosCustomerShadow(customer))
      .map(customer => normalizeName(customer.name))
      .filter(Boolean),
  );

  return customers.filter(customer => (
    !isEmptyPosCustomerShadow(customer)
    || !namesWithCanonicalRecord.has(normalizeName(customer.name))
  ));
};
