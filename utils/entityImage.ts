import { Capacitor } from '@capacitor/core';
import type { Customer, Product, Supplier } from '../types';

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const isRawLocalFileSrc = (value: string): boolean => /^file:\/\//i.test(value);
const isRenderableImageSrc = (value: string): boolean => Boolean(value) && !isRawLocalFileSrc(value);

const convertLocalFileSrc = (value: string): string => {
  if (!value || !isRawLocalFileSrc(value)) return value;

  try {
    return Capacitor.convertFileSrc(value);
  } catch {
    return value.replace(/^file:\/\//i, 'https://localhost/_capacitor_file_');
  }
};

export const resolveProductImageSrc = (product?: Partial<Product> | null): string => {
  if (!product) return '';

  const image = asString((product as any).image);
  if (isRenderableImageSrc(image)) return image;

  const images = Array.isArray((product as any).images)
    ? (product as any).images.map(asString)
    : [];
  const firstRenderableImage = images.find(isRenderableImageSrc);
  if (firstRenderableImage) return firstRenderableImage;

  const imageUrl = asString((product as any).imageUrl || (product as any).image_url);
  if (isRenderableImageSrc(imageUrl)) return imageUrl;

  const localPath = asString((product as any).imageLocalPath);
  if (localPath) return convertLocalFileSrc(localPath);
  if (image) return convertLocalFileSrc(image);
  if (imageUrl) return convertLocalFileSrc(imageUrl);

  const firstImage = images.find(Boolean);
  return firstImage ? convertLocalFileSrc(firstImage) : '';
};

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
