import { Capacitor } from '@capacitor/core';
import { Product, Warehouse } from '../types';
import { resolveProductActiveWarehouseIds } from './masterIdentity';
import { productIdentityCandidates, resolveOperationalProductId } from './productReferences';

const normalizeIdentityToken = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : value != null ? String(value).trim().toLowerCase() : '';

const asTrimmedString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : value != null ? String(value).trim() : '';

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

export const resolveProductDisplayImage = (product?: Partial<Product> | null): string => {
  if (!product) return '';
  const image = asTrimmedString((product as any).image);
  if (isRenderableImageSrc(image)) return image;

  const images = Array.isArray((product as any).images)
    ? (product as any).images.map(asTrimmedString)
    : [];
  const firstRenderableImage = images.find(isRenderableImageSrc);
  if (firstRenderableImage) return firstRenderableImage;

  const imageUrl = asTrimmedString((product as any).imageUrl || (product as any).image_url);
  if (isRenderableImageSrc(imageUrl)) return imageUrl;

  const localPath = asTrimmedString((product as any).imageLocalPath);
  if (localPath) return convertLocalFileSrc(localPath);
  if (image) return convertLocalFileSrc(image);
  if (imageUrl) return convertLocalFileSrc(imageUrl);

  const firstImage = images.find(Boolean);
  return firstImage ? convertLocalFileSrc(firstImage) : '';
};

export const isSeedCatalogProduct = (product?: Partial<Product> | null): boolean => {
  const id = normalizeIdentityToken(product?.id);
  return /^prod-\d+$/.test(id) || /^p\d+$/.test(id) || /^f\d+$/.test(id) || /^p-var-\d+$/.test(id);
};

export const productDisplayIdentityKey = (product: Product): string => {
  const ownId = normalizeIdentityToken(product.id);
  const operationalId = normalizeIdentityToken(resolveOperationalProductId(product));
  if (operationalId && operationalId !== ownId) return `op:${operationalId}`;

  const identityCandidate = productIdentityCandidates(product)
    .map(normalizeIdentityToken)
    .find((candidate) => candidate && candidate !== ownId);
  if (identityCandidate) return `identity:${identityCandidate}`;

  const barcode = normalizeIdentityToken(product.barcode);
  if (barcode) return `barcode:${barcode}`;

  const sku = normalizeIdentityToken((product as any).sku);
  if (sku) return `sku:${sku}`;

  const itemCode = normalizeIdentityToken((product as any).item_code);
  if (itemCode) return `item_code:${itemCode}`;

  const code = normalizeIdentityToken((product as any).code);
  if (code) return `code:${code}`;

  const name = normalizeIdentityToken(product.name);
  const category = normalizeIdentityToken(product.category);
  if (name) return `namecat:${name}::${category}`;

  return `id:${ownId}`;
};

export const scoreProductDisplayCandidate = (product: Product, warehouses: Warehouse[] = []): number => {
  const activeWarehouses = resolveProductActiveWarehouseIds(product, warehouses).length;
  const stockBalanceCount = Object.keys(product.stockBalances || {}).length;
  const updatedAtScore = new Date((product as any).updatedAt || (product as any).updated_at || (product as any).createdAt || 0).getTime() || 0;
  const syncImageScore = normalizeIdentityToken((product as any).imageLocalPath || (product as any).imageUrl || (product as any).image_url) ? 500 : 0;
  const anyImageScore = resolveProductDisplayImage(product) ? 50 : 0;
  const seedPenalty = isSeedCatalogProduct(product) ? -50_000 : 0;

  return (
    seedPenalty +
    activeWarehouses * 1000 +
    stockBalanceCount * 100 +
    syncImageScore +
    anyImageScore +
    (product.is_sellable !== false ? 10 : 0) +
    (Number.isFinite(Number(product.price)) ? 1 : 0) +
    updatedAtScore / 1_000_000_000_000
  );
};
