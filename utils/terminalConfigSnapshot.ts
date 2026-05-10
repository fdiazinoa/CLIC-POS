import {
  BusinessConfig,
  Campaign,
  Coupon,
  DeviceRole,
  DocumentSeries,
  DocumentType,
  FiscalDocumentCode,
  FiscalAllocation,
  FiscalRangeDGII,
  LoyaltyConfig,
  NCFType,
  Promotion,
  PromotionTargetType,
  PromotionType,
  ProductGroup,
  Season,
  Tariff,
  TaxDefinition,
  TerminalConfig,
  TerminalConfigSnapshot,
  Warehouse,
} from '../types';
import { DEFAULT_DOCUMENT_SERIES, DEFAULT_TERMINAL_CONFIG, INITIAL_TARIFFS, INITIAL_TAXES } from '../constants';
import {
  canonicalizeDocumentSeries,
  mergeDocumentSeriesCollection,
  resolveDocumentAssignmentId,
  resolveDocumentSeriesDisplayPrefix,
} from './documentSeriesIdentity';
import { getDefaultRoleConfig, resolveDeviceRoleValue } from './deviceRoleHelpers';
import { resolveTariffId, resolveWarehouseId } from './masterIdentity';

const asObject = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, any>;
};

const asArray = <T = any>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const asRefString = (value: unknown): string => (
  typeof value === 'string'
    ? value.trim()
    : typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : ''
);
const asNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const asBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
};

const cloneDeep = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/**
 * ERP (Settings → Terminal) guarda jornada/Z en `terminal.config.session`:
 * `requireZClose`, `requireOpenSession`, `allowPartialXReport`, `autoLockMinutes`,
 * `businessStartHour`, `autoPrintZReport`, `emailZReport`, `zReportEmails`.
 * El POS usa `workflow.session` con otros nombres (`forceZChange`, `allowSalesWithOpenZ`, …).
 * Sin este mapeo, el snapshot trae los booleans del ERP pero el POS no los aplica.
 */
const readErpSessionNumber = (erpSession: Record<string, unknown>, camel: string, snake: string): number | undefined => {
  const raw = erpSession[camel] ?? erpSession[snake];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
};

const mergeWorkflowSessionFromErpConfig = (
  templateSession: TerminalConfig['workflow']['session'],
  erpSession: Record<string, unknown>,
  posShapeSessionPatch: Record<string, unknown>
): TerminalConfig['workflow']['session'] => {
  const merged: TerminalConfig['workflow']['session'] = {
    ...templateSession,
    ...asObject(posShapeSessionPatch),
  };

  if (typeof erpSession.requireZClose === 'boolean') {
    merged.forceZChange = erpSession.requireZClose;
  }
  if (typeof erpSession.requireOpenSession === 'boolean') {
    merged.allowSalesWithOpenZ = !erpSession.requireOpenSession;
  }

  const partialX =
    erpSession.allowPartialXReport ?? erpSession.allow_partial_x_report;
  if (typeof partialX === 'boolean') {
    merged.allowPartialXReport = partialX;
  }

  const bsh = readErpSessionNumber(erpSession, 'businessStartHour', 'business_start_hour');
  if (bsh !== undefined) {
    merged.businessStartHour = Math.max(0, Math.min(23, Math.floor(bsh)));
  }

  const autoPrint = erpSession.autoPrintZReport ?? erpSession.auto_print_z_report;
  if (typeof autoPrint === 'boolean') {
    merged.autoPrintZReport = autoPrint;
  }

  const emailZ = erpSession.emailZReport ?? erpSession.email_z_report;
  if (typeof emailZ === 'boolean') {
    merged.emailZReport = emailZ;
  }

  const allowZWithOpenTables =
    erpSession.allowZWithOpenTables ?? erpSession.allow_z_with_open_tables;
  if (typeof allowZWithOpenTables === 'boolean') {
    merged.allowZWithOpenTables = allowZWithOpenTables;
  }

  const zEmails = erpSession.zReportEmails ?? erpSession.z_report_emails;
  if (typeof zEmails === 'string') {
    merged.zReportEmails = zEmails;
  }

  return merged;
};

const KNOWN_DOCUMENT_TYPES = new Set<DocumentType>([
  'TICKET',
  'REFUND',
  'VOID',
  'TRANSFER',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'PURCHASE',
  'PRODUCTION',
  'CASH_IN',
  'CASH_OUT',
  'CASH_DEPOSIT',
  'CASH_WITHDRAWAL',
  'Z_REPORT',
  'X_REPORT',
  'RECEIVABLE',
  'PAYABLE',
  'PAYMENT_IN',
  'PAYMENT_OUT',
]);

const normalizeDocumentType = (value: unknown, fallback: DocumentType = 'TICKET'): DocumentType => {
  const raw = asString(value).replace(/[\s-]+/g, '_').toUpperCase();
  if (KNOWN_DOCUMENT_TYPES.has(raw as DocumentType)) return raw as DocumentType;
  return fallback;
};

const normalizeNcfType = (value: unknown, fallback: FiscalDocumentCode = 'B02'): FiscalDocumentCode => {
  const raw = asString(value).toUpperCase();
  const allowed: FiscalDocumentCode[] = ['B01', 'B02', 'B04', 'B14', 'B15', 'E31', 'E32', 'E34', 'E44', 'E45'];
  return allowed.includes(raw as FiscalDocumentCode) ? (raw as FiscalDocumentCode) : fallback;
};

const normalizeStationNumber = (value: unknown): string | undefined => {
  const raw = asString(value);
  if (raw) return raw;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
};

const normalizeTariff = (raw: unknown, index: number): Tariff | null => {
  const data = asObject(raw);
  const id = asString(data.id || data.tariff_id || data.code || data.uid);
  if (!id) return null;

  return {
    id,
    code: asString(data.code || data.tariff_code || data.id || id) || id,
    name: asString(data.name || data.label || id) || id,
    active: asBoolean(data.active, true),
    currency: asString(data.currency || data.currency_code || 'DOP') || 'DOP',
    taxIncluded: asBoolean(data.taxIncluded ?? data.tax_included, true),
    strategy: {
      type: asString(data.strategy?.type || data.strategy_type || 'MANUAL') as Tariff['strategy']['type'],
      rounding: asString(data.strategy?.rounding || data.rounding || 'NONE') as Tariff['strategy']['rounding'],
      factor: typeof data.strategy?.factor === 'number' ? data.strategy.factor : undefined,
      baseTariffId: asString(data.strategy?.baseTariffId || data.strategy?.base_tariff_id || data.base_tariff_id) || undefined,
    },
    scope: {
      storeIds: asArray<string>(data.scope?.storeIds || data.scope?.store_ids || data.store_ids || ['ALL']).filter(Boolean),
      priority: asNumber(data.scope?.priority ?? data.priority, index),
    },
    schedule: {
      daysOfWeek: asArray<number>(data.schedule?.daysOfWeek || data.schedule?.days_of_week || [0, 1, 2, 3, 4, 5, 6]),
      timeStart: asString(data.schedule?.timeStart || data.schedule?.time_start || '00:00') || '00:00',
      timeEnd: asString(data.schedule?.timeEnd || data.schedule?.time_end || '23:59') || '23:59',
    },
    items: asObject(data.items),
  };
};

const normalizeWarehouse = (raw: unknown, index: number): Warehouse | null => {
  const data = asObject(raw);
  const id = asString(data.id || data.warehouse_id || data.code || data.uid);
  if (!id) return null;

  return {
    id,
    warehouseId: asString(data.warehouseId || data.warehouse_id) || undefined,
    code: asString(data.code || id) || id,
    name: asString(data.name || data.label || id) || id,
    label: asString(data.label || data.name || id) || undefined,
    type: asString(data.type || 'GENERAL') || 'GENERAL',
    address: asString(data.address),
    allowPosSale: asBoolean(data.allowPosSale ?? data.allow_pos_sale, true),
    allowNegativeStock: asBoolean(data.allowNegativeStock ?? data.allow_negative_stock, false),
    isMain: asBoolean(data.isMain ?? data.is_main, index === 0),
    storeId: asString(data.storeId || data.store_id) || undefined,
    inventoryLocalId: asString(data.inventoryLocalId || data.inventory_local_id || data.localWarehouseId || data.local_warehouse_id) || undefined,
    erpWarehouseId:
      asString(
        data.erpWarehouseId
        || data.erp_warehouse_id
        || data.sourceWarehouseId
        || data.source_warehouse_id
        || data.warehouseId
        || data.warehouse_id
        || data.inventoryLocalId
        || data.inventory_local_id
        || data.uid
        || data.uuid
        || id
      ) || id,
    sourceWarehouseId: asString(data.sourceWarehouseId || data.source_warehouse_id || data.erpWarehouseId || data.erp_warehouse_id) || undefined,
    uid: asString(data.uid || data.uuid) || undefined,
  };
};

const normalizeTax = (raw: unknown, index: number): TaxDefinition | null => {
  const data = asObject(raw);
  const id = asString(data.id || data.code || data.tax_id || data.taxCode || `tax-${index + 1}`);
  if (!id) return null;

  const rawType = asString(data.type || data.tax_type || 'OTHER').toUpperCase();
  const type: TaxDefinition['type'] =
    rawType === 'VAT' || rawType === 'SERVICE_CHARGE' || rawType === 'EXEMPT'
      ? rawType
      : 'OTHER';

  return {
    id,
    code: asString(data.code || data.tax_code) || undefined,
    name: asString(data.name || data.label || id) || id,
    rate: asNumber(data.rate),
    type,
  };
};

const normalizeDocumentSeries = (raw: unknown, index: number): DocumentSeries | null => {
  const data = asObject(raw);
  const id = asString(data.id || data.series_id || data.code || data.prefix || `SERIES-${index + 1}`);
  if (!id) return null;

  const displayPrefix = resolveDocumentSeriesDisplayPrefix(data);

  return canonicalizeDocumentSeries({
    id,
    documentType: normalizeDocumentType(data.documentType || data.document_type || data.type, 'TICKET'),
    name: asString(data.name || data.label || id) || id,
    description: asString(data.description || data.notes || ''),
    prefix: displayPrefix,
    nextNumber: asNumber(data.nextNumber ?? data.next_number ?? data.current_number, 1),
    padding: asNumber(data.padding ?? data.number_padding, 6),
    icon: asString(data.icon || 'Receipt') || 'Receipt',
    color: asString(data.color || 'blue') || 'blue',
    businessUnit: asString(data.businessUnit || data.business_unit) || undefined,
  });
};

const normalizeFiscalRange = (raw: unknown, index: number): FiscalRangeDGII | null => {
  const data = asObject(raw);
  const id = asString(data.id || data.range_id || data.uid || `fiscal-range-${index + 1}`);
  if (!id) return null;

  return {
    id,
    type: normalizeNcfType(data.type || data.ncf_type || 'B02'),
    prefix: asString(data.prefix || data.series_prefix || '') || '',
    startNumber: asNumber(data.startNumber ?? data.start_number, 0),
    endNumber: asNumber(data.endNumber ?? data.end_number, 0),
    currentGlobal: asNumber(data.currentGlobal ?? data.current_global ?? data.current_number, 0),
    expiryDate: asString(data.expiryDate || data.expiry_date || '') || '',
    isActive: asBoolean(data.isActive ?? data.is_active, true),
  };
};

const normalizeFiscalAllocation = (raw: unknown, index: number, terminalId: string): FiscalAllocation | null => {
  const data = asObject(raw);
  const id = asString(data.id || data.allocation_id || data.uid || `fiscal-alloc-${index + 1}`);
  if (!id) return null;
  const sourceTerminalId = asString(data.terminalId ?? data.terminal_id);
  const metadata = asObject(data.metadata);

  return {
    id,
    terminalId: terminalId || sourceTerminalId,
    fiscalRangeId: asString(data.fiscalRangeId ?? data.fiscal_range_id),
    ncfType: normalizeNcfType(data.ncfType || data.ncf_type || 'B02'),
    reservedStart: asNumber(data.reservedStart ?? data.reserved_start, 0),
    reservedEnd: asNumber(data.reservedEnd ?? data.reserved_end, 0),
    nextNumber: asNumber(data.nextNumber ?? data.next_number, 0),
    status: (asString(data.status) || 'ACTIVE') as FiscalAllocation['status'],
    releasedAt: asString(data.releasedAt ?? data.released_at) || null,
    metadata: {
      ...metadata,
      sourceTerminalId: sourceTerminalId || metadata.sourceTerminalId || null,
    },
  };
};

const normalizeLoyaltyConfig = (raw: unknown): LoyaltyConfig | null => {
  const data = asObject(raw);
  if (Object.keys(data).length === 0) return null;

  return {
    isEnabled: asBoolean(data.isEnabled ?? data.is_enabled, false),
    earnRate: asNumber(data.earnRate ?? data.earn_rate, 0),
    redeemRate: asNumber(data.redeemRate ?? data.redeem_rate, 1),
    minRedemptionPoints: asNumber(data.minRedemptionPoints ?? data.min_redemption_points, 0),
    expirationMonths: asNumber(data.expirationMonths ?? data.expiration_months, 0),
    excludedCategories: asArray<string>(data.excludedCategories ?? data.excluded_categories)
      .map((entry) => asString(entry))
      .filter(Boolean),
    tiers: asArray(data.tiers).map((tier, index) => {
      const record = asObject(tier);
      return {
        id: asString(record.id) || `tier-${index + 1}`,
        name: asString(record.name) || `Tier ${index + 1}`,
        minPoints: asNumber(record.minPoints ?? record.min_points, 0),
        color: asString(record.color) || 'blue',
        icon: asString(record.icon) || undefined,
      };
    }),
  };
};

const normalizeCampaign = (raw: unknown, index: number): Campaign | null => {
  const data = asObject(raw);
  const id = asString(data.id || data.campaignId || data.campaign_id || `campaign-${index + 1}`);
  if (!id) return null;

  const activeHours = asObject(data.activeHours ?? data.active_hours);

  return {
    id,
    name: asString(data.name || data.label || id) || id,
    description: asString(data.description) || undefined,
    benefitType: (asString(data.benefitType ?? data.benefit_type).toUpperCase() || 'PERCENT') as Campaign['benefitType'],
    benefitValue: asNumber(data.benefitValue ?? data.benefit_value, 0),
    minPurchaseAmount: data.minPurchaseAmount ?? data.min_purchase_amount ?? undefined,
    maxDiscountAmount: data.maxDiscountAmount ?? data.max_discount_amount ?? undefined,
    activeDays: asArray<string>(data.activeDays ?? data.active_days).map((entry) => asString(entry)).filter(Boolean),
    activeHours: Object.keys(activeHours).length > 0
      ? {
          start: asString(activeHours.start),
          end: asString(activeHours.end),
        }
      : undefined,
    startDate: asString(data.startDate ?? data.start_date) || new Date().toISOString(),
    endDate: asString(data.endDate ?? data.end_date) || new Date().toISOString(),
    totalGenerated: asNumber(data.totalGenerated ?? data.total_generated, 0),
    createdAt: asString(data.createdAt ?? data.created_at) || new Date().toISOString(),
  };
};

const normalizeCoupon = (raw: unknown, index: number): Coupon | null => {
  const data = asObject(raw);
  const id = asString(data.id || data.couponId || data.coupon_id || `coupon-${index + 1}`);
  const code = asString(data.code || data.couponCode || data.coupon_code);
  if (!id || !code) return null;

  return {
    id,
    campaignId: asString(data.campaignId ?? data.campaign_id),
    code,
    status: (asString(data.status).toUpperCase() || 'GENERATED') as Coupon['status'],
    assignedTo: asString(data.assignedTo ?? data.assigned_to) || undefined,
    redeemedAt: asString(data.redeemedAt ?? data.redeemed_at) || undefined,
    ticketRef: asString(data.ticketRef ?? data.ticket_ref) || undefined,
    terminalId: asString(data.terminalId ?? data.terminal_id) || undefined,
    createdAt: asString(data.createdAt ?? data.created_at) || new Date().toISOString(),
  };
};

const POS_PROMO_TYPES: PromotionType[] = [
  'DISCOUNT',
  'BOGO',
  'HAPPY_HOUR',
  'CONDITIONAL_TARGET',
  'BUNDLE',
];

const collectPromotionRefs = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectPromotionRefs(entry));
  }

  if (value && typeof value === 'object') {
    const obj = asObject(value);
    return [
      obj.id,
      obj.value,
      obj.code,
      obj.sku,
      obj.barcode,
      obj.itemId,
      obj.item_id,
      obj.productId,
      obj.product_id,
      obj.sourceProductId,
      obj.source_product_id,
      obj.erpProductId,
      obj.erp_product_id,
      obj.sourceItemId,
      obj.source_item_id,
      obj.categoryId,
      obj.category_id,
      obj.name,
      obj.label,
    ].flatMap((entry) => collectPromotionRefs(entry));
  }

  const ref = asRefString(value);
  return ref ? [ref] : [];
};

const uniquePromotionRefs = (values: string[]): string[] => {
  const seen = new Set<string>();
  const refs: string[] = [];
  values.forEach((value) => {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    refs.push(value.trim());
  });
  return refs;
};

const normalizePromotionTargetType = (raw: unknown): PromotionTargetType => {
  const t = asString(raw).toUpperCase();
  const allowed: PromotionTargetType[] = ['ALL', 'PRODUCT', 'CATEGORY', 'GROUP', 'SEASON'];
  return (allowed.includes(t as PromotionTargetType) ? t : 'PRODUCT') as PromotionTargetType;
};

/** Payload ya en forma POS (camelCase) desde ERP `resolved.promotions`. */
const normalizePromotionFromErpPayload = (raw: unknown): Promotion | null => {
  const data = asObject(raw);
  const id = asString(data.id);
  if (!id) return null;

  const typeRaw = asString(data.type ?? data.promotionType ?? data.promotion_type).toUpperCase();
  const type = (POS_PROMO_TYPES.includes(typeRaw as PromotionType) ? typeRaw : 'DISCOUNT') as PromotionType;

  const sched = asObject(data.schedule);
  const days = asArray<string>(
    sched.days ??
    sched.weekDays ??
    sched.week_days ??
    data.days ??
    data.weekDays ??
    data.week_days
  ).map((d) => asString(d)).filter(Boolean);
  const defaultDays = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

  const triggerRaw = asObject(data.trigger);
  const triggerType = asString(triggerRaw.type);
  const allowedTrigger = new Set(['TOTAL_SPEND', 'ITEM_QTY', 'MIN_TICKET_AMOUNT']);
  const trigger: Promotion['trigger'] | undefined =
    triggerType && allowedTrigger.has(triggerType)
      ? {
          type: triggerType as NonNullable<Promotion['trigger']>['type'],
          value: asNumber(triggerRaw.value, 0),
          excludeCategories: asArray<string>(triggerRaw.excludeCategories).map((c) => asString(c)).filter(Boolean),
          isRecursive: asBoolean(triggerRaw.isRecursive, false),
        }
      : undefined;

  const stratRaw = asObject(data.targetStrategy ?? data.target_strategy);
  const targetStrategy =
    stratRaw && (stratRaw.mode != null || stratRaw.filterValue != null || stratRaw.filter_value != null)
      ? {
          mode: (asString(stratRaw.mode) || 'CHEAPEST_ITEM') as NonNullable<Promotion['targetStrategy']>['mode'],
          filterValue: (stratRaw.filterValue ?? stratRaw.filter_value) as string | number | undefined,
          tieBreaker: (stratRaw.tieBreaker ?? stratRaw.tie_breaker) as NonNullable<Promotion['targetStrategy']>['tieBreaker'],
          allowSelfTrigger: (stratRaw.allowSelfTrigger ?? stratRaw.allow_self_trigger) as boolean | undefined,
      }
      : undefined;

  const targetTypeRaw =
    data.targetType ??
    data.target_type ??
    (data.categoryId != null || data.category_id != null || data.categoryName != null || data.category_name != null || data.categoryIds != null || data.category_ids != null
      ? 'CATEGORY'
      : data.groupId != null || data.group_id != null
        ? 'GROUP'
        : data.seasonId != null || data.season_id != null
          ? 'SEASON'
          : undefined);
  const targetValueRaw =
    data.targetValue ??
    data.target_value ??
    data.targetId ??
    data.target_id ??
    data.categoryId ??
    data.category_id ??
    data.categoryName ??
    data.category_name ??
    data.groupId ??
    data.group_id ??
    data.seasonId ??
    data.season_id;
  const targetRefs = [
    data.targetRefs ?? data.target_refs,
    data.productIds ?? data.product_ids,
    data.itemIds ?? data.item_ids,
    data.categoryIds ?? data.category_ids,
    data.categoryNames ?? data.category_names,
    data.targetIds ?? data.target_ids,
    data.targetValues ?? data.target_values,
    data.targets,
  ].flatMap((entry) => collectPromotionRefs(entry));

  return {
    id,
    name: asString(data.name) || id,
    type,
    priority: asNumber(data.priority, 1),
    trigger,
    targetType: normalizePromotionTargetType(targetTypeRaw),
    targetValue: targetValueRaw != null ? asRefString(targetValueRaw) : undefined,
    targetLabel: asString(data.targetLabel || data.target_label) || undefined,
    targetRefs: uniquePromotionRefs(targetRefs),
    targetStrategy,
    benefitType: (asString(data.benefitType ?? data.benefit_type) || undefined) as Promotion['benefitType'],
    benefitValue: asNumber(
      data.benefitValue ??
      data.benefit_value ??
      data.discountPercent ??
      data.discount_percent ??
      data.discountValue ??
      data.discount_value ??
      data.value,
      0
    ),
    schedule: {
      days: days.length > 0 ? days : defaultDays,
      startTime: asString(sched.startTime ?? sched.start_time ?? data.startTime ?? data.start_time) || '00:00',
      endTime: asString(sched.endTime ?? sched.end_time ?? data.endTime ?? data.end_time) || '23:59',
      startDate: sched.startDate || sched.start_date || data.startDate || data.start_date ? asString(sched.startDate ?? sched.start_date ?? data.startDate ?? data.start_date) : undefined,
      endDate: sched.endDate || sched.end_date || data.endDate || data.end_date ? asString(sched.endDate ?? sched.end_date ?? data.endDate ?? data.end_date) : undefined,
      isActive: asBoolean(sched.isActive ?? sched.is_active ?? data.isActive ?? data.is_active ?? data.active ?? data.enabled, true),
    },
    terminalIds: uniquePromotionRefs(collectPromotionRefs(data.terminalIds ?? data.terminal_ids)),
  };
};

const normalizeProductGroupFromErpPayload = (raw: unknown, index: number): ProductGroup | null => {
  const data = asObject(raw);
  const id = asString(data.id || data.groupId || data.group_id || `group-${index + 1}`);
  if (!id) return null;

  const productIds = uniquePromotionRefs(asArray<any>(data.productIds ?? data.product_ids ?? data.items ?? data.products)
    .flatMap((entry) => {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const obj = asObject(entry);
        return collectPromotionRefs([
          obj.id,
          obj.productId,
          obj.product_id,
          obj.itemId,
          obj.item_id,
          obj.sourceProductId,
          obj.source_product_id,
          obj.erpProductId,
          obj.erp_product_id,
          obj.sourceItemId,
          obj.source_item_id,
          obj.sku,
          obj.code,
          obj.item_code,
          obj.barcode,
        ]);
      }
      return collectPromotionRefs(entry);
    })
    .filter(Boolean));

  return {
    id,
    name: asString(data.name) || id,
    code: asString(data.code) || id,
    color: asString(data.color) || undefined,
    description: asString(data.description) || undefined,
    productIds,
  };
};

const normalizeSeasonFromErpPayload = (raw: unknown, index: number): Season | null => {
  const data = asObject(raw);
  const id = asString(data.id || data.seasonId || data.season_id || `season-${index + 1}`);
  if (!id) return null;

  const productIds = uniquePromotionRefs(asArray<any>(data.productIds ?? data.product_ids ?? data.items ?? data.products)
    .flatMap((entry) => {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const obj = asObject(entry);
        return collectPromotionRefs([
          obj.id,
          obj.productId,
          obj.product_id,
          obj.itemId,
          obj.item_id,
          obj.sourceProductId,
          obj.source_product_id,
          obj.erpProductId,
          obj.erp_product_id,
          obj.sourceItemId,
          obj.source_item_id,
          obj.sku,
          obj.code,
          obj.item_code,
          obj.barcode,
        ]);
      }
      return collectPromotionRefs(entry);
    })
    .filter(Boolean));

  const affectedCategories = asArray<any>(data.affectedCategories ?? data.affected_categories ?? data.categories)
    .map((entry) => {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const obj = asObject(entry);
        return asString(obj.id || obj.code || obj.name);
      }
      return asString(entry);
    })
    .filter(Boolean);

  return {
    id,
    name: asString(data.name) || id,
    code: asString(data.code) || id,
    startDate: asString(data.startDate ?? data.start_date) || new Date().toISOString().split('T')[0],
    endDate: asString(data.endDate ?? data.end_date) || new Date().toISOString().split('T')[0],
    isActive: asBoolean(data.isActive ?? data.is_active, true),
    productIds,
    multiplier: asNumber(data.multiplier, 1),
    affectedCategories,
  };
};

const normalizeAssignments = (raw: unknown): Record<string, string> => {
  if (Array.isArray(raw)) {
    return raw.reduce<Record<string, string>>((acc, item) => {
      const data = asObject(item);
      const key = normalizeDocumentType(
        data.documentType || data.document_type || data.key || data.assignment_key || data.role,
        'TICKET'
      );
      const value =
        asString(data.seriesId || data.series_id || data.documentSeriesId || data.document_series_id || data.value || data.id);
      if (key && value) acc[key] = value;
      return acc;
    }, {});
  }

  const data = asObject(raw);
  return Object.entries(data).reduce<Record<string, string>>((acc, [key, value]) => {
    const normalizedKey = normalizeDocumentType(key, 'TICKET');
    const rawValue = asObject(value);
    const normalizedValue =
      asString(rawValue.seriesId || rawValue.series_id || rawValue.documentSeriesId || rawValue.document_series_id || rawValue.id) ||
      asString(value);
    if (normalizedKey && normalizedValue) acc[normalizedKey] = normalizedValue;
    return acc;
  }, {});
};

export const extractTerminalConfigSnapshot = (payload: unknown): TerminalConfigSnapshot | null => {
  const data = asObject(payload);
  const candidates = [
    data.terminal_config,
    asObject(data.data).terminal_config,
    asObject(data.result).terminal_config,
    asObject(data.payload).terminal_config,
    data,
  ];

  for (const candidate of candidates) {
    const snapshot = asObject(candidate);
    if (
      asString(snapshot.terminal_id) ||
      Object.keys(asObject(snapshot.masters)).length > 0 ||
      Object.keys(asObject(snapshot.resolved)).length > 0 ||
      Object.keys(asObject(snapshot.config)).length > 0 ||
      snapshot.resolution_error != null
    ) {
      return snapshot as TerminalConfigSnapshot;
    }
  }

  return null;
};

export const mergeTerminalConfigSnapshots = (
  cachedSnapshot?: TerminalConfigSnapshot | null,
  incomingSnapshot?: TerminalConfigSnapshot | null
): TerminalConfigSnapshot | null => {
  const cached = asObject(cachedSnapshot);
  const incoming = asObject(incomingSnapshot);
  const hasCached = Object.keys(cached).length > 0;
  const hasIncoming = Object.keys(incoming).length > 0;

  if (!hasCached && !hasIncoming) {
    return null;
  }

  const merged = cloneDeep({
    ...cached,
    ...incoming,
  }) as TerminalConfigSnapshot;

  const cachedMasters = asObject(cached.masters);
  const incomingMasters = asObject(incoming.masters);
  if (Object.keys(cachedMasters).length > 0 || Object.keys(incomingMasters).length > 0) {
    merged.masters = {
      ...cachedMasters,
      ...incomingMasters,
    };
  }

  const cachedResolved = asObject(cached.resolved);
  const incomingResolved = asObject(incoming.resolved);
  if (Object.keys(cachedResolved).length > 0 || Object.keys(incomingResolved).length > 0) {
    const resolved = {
      ...cachedResolved,
      ...incomingResolved,
    } as Record<string, any>;

    ['pricing', 'inventory', 'documents', 'catalog', 'loyalty', 'identity', 'terminal', 'deviceRole', 'device_role'].forEach((key) => {
      const cachedSection = asObject(cachedResolved[key]);
      const incomingSection = asObject(incomingResolved[key]);
      if (Object.keys(cachedSection).length > 0 || Object.keys(incomingSection).length > 0) {
        resolved[key] = {
          ...cachedSection,
          ...incomingSection,
        };
      }
    });

    merged.resolved = resolved as TerminalConfigSnapshot['resolved'];
  }

  const cachedConfig = asObject(cached.config);
  const incomingConfig = asObject(incoming.config);
  if (Object.keys(cachedConfig).length > 0 || Object.keys(incomingConfig).length > 0) {
    merged.config = {
      ...cachedConfig,
      ...incomingConfig,
    };
  }

  return merged;
};

const resolveTerminalTemplate = (config: BusinessConfig, terminalId: string): TerminalConfig => {
  const existing = (config.terminals || []).find((terminal) => terminal.id === terminalId)?.config;
  const first = (config.terminals || [])[0]?.config;
  return cloneDeep(existing || first || DEFAULT_TERMINAL_CONFIG);
};

type SnapshotSource = 'resolved' | 'fallback_config' | 'cached_snapshot' | 'existing_config';

export interface ApplyTerminalConfigSnapshotOptions {
  terminalId: string;
  posDeviceId?: string;
  bindingMode?: 'MASTER' | 'SLAVE';
  incomingSnapshot?: TerminalConfigSnapshot | null;
  cachedSnapshot?: TerminalConfigSnapshot | null;
}

export interface ApplyTerminalConfigSnapshotResult {
  config: BusinessConfig;
  terminalId: string;
  snapshot: TerminalConfigSnapshot | null;
  snapshotSource: SnapshotSource;
  usedResolved: boolean;
  usedFallbackConfig: boolean;
  usedCachedSnapshot: boolean;
  hasResolutionError: boolean;
  fullPullOnPairing?: boolean;
}

export interface TerminalOperationalDocumentState {
  terminalId: string;
  documentSeries: DocumentSeries[];
  fiscalRanges: FiscalRangeDGII[];
  fiscalAllocations: FiscalAllocation[];
}

export const applyTerminalConfigSnapshot = (
  baseConfig: BusinessConfig,
  options: ApplyTerminalConfigSnapshotOptions
): ApplyTerminalConfigSnapshotResult => {
  const { terminalId, posDeviceId, bindingMode, incomingSnapshot, cachedSnapshot } = options;
  const nextConfig = cloneDeep(baseConfig);
  const incoming = incomingSnapshot || null;
  const cached = cachedSnapshot || null;
  const mergedSnapshot = mergeTerminalConfigSnapshots(cached, incoming);
  const incomingResolved = asObject(incoming?.resolved);
  const incomingFallbackConfig = asObject(incoming?.config);
  const cachedResolved = asObject(cached?.resolved);
  const hasResolutionError = Boolean(incoming?.resolution_error != null);
  const hasIncomingResolved = Object.keys(incomingResolved).length > 0;
  const hasIncomingFallbackConfig = Object.keys(incomingFallbackConfig).length > 0;
  const hasCachedResolved = Object.keys(cachedResolved).length > 0;

  let snapshotSource: SnapshotSource = 'existing_config';
  let effectiveSnapshot: TerminalConfigSnapshot | null = mergedSnapshot || incoming;
  let effectiveResolved = incomingResolved;
  let effectiveFallbackConfig = incomingFallbackConfig;

  if (hasIncomingResolved && !hasResolutionError) {
    snapshotSource = 'resolved';
  } else if (hasIncomingFallbackConfig) {
    snapshotSource = 'fallback_config';
  } else if (hasCachedResolved) {
    snapshotSource = 'cached_snapshot';
    effectiveSnapshot = mergedSnapshot || cached;
    effectiveResolved = cachedResolved;
    effectiveFallbackConfig = asObject(cached?.config);
  }

  const resolvedIdentity = {
    ...asObject(effectiveSnapshot),
    ...asObject(effectiveResolved.identity),
    ...asObject(effectiveResolved.terminal),
  } as Record<string, any>;
  const resolvedPricing = asObject(effectiveResolved.pricing);
  const resolvedInventory = asObject(effectiveResolved.inventory);
  const resolvedDocuments = asObject(effectiveResolved.documents);
  const resolvedCatalog = asObject(effectiveResolved.catalog);
  const resolvedTaxes = asArray(effectiveResolved.taxes);
  const resolvedLoyalty = asObject(effectiveResolved.loyalty);
  const hasIncomingFiscalAllocations = Object.prototype.hasOwnProperty.call(resolvedDocuments, 'fiscal_allocations');

  const fallbackOperational = asObject(effectiveFallbackConfig.operational);
  const fallbackDeviceRole = asObject(effectiveFallbackConfig.deviceRole);
  const fallbackDeviceRoleSnake = asObject(effectiveFallbackConfig.device_role);
  const fallbackSecurity = asObject(effectiveFallbackConfig.security);
  const fallbackSession = asObject(effectiveFallbackConfig.session);
  const fallbackWorkflowSessionPatch = asObject(asObject(effectiveFallbackConfig.workflow).session);
  const fallbackOffline = asObject(effectiveFallbackConfig.offline);
  const fallbackLan = asObject(effectiveFallbackConfig.lan);
  const fallbackMetadata = asObject(effectiveFallbackConfig.metadata);
  const fallbackLoyalty = asObject(effectiveFallbackConfig.loyalty);

  const tariffs = asArray(resolvedPricing.tariffs)
    .map((item, index) => normalizeTariff(item, index))
    .filter(Boolean) as Tariff[];
  const warehouses = asArray(resolvedInventory.warehouses)
    .map((item, index) => normalizeWarehouse(item, index))
    .filter(Boolean) as Warehouse[];
  const taxes = resolvedTaxes
    .map((item, index) => normalizeTax(item, index))
    .filter(Boolean) as TaxDefinition[];
  const documentSeries = asArray(resolvedDocuments.document_series)
    .map((item, index) => normalizeDocumentSeries(item, index))
    .filter(Boolean) as DocumentSeries[];
  const fiscalRanges = asArray(resolvedDocuments.fiscal_ranges)
    .map((item, index) => normalizeFiscalRange(item, index))
    .filter(Boolean) as FiscalRangeDGII[];
  const fiscalAllocations = asArray(resolvedDocuments.fiscal_allocations)
    .map((item, index) => normalizeFiscalAllocation(item, index, terminalId))
    .filter(Boolean) as FiscalAllocation[];
  const hasIncomingLoyaltyConfig =
    Object.prototype.hasOwnProperty.call(resolvedLoyalty, 'config') ||
    Object.keys(fallbackLoyalty).length > 0;
  const loyaltyConfig = normalizeLoyaltyConfig(
    Object.prototype.hasOwnProperty.call(resolvedLoyalty, 'config')
      ? resolvedLoyalty.config
      : fallbackLoyalty
  );
  const hasIncomingCampaigns =
    Object.prototype.hasOwnProperty.call(resolvedLoyalty, 'campaigns') ||
    Object.prototype.hasOwnProperty.call(effectiveFallbackConfig, 'campaigns');
  const campaignsSource = Object.prototype.hasOwnProperty.call(resolvedLoyalty, 'campaigns')
    ? resolvedLoyalty.campaigns
    : effectiveFallbackConfig.campaigns;
  const campaigns = asArray(campaignsSource)
    .map((item, index) => normalizeCampaign(item, index))
    .filter(Boolean) as Campaign[];
  const hasIncomingCoupons =
    Object.prototype.hasOwnProperty.call(resolvedLoyalty, 'coupons') ||
    Object.prototype.hasOwnProperty.call(effectiveFallbackConfig, 'coupons');
  const couponsSource = Object.prototype.hasOwnProperty.call(resolvedLoyalty, 'coupons')
    ? resolvedLoyalty.coupons
    : effectiveFallbackConfig.coupons;
  const coupons = asArray(couponsSource)
    .map((item, index) => normalizeCoupon(item, index))
    .filter(Boolean) as Coupon[];
  const hasIncomingProductGroups =
    Object.prototype.hasOwnProperty.call(resolvedCatalog, 'product_groups') ||
    Object.prototype.hasOwnProperty.call(resolvedCatalog, 'productGroups') ||
    Object.prototype.hasOwnProperty.call(resolvedCatalog, 'groups') ||
    Object.prototype.hasOwnProperty.call(effectiveFallbackConfig, 'productGroups');
  const productGroupsSource = Object.prototype.hasOwnProperty.call(resolvedCatalog, 'product_groups')
    ? resolvedCatalog.product_groups
    : Object.prototype.hasOwnProperty.call(resolvedCatalog, 'productGroups')
      ? resolvedCatalog.productGroups
    : Object.prototype.hasOwnProperty.call(resolvedCatalog, 'groups')
      ? resolvedCatalog.groups
      : effectiveFallbackConfig.productGroups;
  const productGroups = asArray(productGroupsSource)
    .map((item, index) => normalizeProductGroupFromErpPayload(item, index))
    .filter(Boolean) as ProductGroup[];
  const hasIncomingSeasons =
    Object.prototype.hasOwnProperty.call(resolvedCatalog, 'seasons') ||
    Object.prototype.hasOwnProperty.call(resolvedCatalog, 'seasonality') ||
    Object.prototype.hasOwnProperty.call(effectiveFallbackConfig, 'seasons');
  const seasonsSource = Object.prototype.hasOwnProperty.call(resolvedCatalog, 'seasons')
    ? resolvedCatalog.seasons
    : Object.prototype.hasOwnProperty.call(resolvedCatalog, 'seasonality')
      ? resolvedCatalog.seasonality
      : effectiveFallbackConfig.seasons;
  const seasons = asArray(seasonsSource)
    .map((item, index) => normalizeSeasonFromErpPayload(item, index))
    .filter(Boolean) as Season[];
  const documentAssignments = normalizeAssignments(resolvedDocuments.assignments);

  const terminalTemplate = resolveTerminalTemplate(nextConfig, terminalId);
  const terminalTerminalId =
    asString(resolvedIdentity.terminal_id) ||
    asString(resolvedIdentity.id) ||
    terminalId;
  const rawAllowedTariffIds = asArray<string>(resolvedPricing.allowed_tariff_ids).filter(Boolean);
  const rawAllowedWarehouseIds = asArray<string>(resolvedInventory.allowed_warehouse_ids).filter(Boolean);
  const allowedCategories = asArray<any>(resolvedCatalog.allowed_categories)
    .map((item) => {
      const data = asObject(item);
      return asString(data.id || data.code || item);
    })
    .filter(Boolean);

  const effectiveTariffs = tariffs.length > 0 ? tariffs : nextConfig.tariffs || INITIAL_TARIFFS;
  const effectiveTaxes = taxes.length > 0 ? taxes : nextConfig.taxes || INITIAL_TAXES;
  const allowedTariffIds = rawAllowedTariffIds
    .map((value) => resolveTariffId(value, effectiveTariffs))
    .filter(Boolean);
  const effectiveAllowedTariffIds =
    allowedTariffIds.length > 0
      ? allowedTariffIds
      : effectiveTariffs.map((tariff) => tariff.id);
  const effectiveDefaultTariffId =
    resolveTariffId(asString(resolvedPricing.default_tariff_id), effectiveTariffs) ||
    effectiveAllowedTariffIds[0] ||
    effectiveTariffs[0]?.id ||
    '';

  const effectiveWarehouses = warehouses.length > 0 ? warehouses : terminalTemplate.inventoryScope?.warehouses || [];
  const allowedWarehouseIds = rawAllowedWarehouseIds
    .map((value) => resolveWarehouseId(value, effectiveWarehouses))
    .filter(Boolean);
  const effectiveAllowedWarehouseIds =
    allowedWarehouseIds.length > 0
      ? allowedWarehouseIds
      : effectiveWarehouses.map((warehouse) => warehouse.id);
  const effectiveDefaultWarehouseId =
    resolveWarehouseId(asString(resolvedInventory.default_warehouse_id), effectiveWarehouses) ||
    effectiveAllowedWarehouseIds[0] ||
    '';
  const effectiveDeviceRole = resolveDeviceRoleValue([
    fallbackDeviceRole.role,
    fallbackDeviceRole.device_role,
    fallbackDeviceRole.deviceRole,
    fallbackDeviceRole.role_code,
    fallbackDeviceRole.device_role_code,
    fallbackDeviceRoleSnake.role,
    fallbackDeviceRoleSnake.device_role,
    fallbackDeviceRoleSnake.deviceRole,
    fallbackDeviceRoleSnake.role_code,
    fallbackDeviceRoleSnake.device_role_code,
    effectiveFallbackConfig.deviceRole,
    effectiveFallbackConfig.device_role,
    effectiveResolved.deviceRole,
    effectiveResolved.device_role,
    resolvedIdentity.deviceRole,
    resolvedIdentity.device_role,
    resolvedIdentity.role_code,
    resolvedIdentity.device_role_code,
    effectiveResolved.role_code,
    effectiveResolved.device_role_code,
    effectiveFallbackConfig.role_code,
    effectiveFallbackConfig.device_role_code,
    resolvedIdentity.role,
    effectiveResolved.role,
    effectiveFallbackConfig.role,
    terminalTemplate.deviceRole?.role,
  ], terminalTemplate.deviceRole?.role || DeviceRole.STANDARD_POS);
  const deviceRoleDefaults = getDefaultRoleConfig(effectiveDeviceRole);
  const templateDeviceRole = terminalTemplate.deviceRole;
  const deviceRoleChanged = Boolean(templateDeviceRole?.role) && templateDeviceRole.role !== effectiveDeviceRole;
  const templateDeviceRoleUi = !deviceRoleChanged ? asObject(templateDeviceRole?.uiSettings) : {};
  const templateDeviceRoleHardware = !deviceRoleChanged ? asObject(templateDeviceRole?.hardwareConfig) : {};
  const fallbackAllowedModules = asArray<string>(fallbackDeviceRole.allowedModules);
  const fallbackAllowedModulesSnake = asArray<string>(fallbackDeviceRoleSnake.allowedModules);
  const fallbackAuthLevel = fallbackDeviceRole.authLevel || fallbackDeviceRoleSnake.authLevel;
  const effectiveAuthLevel =
    deviceRoleChanged && deviceRoleDefaults.authLevel === 'HEADLESS' && fallbackAuthLevel === 'USER_REQUIRED'
      ? deviceRoleDefaults.authLevel
      : fallbackAuthLevel ||
        (!deviceRoleChanged ? terminalTemplate.deviceRole?.authLevel : undefined) ||
        deviceRoleDefaults.authLevel;

  const effectiveDocumentSeries = mergeDocumentSeriesCollection(
    documentSeries.length > 0 ? documentSeries : terminalTemplate.documentSeries || DEFAULT_DOCUMENT_SERIES
  );
  const effectiveFiscalRanges = fiscalRanges.length > 0 ? fiscalRanges : terminalTemplate.fiscal.fiscalRanges || [];
  const effectiveFiscalAllocations = hasIncomingFiscalAllocations
    ? fiscalAllocations
    : terminalTemplate.fiscal.fiscalAllocations || [];
  const fallbackAssignments = terminalTemplate.documentAssignments || {};
  const requestedAssignments =
    Object.keys(documentAssignments).length > 0
      ? { ...fallbackAssignments, ...documentAssignments }
      : fallbackAssignments;
  const effectiveDocumentAssignments = Object.keys(requestedAssignments).reduce<Record<string, string>>((acc, key) => {
    const resolvedId = resolveDocumentAssignmentId(
      key,
      effectiveDocumentSeries,
      requestedAssignments[key]
    );
    if (resolvedId) {
      acc[key] = resolvedId;
    }
    return acc;
  }, {});

  const nextTerminalConfig: TerminalConfig = {
    ...terminalTemplate,
    currentDeviceId: posDeviceId || terminalTemplate.currentDeviceId,
    isPrimaryNode: bindingMode ? bindingMode === 'MASTER' : terminalTemplate.isPrimaryNode,
    governedByMaster: bindingMode ? bindingMode === 'SLAVE' : terminalTemplate.governedByMaster,
    terminalName:
      asString(resolvedIdentity.terminal_name) ||
      terminalTemplate.terminalName ||
      terminalTerminalId,
    stationNumber:
      normalizeStationNumber(resolvedIdentity.station_number) ||
      terminalTemplate.stationNumber ||
      null,
    deviceRole: {
      ...deviceRoleDefaults,
      ...(deviceRoleChanged ? {} : terminalTemplate.deviceRole || {}),
      role: effectiveDeviceRole,
      authLevel: effectiveAuthLevel,
      uiSettings: {
        ...deviceRoleDefaults.uiSettings,
        ...templateDeviceRoleUi,
        ...asObject(fallbackDeviceRole.uiSettings),
        ...asObject(fallbackDeviceRoleSnake.uiSettings),
      },
      hardwareConfig: {
        ...deviceRoleDefaults.hardwareConfig,
        ...templateDeviceRoleHardware,
        ...asObject(fallbackDeviceRole.hardwareConfig),
        ...asObject(fallbackDeviceRoleSnake.hardwareConfig),
      },
      allowedModules:
        fallbackAllowedModules.length > 0
          ? fallbackAllowedModules
          : fallbackAllowedModulesSnake.length > 0
            ? fallbackAllowedModulesSnake
            : (!deviceRoleChanged ? terminalTemplate.deviceRole?.allowedModules : undefined) || deviceRoleDefaults.allowedModules,
      apiToken:
        asString(fallbackDeviceRole.apiToken) ||
        asString(fallbackDeviceRoleSnake.apiToken) ||
        terminalTemplate.deviceRole?.apiToken,
      defaultRoute:
        asString(fallbackDeviceRole.defaultRoute) ||
        asString(fallbackDeviceRoleSnake.defaultRoute) ||
        (!deviceRoleChanged ? terminalTemplate.deviceRole?.defaultRoute : undefined) ||
        deviceRoleDefaults.defaultRoute,
    },
    fiscal: {
      ...terminalTemplate.fiscal,
      defaultFiscalRangeId:
        asString(resolvedDocuments.default_fiscal_range_id) ||
        terminalTemplate.fiscal.defaultFiscalRangeId,
      fiscalRanges: effectiveFiscalRanges,
      fiscalAllocations: effectiveFiscalAllocations,
    },
    pricing: {
      ...terminalTemplate.pricing,
      defaultTariffId: effectiveDefaultTariffId,
      allowedTariffIds: effectiveAllowedTariffIds,
      tariffs: effectiveTariffs,
    },
    documentSeries: effectiveDocumentSeries,
    documentAssignments:
      Object.keys(effectiveDocumentAssignments).length > 0
        ? effectiveDocumentAssignments
        : terminalTemplate.documentAssignments,
    inventoryScope: {
      ...terminalTemplate.inventoryScope,
      defaultSalesWarehouseId: effectiveDefaultWarehouseId,
      visibleWarehouseIds: effectiveAllowedWarehouseIds,
      transferWarehouseId:
        asString(resolvedInventory.transfer_warehouse_id) ||
        terminalTemplate.inventoryScope?.transferWarehouseId,
      defaultWarehouse:
        Object.keys(asObject(resolvedInventory.default_warehouse)).length > 0
          ? normalizeWarehouse(resolvedInventory.default_warehouse, 0)
          : effectiveWarehouses.find((warehouse) => warehouse.id === effectiveDefaultWarehouseId),
      warehouses: effectiveWarehouses,
    },
    catalog: {
      ...(terminalTemplate.catalog || { allowedCategories: [] }),
      // If ERP does not send category restrictions, treat it as unrestricted
      // instead of inheriting stale local categories from a prior binding.
      allowedCategories,
      fullPullOnPairing:
        typeof resolvedCatalog.full_pull_on_pairing === 'boolean'
          ? Boolean(resolvedCatalog.full_pull_on_pairing)
          : terminalTemplate.catalog?.fullPullOnPairing,
    },
    operational: {
      ...terminalTemplate.operational,
      ...fallbackOperational,
    },
    security: (() => {
      const erpAutoLock = Number(fallbackSession.autoLockMinutes);
      const fromErpLock =
        Number.isFinite(erpAutoLock) && erpAutoLock > 0 ? { autoLogoutMinutes: erpAutoLock } : {};
      return {
        ...terminalTemplate.security,
        ...fallbackSecurity,
        ...fromErpLock,
      };
    })(),
    workflow: {
      ...terminalTemplate.workflow,
      session: mergeWorkflowSessionFromErpConfig(
        terminalTemplate.workflow?.session || DEFAULT_TERMINAL_CONFIG.workflow.session,
        fallbackSession,
        fallbackWorkflowSessionPatch
      ),
      offline: {
        ...terminalTemplate.workflow.offline,
        ...fallbackOffline,
      },
    },
    erpBinding: {
      ...(terminalTemplate.erpBinding || {}),
      terminalId: terminalTerminalId,
      tenantId: asString(resolvedIdentity.tenant_id) || terminalTemplate.erpBinding?.tenantId,
      companyId: asString(resolvedIdentity.company_id) || terminalTemplate.erpBinding?.companyId,
      storeId: asString(resolvedIdentity.store_id) || terminalTemplate.erpBinding?.storeId,
      deviceId: asString(resolvedIdentity.device_id) || posDeviceId || terminalTemplate.erpBinding?.deviceId,
      terminalName:
        asString(resolvedIdentity.terminal_name) ||
        terminalTemplate.erpBinding?.terminalName ||
        terminalTerminalId,
      stationNumber:
        normalizeStationNumber(resolvedIdentity.station_number) ||
        terminalTemplate.erpBinding?.stationNumber,
      role:
        asString(
          resolvedIdentity.role ??
          resolvedIdentity.device_role ??
          resolvedIdentity.deviceRole ??
          resolvedIdentity.role_code ??
          resolvedIdentity.device_role_code ??
          effectiveResolved.role ??
          effectiveResolved.device_role ??
          effectiveResolved.deviceRole ??
          effectiveResolved.role_code ??
          effectiveResolved.device_role_code
        ) ||
        terminalTemplate.erpBinding?.role,
    },
    erpSnapshot: effectiveSnapshot || undefined,
    metadata: {
      ...(terminalTemplate.metadata || {}),
      ...fallbackMetadata,
    },
    lan: {
      ...(terminalTemplate.lan || {}),
      ...fallbackLan,
    },
  };

  if (nextTerminalConfig.workflow?.session?.allowPartialXReport === false && nextTerminalConfig.documentAssignments) {
    const prunedAssignments = { ...nextTerminalConfig.documentAssignments };
    delete prunedAssignments.X_REPORT;
    nextTerminalConfig.documentAssignments = prunedAssignments;
  }

  nextConfig.terminals = (nextConfig.terminals || []).map((terminal) => {
    if (terminal.id !== terminalId) return terminal;
    return {
      ...terminal,
      id: terminalId,
      config: nextTerminalConfig,
    };
  });

  if (!nextConfig.terminals.some((terminal) => terminal.id === terminalId)) {
    nextConfig.terminals = [
      ...(nextConfig.terminals || []),
      {
        id: terminalId,
        config: nextTerminalConfig,
      },
    ];
  }

  nextConfig.tariffs = effectiveTariffs;
  nextConfig.taxes = effectiveTaxes;
  nextConfig.inventoryScope = {
    ...(nextConfig.inventoryScope || {}),
    defaultSalesWarehouseId: effectiveDefaultWarehouseId,
    visibleWarehouseIds: effectiveAllowedWarehouseIds,
  };

  if (hasIncomingLoyaltyConfig) {
    nextConfig.loyalty = loyaltyConfig || nextConfig.loyalty;
  }

  if (hasIncomingCampaigns) {
    nextConfig.campaigns = campaigns;
  }

  if (hasIncomingCoupons) {
    nextConfig.coupons = coupons;
  }

  if (hasIncomingProductGroups) {
    nextConfig.productGroups = productGroups;
  }

  if (hasIncomingSeasons) {
    nextConfig.seasons = seasons;
  }

  if (!hasResolutionError && Object.prototype.hasOwnProperty.call(effectiveResolved, 'promotions')) {
    nextConfig.promotions = asArray(effectiveResolved.promotions)
      .map((item) => normalizePromotionFromErpPayload(item))
      .filter((p): p is Promotion => Boolean(p));
  }

  nextConfig.terminalSnapshots = {
    ...(nextConfig.terminalSnapshots || {}),
    ...(effectiveSnapshot ? { [terminalId]: effectiveSnapshot } : {}),
  };

  return {
    config: nextConfig,
    terminalId,
    snapshot: effectiveSnapshot,
    snapshotSource,
    usedResolved: snapshotSource === 'resolved' || snapshotSource === 'cached_snapshot',
    usedFallbackConfig: snapshotSource === 'fallback_config',
    usedCachedSnapshot: snapshotSource === 'cached_snapshot',
    hasResolutionError,
    fullPullOnPairing:
      typeof resolvedCatalog.full_pull_on_pairing === 'boolean'
        ? Boolean(resolvedCatalog.full_pull_on_pairing)
        : nextTerminalConfig.catalog?.fullPullOnPairing,
  };
};

export const extractTerminalOperationalDocumentState = (
  config: BusinessConfig,
  terminalId: string
): TerminalOperationalDocumentState => {
  const terminalTemplate = resolveTerminalTemplate(config, terminalId);

  return {
    terminalId,
    documentSeries: cloneDeep(terminalTemplate.documentSeries || []),
    fiscalRanges: cloneDeep(terminalTemplate.fiscal?.fiscalRanges || []),
    fiscalAllocations: cloneDeep(terminalTemplate.fiscal?.fiscalAllocations || []),
  };
};
