import type { BusinessConfig, MediaAsset, Product, Promotion } from '../types';
import { isValidRemoteMediaUrl, normalizeMediaAsset } from './media';

export type PromotionCreative = {
  promotionId: string;
  promotionName: string;
  targetType: Promotion['targetType'];
  targetValue?: string;
  media: MediaAsset & { type: 'IMAGE' };
  productIds: string[];
  productNames: string[];
};

const hasOwn = (value: unknown, key: string): boolean =>
  Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key));

const rawPromotionMedia = (promotion: Record<string, unknown>): unknown => {
  if (hasOwn(promotion, 'media')) return promotion.media;
  if (hasOwn(promotion, 'promotion_media')) return promotion.promotion_media;
  if (hasOwn(promotion, 'promotionMedia')) return promotion.promotionMedia;
  return undefined;
};

export const normalizePromotionMedia = (value: unknown): MediaAsset[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const raw = entry as Record<string, unknown>;
    const normalized = normalizeMediaAsset({
      id: String(raw.id || ''),
      type: String(raw.type || raw.media_type || raw.mediaType || '') as MediaAsset['type'],
      url: String(raw.url || raw.media_url || raw.mediaUrl || ''),
      posterUrl: String(raw.posterUrl || raw.poster_url || ''),
      mimeType: String(raw.mimeType || raw.mime_type || ''),
      storagePath: String(raw.storagePath || raw.storage_path || ''),
      version: String(raw.version || ''),
      sortOrder: Number(raw.sortOrder ?? raw.sort_order ?? index),
      active: (raw.active ?? raw.is_active ?? raw.isActive) !== false,
    }, index);
    return normalized ? [normalized] : [];
  });
};

export const normalizePromotionMediaContract = <T extends Record<string, unknown>>(promotion: T): T & { media?: MediaAsset[] } => {
  const media = normalizePromotionMedia(rawPromotionMedia(promotion));
  const normalized = { ...promotion } as T & { media?: MediaAsset[] };
  delete (normalized as Record<string, unknown>).promotion_media;
  delete (normalized as Record<string, unknown>).promotionMedia;
  if (media !== undefined) normalized.media = media;
  return normalized;
};

export const mergePromotionMediaContract = (
  existing: Promotion | undefined,
  incoming: Record<string, unknown>,
): Promotion => {
  const normalized = normalizePromotionMediaContract(incoming);
  return {
    ...(existing || {}),
    ...normalized,
    ...(normalized.media === undefined && existing?.media ? { media: existing.media } : {}),
  } as Promotion;
};

export const mergePromotionCollection = (
  existing: Promotion[] | undefined,
  incoming: unknown,
): Promotion[] => {
  if (!Array.isArray(incoming)) return existing || [];
  const existingById = new Map((existing || []).map((promotion) => [String(promotion.id), promotion]));
  return incoming
    .filter((promotion): promotion is Record<string, unknown> => Boolean(promotion && typeof promotion === 'object'))
    .map((promotion) => mergePromotionMediaContract(existingById.get(String(promotion.id || '')), promotion));
};

const DAY_KEYS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

const promotionIsActiveAt = (promotion: Promotion, now: Date): boolean => {
  const schedule = promotion.schedule;
  if (!schedule || schedule.isActive === false) return false;
  const date = now.toISOString().slice(0, 10);
  if (schedule.startDate && date < schedule.startDate) return false;
  if (schedule.endDate && date > schedule.endDate) return false;
  if (schedule.days?.length && !schedule.days.includes(DAY_KEYS[now.getDay()])) return false;
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (schedule.startTime && schedule.endTime && schedule.startTime > schedule.endTime) {
    if (time < schedule.startTime && time > schedule.endTime) return false;
  } else {
    if (schedule.startTime && time < schedule.startTime) return false;
    if (schedule.endTime && time > schedule.endTime) return false;
  }
  return true;
};

const token = (value: unknown): string => String(value || '').trim().toLowerCase();
const referenceTokens = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(referenceTokens);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return [record.id, record.code, record.sku, record.barcode, record.name, record.label,
      record.productId, record.product_id, record.variantId, record.variant_id].flatMap(referenceTokens);
  }
  const normalized = token(value);
  return normalized ? [normalized] : [];
};

const productTokens = (product: Product): Set<string> => new Set(referenceTokens([
  product.id,
  product.name,
  product.barcode,
  (product as any).sku,
  (product as any).code,
  (product as any).item_code,
  (product as any).source_product_id,
  (product as any).erp_product_id,
]));

const productCategoryTokens = (product: Product): Set<string> => new Set(referenceTokens([
  product.category,
  (product as any).categoria,
  (product as any).categoryId,
  (product as any).category_id,
  (product as any).posCategoryId,
  (product as any).pos_category_id,
]));

const intersects = (left: Set<string>, right: string[]): boolean => right.some((value) => left.has(value));

const promotionProducts = (promotion: Promotion, products: Product[], config: BusinessConfig): Product[] => {
  if (!['PRODUCT', 'VARIANT', 'CATEGORY', 'GROUP'].includes(promotion.targetType)) return [];
  const targets = referenceTokens([promotion.targetValue, promotion.targetLabel, promotion.targetRefs]);
  if (promotion.targetType === 'CATEGORY') {
    return products.filter((product) => intersects(productCategoryTokens(product), targets));
  }
  if (promotion.targetType === 'GROUP') {
    const group = (config.productGroups || []).find((candidate: any) =>
      intersects(new Set(referenceTokens(candidate)), referenceTokens([promotion.targetValue, promotion.targetLabel])));
    const groupProductRefs = referenceTokens((group as any)?.productIds || []);
    return products.filter((product) => intersects(productTokens(product), groupProductRefs.length ? groupProductRefs : targets));
  }
  if (promotion.targetType === 'VARIANT') {
    const parentTargets = referenceTokens([promotion.targetValue, promotion.targetLabel]);
    return products.filter((product) => {
      if (!intersects(productTokens(product), parentTargets)) return false;
      const variants = (product as any).variants || (product as any).variantOptions || [];
      return targets.length === 0 || intersects(new Set(referenceTokens(variants)), targets);
    });
  }
  return products.filter((product) => intersects(productTokens(product), targets));
};

const promotionMatchesTerminal = (promotion: Promotion, config: BusinessConfig, terminalId?: string): boolean => {
  if (!promotion.terminalIds?.length) return true;
  if (!terminalId) return false;
  const current = (config.terminals || []).find((terminal) => terminal.id === terminalId);
  const aliases = new Set(referenceTokens([
    terminalId,
    current?.id,
    current?.config?.erpTerminalId,
    current?.config?.terminalName,
    current?.config?.stationNumber,
    current?.config?.erpBinding,
  ]));
  return referenceTokens(promotion.terminalIds).some((candidate) => aliases.has(candidate));
};

export const resolveRestaurantPromotionCreative = (
  promotions: Promotion[] | undefined,
  products: Product[],
  config: BusinessConfig,
  terminalId: string | undefined,
  now = new Date(),
): PromotionCreative | null => {
  const candidates: Array<PromotionCreative & { stableIndex: number }> = [];
  let stableIndex = 0;
  for (const promotion of promotions || []) {
    if (!promotionIsActiveAt(promotion, now)) continue;
    if (!promotionMatchesTerminal(promotion, config, terminalId)) continue;
    const matchedProducts = promotionProducts(promotion, products, config);
    if (matchedProducts.length === 0) continue;
    for (const media of promotion.media || []) {
      const normalized = normalizeMediaAsset(media, stableIndex);
      const index = stableIndex++;
      if (!normalized || normalized.type !== 'IMAGE' || normalized.active === false || !isValidRemoteMediaUrl(normalized.url)) continue;
      candidates.push({
        promotionId: promotion.id,
        promotionName: promotion.name,
        targetType: promotion.targetType,
        targetValue: promotion.targetValue,
        media: { ...normalized, type: 'IMAGE' },
        productIds: matchedProducts.map((product) => product.id),
        productNames: matchedProducts.map((product) => product.name),
        stableIndex: index,
      });
    }
  }
  candidates.sort((left, right) =>
    Number(left.media.sortOrder || 0) - Number(right.media.sortOrder || 0)
    || left.stableIndex - right.stableIndex);
  const selected = candidates[0];
  if (!selected) return null;
  const { stableIndex: _stableIndex, ...creative } = selected;
  return creative;
};
