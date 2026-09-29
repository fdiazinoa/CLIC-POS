import type { BusinessConfig, Customer, MediaAsset, Product, Promotion } from '../types';
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

export const mergePromotionsPreservingMedia = (
  existing: Promotion[] | undefined,
  incoming: unknown,
  preserveMissing = true,
): Promotion[] => {
  const mergedIncoming = mergePromotionCollection(existing, incoming);
  if (!preserveMissing || !Array.isArray(incoming)) return mergedIncoming;
  const incomingIds = new Set(mergedIncoming.map((promotion) => String(promotion.id || '')));
  return [
    ...mergedIncoming,
    ...(existing || []).filter((promotion) => !incomingIds.has(String(promotion.id || ''))),
  ];
};

const RESTAURANT_TIME_ZONE = 'America/Santo_Domingo';
const DAY_KEYS: Record<string, string> = { Sun: 'D', Mon: 'L', Tue: 'M', Wed: 'X', Thu: 'J', Fri: 'V', Sat: 'S' };

const restaurantCalendarParts = (now: Date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: RESTAURANT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now).reduce<Record<string, string>>((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    day: DAY_KEYS[parts.weekday],
    time: `${parts.hour}:${parts.minute}`,
  };
};

const promotionIsActiveAt = (promotion: Promotion, now: Date): boolean => {
  const schedule = promotion.schedule;
  if (!schedule || schedule.isActive === false) return false;
  const { date, day, time } = restaurantCalendarParts(now);
  if (schedule.startDate && date < schedule.startDate) return false;
  if (schedule.endDate && date > schedule.endDate) return false;
  if (schedule.days?.length && !schedule.days.includes(day)) return false;
  if (schedule.startTime && schedule.endTime && schedule.startTime > schedule.endTime) {
    if (time < schedule.startTime && time > schedule.endTime) return false;
  } else {
    if (schedule.startTime && time < schedule.startTime) return false;
    if (schedule.endTime && time > schedule.endTime) return false;
  }
  return true;
};

const promotionConditionsMatch = (promotion: Promotion, customer?: Customer | null): boolean =>
  (promotion.conditions || []).every((condition) => {
    if (condition.type === 'HAS_WALLET') return Boolean(customer?.wallet && customer.wallet.status === 'ACTIVE');
    if (condition.type === 'CUSTOMER_TIER') return Boolean(customer && customer.tier === condition.value);
    if (condition.type === 'HAS_POINTS_MIN') return Boolean(customer && Number(customer.loyaltyPoints || 0) >= Number(condition.value || 0));
    return false;
  });

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
  customer?: Customer | null,
): PromotionCreative | null => {
  const candidates: Array<PromotionCreative & { stableIndex: number; priority: number }> = [];
  let stableIndex = 0;
  for (const promotion of promotions || []) {
    if (!promotionIsActiveAt(promotion, now)) continue;
    if (!promotionConditionsMatch(promotion, customer)) continue;
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
        priority: Number(promotion.priority || 0),
      });
    }
  }
  candidates.sort((left, right) =>
    right.priority - left.priority
    || Number(left.media.sortOrder || 0) - Number(right.media.sortOrder || 0)
    || left.stableIndex - right.stableIndex);
  const selected = candidates[0];
  if (!selected) return null;
  const { stableIndex: _stableIndex, priority: _priority, ...creative } = selected;
  return creative;
};
