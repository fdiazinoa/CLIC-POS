import type { Customer, Supplier } from '../types';

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export const resolveCustomerImageSrc = (customer?: Partial<Customer> | null): string => {
  if (!customer) return '';
  return (
    asString(customer.image) ||
    asString(customer.photo) ||
    asString(customer.avatar) ||
    asString(customer.imageUrl) ||
    asString(customer.photoUrl) ||
    asString(customer.avatarUrl)
  );
};

export const resolveSupplierImageSrc = (supplier?: Partial<Supplier> | null): string => {
  if (!supplier) return '';
  return (
    asString(supplier.image) ||
    asString(supplier.logo) ||
    asString(supplier.imageUrl) ||
    asString(supplier.logoUrl)
  );
};
