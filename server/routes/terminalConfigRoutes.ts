import express from 'express';
import { createHash } from 'node:crypto';
import { getSetting, saveSetting } from '../db';
import { applyTerminalConfigSnapshot, extractTerminalConfigSnapshot } from '../../utils/terminalConfigSnapshot';
import { TerminalConfigSnapshot } from '../../types';
import { persistOperationalDocumentState } from '../services/terminalOperationalState';

const router = express.Router();

const REQUEST_TIMEOUT_MS = 12000;

const asObject = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, any>;
};

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const asStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((entry) => asString(entry)).filter(Boolean);
  }

  const raw = asString(value);
  if (!raw) return [];
  return raw.split(',').map((entry) => asString(entry)).filter(Boolean);
};

const stripTrailingSlashes = (value: string): string => value.replace(/\/+$/, '');

const stripApiSuffix = (value: string): string => {
  return value
    .replace(/\/api\/sync\/?$/i, '')
    .replace(/\/api\/?$/i, '');
};

const normalizeBaseUrl = (value?: string | null): string | null => {
  const raw = asString(value);
  if (!raw) return null;

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    const url = new URL(withProtocol);
    return stripTrailingSlashes(stripApiSuffix(url.toString()));
  } catch {
    return null;
  }
};

const withTimeout = async <T>(promise: Promise<T>, label: string): Promise<T> => {
  let timeoutId: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${REQUEST_TIMEOUT_MS}ms`)), REQUEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const resolveStoredErpContext = (): Record<string, any> => asObject(getSetting('erp_setup_context'));

const resolveTenantId = (req: express.Request): string | null => {
  const queryTenantId = asString(req.query.tenant_id);
  const headerTenantId = asString(req.headers['x-tenant-id']);
  const storedTenantId =
    asString(resolveStoredErpContext().tenantId) ||
    asString(getSetting('active_tenant_id')) ||
    asString(getSetting('tenant_id'));

  return storedTenantId || queryTenantId || headerTenantId || null;
};

const resolveTenantSlug = (req: express.Request): string | null => {
  const querySlug = asString(req.query.tenant_slug);
  const headerSlug = asString(req.headers['x-tenant-slug']);
  const storedSlug = asString(resolveStoredErpContext().tenantSlug);

  return storedSlug || querySlug || headerSlug || null;
};

const resolveTenantEmail = (req: express.Request): string | null => {
  const queryEmail = asString(req.query.tenant_email).toLowerCase();
  const headerEmail = asString(req.headers['x-tenant-email']).toLowerCase();
  const storedEmail = asString(resolveStoredErpContext().tenantEmail).toLowerCase();

  return storedEmail || queryEmail || headerEmail || null;
};

const resolveErpBaseUrl = (req: express.Request): string | null => {
  const queryBase = normalizeBaseUrl(asString(req.query.erp_base_url));
  const storedContextBase = normalizeBaseUrl(asString(resolveStoredErpContext().erpBaseUrl));
  const syncMetadata = asObject(getSetting('syncMetadata'));
  const storedMetadataBase =
    normalizeBaseUrl(asString(syncMetadata.erpBaseUrl)) ||
    normalizeBaseUrl(asString(syncMetadata.syncApiUrl)) ||
    normalizeBaseUrl(asString(syncMetadata.masterSyncUrl));

  return queryBase || storedContextBase || storedMetadataBase || null;
};

const buildErpHeaders = (req: express.Request, tenantId: string | null): HeadersInit => {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  const authorization = asString(req.headers.authorization);
  const cookie = asString(req.headers.cookie);

  if (authorization) headers.Authorization = authorization;
  if (cookie) headers.Cookie = cookie;
  if (tenantId) headers['X-Tenant-Id'] = tenantId;

  return headers;
};

const fetchErpJson = async (req: express.Request, baseUrl: string, path: string, tenantId: string) => {
  const url = `${stripTrailingSlashes(baseUrl)}${path}`;
  const response = await withTimeout(
    fetch(url, {
      method: 'GET',
      headers: buildErpHeaders(req, tenantId),
    }),
    `ERP request ${path}`
  );

  const text = await response.text();
  let payload: any = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const message =
      asString(asObject(payload).message) ||
      asString(asObject(payload).error) ||
      `${response.status} ${response.statusText}`.trim();
    throw new Error(`ERP ${path}: ${message}`);
  }

  return payload;
};

const normalizeTenantKey = (value: unknown): string => {
  return asString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
};

const fetchErpTenants = async (req: express.Request, baseUrl: string, tenantId: string) => {
  const payload = await fetchErpJson(req, baseUrl, '/api/sync/tenants', tenantId);
  return Array.isArray(payload?.tenants) ? payload.tenants : [];
};

const findMappedErpTenant = (
  tenants: any[],
  identity: {
    tenantId?: string | null;
    tenantSlug?: string | null;
  }
) => {
  const cloudTenantId = asString(identity.tenantId);
  const tenantSlug = normalizeTenantKey(identity.tenantSlug);

  return (
    tenants.find((tenant) => asString(asObject(tenant?.activation).cloud_admin_tenant_id) === cloudTenantId)
    || (tenantSlug
      ? tenants.find((tenant) => normalizeTenantKey(tenant?.company_ref) === tenantSlug)
        || tenants.find((tenant) => normalizeTenantKey(tenant?.name) === tenantSlug)
      : null)
    || null
  );
};

const bootstrapErpTenant = async (
  req: express.Request,
  baseUrl: string,
  identity: {
    tenantId?: string | null;
    tenantSlug?: string | null;
    tenantEmail?: string | null;
    deviceId?: string | null;
  }
) => {
  const response = await withTimeout(
    fetch(`${stripTrailingSlashes(baseUrl)}/api/sync/bootstrap/check`, {
      method: 'POST',
      headers: {
        ...buildErpHeaders(req, asString(identity.tenantId)),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tenant_id: identity.tenantId || null,
        company_ref: identity.tenantSlug || null,
        email: identity.tenantEmail || null,
        device_id: identity.deviceId || null,
      }),
    }),
    'ERP bootstrap check'
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      asString(asObject(payload).message) ||
      asString(asObject(payload).error) ||
      `${response.status} ${response.statusText}`.trim();
    throw new Error(`ERP bootstrap: ${detail}`);
  }

  return payload;
};

const resolveErpTenantId = async (
  req: express.Request,
  baseUrl: string,
  identity: {
    tenantId?: string | null;
    tenantSlug?: string | null;
    tenantEmail?: string | null;
    deviceId?: string | null;
  }
): Promise<{ tenantId: string | null; source: string }> => {
  const storedTenantId = asString(resolveStoredErpContext().tenantId) || asString(getSetting('active_tenant_id'));
  if (storedTenantId) {
    return { tenantId: storedTenantId, source: 'STORED_CONTEXT' };
  }

  try {
    const bootstrap = await bootstrapErpTenant(req, baseUrl, identity);
    const bootstrapTenantId =
      asString(bootstrap?.tenant?.id) ||
      asString(bootstrap?.activation?.tenant_id) ||
      null;

    if (bootstrapTenantId) {
      return { tenantId: bootstrapTenantId, source: 'ERP_BOOTSTRAP' };
    }
  } catch (error) {
    console.warn('⚠️ Terminal config bootstrap tenant lookup failed:', error);
  }

  try {
    const fallbackTenantId = asString(identity.tenantId) || 'default-tenant';
    const tenants = await fetchErpTenants(req, baseUrl, fallbackTenantId);
    const mappedTenant = findMappedErpTenant(tenants, identity);
    if (mappedTenant) {
      return { tenantId: asString(mappedTenant?.id) || null, source: 'ERP_TENANT_DIRECTORY' };
    }
  } catch (error) {
    console.warn('⚠️ Terminal config tenant directory lookup failed:', error);
  }

  return { tenantId: asString(identity.tenantId) || null, source: 'REQUEST_FALLBACK' };
};

const getSnapshotCache = (): Record<string, TerminalConfigSnapshot> => {
  return asObject(getSetting('terminal_snapshot_cache')) as Record<string, TerminalConfigSnapshot>;
};

const getCachedTerminalSnapshot = (terminalId: string): TerminalConfigSnapshot | null => {
  const cache = getSnapshotCache();
  const snapshot = asObject(cache[terminalId]);
  return Object.keys(snapshot).length > 0 ? (snapshot as TerminalConfigSnapshot) : null;
};

const saveCachedTerminalSnapshot = (terminalId: string, snapshot: TerminalConfigSnapshot | null | undefined) => {
  if (!snapshot) return;
  const resolved = asObject(snapshot.resolved);
  if (Object.keys(resolved).length === 0) return;
  const cache = getSnapshotCache();
  cache[terminalId] = snapshot;
  saveSetting('terminal_snapshot_cache', cache);
};

const stableSerialize = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`;
  }

  return JSON.stringify(value ?? null);
};

type SnapshotMasterCollectionKey = 'items' | 'customers' | 'suppliers';
const SNAPSHOT_MASTER_COLLECTIONS: SnapshotMasterCollectionKey[] = ['items', 'customers', 'suppliers'];

const normalizeCatalogItemSignature = (item: Record<string, any>) => ({
  id: asString(item.id),
  sku: asString(item.sku),
  item_code: asString(item.item_code),
  code: asString(item.code),
  barcode: asString(item.barcode),
  name: asString(item.name),
  description: asString(item.description || item.descripcion),
  category: asString(item.category || item.categoria),
  type: asString(item.type),
  price: item.price ?? null,
  cost: item.cost ?? null,
  taxable: item.taxable ?? null,
  tax_ids: Array.isArray(item.tax_ids) ? item.tax_ids : [],
  warehouse_ids: Array.isArray(item.warehouse_ids) ? item.warehouse_ids : [],
  variants: Array.isArray(item.variants) ? item.variants : [],
  is_inventoriable: item.is_inventoriable ?? item.isInventoriable ?? null,
  image_url: asString(item.image_url || item.imageUrl || item.metadata?.image_url || item.metadata?.imageUrl),
  image_version: asString(item.image_version || item.imageVersion || item.metadata?.image_version),
  updated_at: asString(item.updated_at || item.updatedAt),
});

const normalizeCustomerSignature = (item: Record<string, any>) => ({
  id: asString(item.id),
  name: asString(item.name),
  phone: asString(item.phone),
  email: asString(item.email).toLowerCase(),
  taxId: asString(item.taxId || item.tax_id || item.rnc),
  address: asString(item.address),
  notes: asString(item.notes),
  loyaltyPoints: item.loyaltyPoints ?? item.loyalty_points ?? null,
  creditLimit: item.creditLimit ?? item.credit_limit ?? null,
  currentDebt: item.currentDebt ?? item.current_debt ?? null,
  tier: asString(item.tier),
  tags: Array.isArray(item.tags) ? item.tags : [],
  addresses: Array.isArray(item.addresses) ? item.addresses : [],
  wallet: asObject(item.wallet),
  cards: Array.isArray(item.cards) ? item.cards : [],
  loyalty: asObject(item.loyalty),
  requiresFiscalInvoice: item.requiresFiscalInvoice ?? item.requires_fiscal_invoice ?? null,
  prefersEmail: item.prefersEmail ?? item.prefers_email ?? null,
  isTaxExempt: item.isTaxExempt ?? item.is_tax_exempt ?? null,
  applyChainedTax: item.applyChainedTax ?? item.apply_chained_tax ?? null,
  creditDays: item.creditDays ?? item.credit_days ?? null,
  defaultNcfType: asString(item.defaultNcfType || item.default_ncf_type),
  image_url: asString(
    item.image_url || item.imageUrl || item.photo_url || item.photoUrl || item.avatar_url || item.avatarUrl
  ),
  image_version: asString(
    item.image_version || item.imageVersion || item.photo_version || item.photoVersion || item.avatar_version || item.avatarVersion
  ),
  updated_at: asString(item.updated_at || item.updatedAt),
});

const normalizeSupplierSignature = (item: Record<string, any>) => ({
  id: asString(item.id),
  name: asString(item.name),
  taxId: asString(item.taxId || item.tax_id || item.rnc),
  email: asString(item.email).toLowerCase(),
  phone: asString(item.phone),
  contactPerson: asString(item.contactPerson || item.contact_person),
  paymentMethod: asString(item.paymentMethod || item.payment_method),
  paymentTermDays: item.paymentTermDays ?? item.payment_term_days ?? null,
  creditLimit: item.creditLimit ?? item.credit_limit ?? null,
  balance: item.balance ?? null,
  leadTimeDays: item.leadTimeDays ?? item.lead_time_days ?? null,
  isActive: item.isActive ?? item.is_active ?? null,
  image_url: asString(item.image_url || item.imageUrl || item.logo_url || item.logoUrl || item.photo_url || item.photoUrl),
  image_version: asString(item.image_version || item.imageVersion || item.logo_version || item.logoVersion || item.photo_version || item.photoVersion),
  updated_at: asString(item.updated_at || item.updatedAt),
});

const snapshotHasMasterCollection = (
  snapshot: TerminalConfigSnapshot | null | undefined,
  key: SnapshotMasterCollectionKey
): boolean => {
  const masters = asObject(asObject(snapshot).masters);
  return Object.prototype.hasOwnProperty.call(masters, key);
};

const snapshotMasterCollection = (
  snapshot: TerminalConfigSnapshot | null | undefined,
  key: SnapshotMasterCollectionKey
): Record<string, any>[] => {
  const masters = asObject(snapshot).masters;
  return Array.isArray(asObject(masters)[key])
    ? (asObject(masters)[key] as Record<string, any>[])
    : [];
};

const normalizeMasterSignature = (
  key: SnapshotMasterCollectionKey,
  item: Record<string, any>
): Record<string, unknown> => {
  switch (key) {
    case 'customers':
      return normalizeCustomerSignature(item);
    case 'suppliers':
      return normalizeSupplierSignature(item);
    case 'items':
    default:
      return normalizeCatalogItemSignature(item);
  }
};

const buildMasterIdentity = (key: SnapshotMasterCollectionKey, item: Record<string, any>): string => {
  const candidates = key === 'items'
    ? [
      asString(item.id),
      asString(item.sku),
      asString(item.item_code),
      asString(item.code),
      asString(item.barcode),
    ]
    : [
      asString(item.id),
      asString(item.taxId || item.tax_id || item.rnc),
      asString(item.email).toLowerCase(),
      asString(item.phone),
      asString(item.name),
    ];

  return candidates.filter(Boolean)[0] || stableSerialize(normalizeMasterSignature(key, item));
};

const buildMasterDeletePayload = (key: SnapshotMasterCollectionKey, item: Record<string, any>) => {
  if (key === 'items') {
    return {
      id: asString(item.id),
      sku: asString(item.sku),
      item_code: asString(item.item_code),
      code: asString(item.code),
      barcode: asString(item.barcode),
    };
  }

  return {
    id: asString(item.id),
    taxId: asString(item.taxId || item.tax_id || item.rnc),
    email: asString(item.email).toLowerCase(),
    phone: asString(item.phone),
    name: asString(item.name),
  };
};

const cloneSnapshotWithoutMasterCollections = (snapshot: TerminalConfigSnapshot): TerminalConfigSnapshot => {
  const masters = asObject(asObject(snapshot).masters);
  const nextMasters = { ...masters };

  for (const key of SNAPSHOT_MASTER_COLLECTIONS) {
    if (Object.prototype.hasOwnProperty.call(nextMasters, key)) {
      nextMasters[key] = [];
    }
  }

  return {
    ...snapshot,
    masters: nextMasters,
  } as TerminalConfigSnapshot;
};

const mergeTerminalConfigSnapshots = (
  cachedSnapshot: TerminalConfigSnapshot | null | undefined,
  incomingSnapshot: TerminalConfigSnapshot | null | undefined,
): TerminalConfigSnapshot | null => {
  if (!incomingSnapshot) {
    return cachedSnapshot || null;
  }

  if (!cachedSnapshot) {
    return incomingSnapshot;
  }

  const mergedMasters = {
    ...asObject(cachedSnapshot.masters),
  };
  const incomingMasters = asObject(incomingSnapshot.masters);
  for (const key of Object.keys(incomingMasters)) {
    mergedMasters[key] = incomingMasters[key];
  }

  const mergedResolved = {
    ...asObject(cachedSnapshot.resolved),
  };
  const incomingResolved = asObject(incomingSnapshot.resolved);
  for (const key of Object.keys(incomingResolved)) {
    mergedResolved[key] = incomingResolved[key];
  }

  return {
    ...cachedSnapshot,
    ...incomingSnapshot,
    config: {
      ...asObject(cachedSnapshot.config),
      ...asObject(incomingSnapshot.config),
    },
    masters: mergedMasters,
    resolved: mergedResolved,
  } as TerminalConfigSnapshot;
};

const computeCatalogCursor = (snapshot: TerminalConfigSnapshot | null | undefined): string => {
  const masterData = SNAPSHOT_MASTER_COLLECTIONS.reduce<Record<string, Record<string, unknown>[]>>((acc, key) => {
    acc[key] = snapshotMasterCollection(snapshot, key)
      .map((item) => normalizeMasterSignature(key, asObject(item)))
      .sort((a, b) => buildMasterIdentity(key, a as Record<string, any>).localeCompare(buildMasterIdentity(key, b as Record<string, any>)));
    return acc;
  }, {});
  const resolved = asObject(snapshot?.resolved);
  const relevantResolved = {
    pricing: asObject(resolved.pricing),
    catalog: asObject(resolved.catalog),
    inventory: asObject(resolved.inventory),
  };

  return createHash('sha1')
    .update(stableSerialize({
      masters: masterData,
      resolved: relevantResolved,
    }))
    .digest('hex');
};

const buildCatalogDelta = (
  previousSnapshot: TerminalConfigSnapshot | null | undefined,
  nextSnapshot: TerminalConfigSnapshot | null | undefined,
) => {
  return SNAPSHOT_MASTER_COLLECTIONS.reduce<Record<string, any>>((acc, key) => {
    if (!snapshotHasMasterCollection(previousSnapshot, key) && !snapshotHasMasterCollection(nextSnapshot, key)) {
      return acc;
    }

    const previousItems = snapshotMasterCollection(previousSnapshot, key);
    const nextItems = snapshotMasterCollection(nextSnapshot, key);

    const previousMap = new Map<string, Record<string, any>>();
    const nextMap = new Map<string, Record<string, any>>();

    for (const item of previousItems) {
      previousMap.set(buildMasterIdentity(key, asObject(item)), asObject(item));
    }
    for (const item of nextItems) {
      nextMap.set(buildMasterIdentity(key, asObject(item)), asObject(item));
    }

    const upsertKey = `${key}_upsert`;
    const deleteKey = `${key}_delete`;
    const upsertRows: Record<string, any>[] = [];
    const deleteRows: Array<Record<string, any>> = [];

    for (const [identity, nextItem] of nextMap.entries()) {
      const previousItem = previousMap.get(identity);
      if (!previousItem || stableSerialize(normalizeMasterSignature(key, previousItem)) !== stableSerialize(normalizeMasterSignature(key, nextItem))) {
        upsertRows.push(nextItem);
      }
    }

    for (const [identity, previousItem] of previousMap.entries()) {
      if (!nextMap.has(identity)) {
        deleteRows.push(buildMasterDeletePayload(key, previousItem));
      }
    }

    acc[upsertKey] = upsertRows;
    acc[deleteKey] = deleteRows;
    return acc;
  }, {});
};

router.get('/:terminalId/config', async (req, res) => {
  const config = getSetting('config');
  const erpTerminalId = asString(req.params.terminalId);
  const localTerminalId = asString(req.query.local_terminal_id) || erpTerminalId;
  const tenantId = resolveTenantId(req);
  const tenantSlug = resolveTenantSlug(req);
  const tenantEmail = resolveTenantEmail(req);
  const erpBaseUrl = resolveErpBaseUrl(req);
  const posDeviceId = asString(req.query.pos_device_id);
  const clientCatalogCursor = asString(req.query.catalog_cursor);
  const requestedMasterScopes = asStringArray(req.query.master_scopes);
  const requestedResolvedScopes = asStringArray(req.query.resolved_scopes);

  if (!erpTerminalId) {
    return res.status(400).json({ status: 'error', message: 'terminalId es obligatorio.' });
  }

  if (!tenantId || !erpBaseUrl) {
    return res.status(400).json({
      status: 'error',
      message: 'tenant_id y erp_base_url son obligatorios para refrescar la terminal.',
    });
  }

  try {
    const resolvedTenant = await resolveErpTenantId(req, erpBaseUrl, {
      tenantId,
      tenantSlug,
      tenantEmail,
      deviceId: posDeviceId,
    });
    const effectiveTenantId = resolvedTenant.tenantId || tenantId;
    const params = new URLSearchParams();
    params.set('tenant_id', effectiveTenantId);
    if (requestedMasterScopes.length > 0) {
      params.set('master_scopes', requestedMasterScopes.join(','));
    }
    if (Array.isArray(req.query.resolved_scopes)) {
      params.set('resolved_scopes', requestedResolvedScopes.length > 0 ? requestedResolvedScopes.join(',') : 'none');
    } else if (typeof req.query.resolved_scopes === 'string') {
      params.set('resolved_scopes', requestedResolvedScopes.length > 0 ? requestedResolvedScopes.join(',') : 'none');
    }

    const snapshotPayload = await fetchErpJson(
      req,
      erpBaseUrl,
      `/api/sync/terminals/${encodeURIComponent(erpTerminalId)}/config?${params.toString()}`,
      effectiveTenantId
    );
    const incomingSnapshot = extractTerminalConfigSnapshot(snapshotPayload);
    if (!incomingSnapshot) {
      throw new Error('El ERP no devolvió terminal_config para el refresco.');
    }

    const cachedSnapshot = getCachedTerminalSnapshot(localTerminalId);
    const snapshot = mergeTerminalConfigSnapshots(cachedSnapshot, incomingSnapshot);
    if (!snapshot) {
      throw new Error('No se pudo reconstruir el snapshot efectivo de la terminal.');
    }
    const previousCatalogCursor = computeCatalogCursor(cachedSnapshot);
    const applied = applyTerminalConfigSnapshot(config, {
      terminalId: localTerminalId,
      posDeviceId,
      incomingSnapshot: snapshot,
      cachedSnapshot,
    });

    if (applied.snapshot && !applied.hasResolutionError && Object.keys(asObject(applied.snapshot.resolved)).length > 0) {
      saveCachedTerminalSnapshot(localTerminalId, snapshot);
    }

    saveSetting('config', applied.config);
    persistOperationalDocumentState(applied.config, applied.terminalId);
    saveSetting('active_tenant_id', asString(snapshot.tenant_id) || effectiveTenantId);
    saveSetting('erp_setup_context', {
      ...resolveStoredErpContext(),
      tenantId: asString(snapshot.tenant_id) || effectiveTenantId,
      tenantSlug,
      tenantEmail,
      erpBaseUrl,
      lastResolvedAt: new Date().toISOString(),
    });

    const currentCatalogCursor = computeCatalogCursor(snapshot);
    const canUseCatalogDelta =
      Boolean(clientCatalogCursor) &&
      Boolean(previousCatalogCursor) &&
      clientCatalogCursor === previousCatalogCursor;
    const catalogDelta = canUseCatalogDelta ? buildCatalogDelta(cachedSnapshot, snapshot) : null;
    const useCatalogDelta = canUseCatalogDelta;
    const responseSnapshot = useCatalogDelta ? cloneSnapshotWithoutMasterCollections(snapshot) : snapshot;

    return res.json({
      success: true,
      source: applied.snapshotSource,
      tenant_id: asString(snapshot.tenant_id) || effectiveTenantId,
      terminal_id: applied.terminalId,
      erp_terminal_id: erpTerminalId,
      tenant_resolution_source: resolvedTenant.source,
      terminal_config: responseSnapshot,
      config: applied.config,
      catalog_delta: useCatalogDelta ? {
        mode: 'DELTA',
        items_upsert: catalogDelta?.items_upsert || [],
        items_delete: catalogDelta?.items_delete || [],
        ...(Object.prototype.hasOwnProperty.call(catalogDelta || {}, 'customers_upsert')
          ? {
              customers_upsert: catalogDelta?.customers_upsert || [],
              customers_delete: catalogDelta?.customers_delete || [],
            }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(catalogDelta || {}, 'suppliers_upsert')
          ? {
              suppliers_upsert: catalogDelta?.suppliers_upsert || [],
              suppliers_delete: catalogDelta?.suppliers_delete || [],
            }
          : {}),
      } : null,
      snapshot_meta: {
        used_resolved: applied.usedResolved,
        used_fallback_config: applied.usedFallbackConfig,
        used_cached_snapshot: applied.usedCachedSnapshot,
        resolution_error: incomingSnapshot.resolution_error ?? null,
        full_pull_on_pairing: applied.fullPullOnPairing ?? false,
        used_catalog_delta: useCatalogDelta,
        catalog_cursor: currentCatalogCursor,
        previous_catalog_cursor: previousCatalogCursor || null,
        catalog_upsert_count: catalogDelta?.items_upsert.length || 0,
        catalog_delete_count: catalogDelta?.items_delete.length || 0,
        customer_upsert_count: catalogDelta?.customers_upsert.length || 0,
        customer_delete_count: catalogDelta?.customers_delete.length || 0,
        supplier_upsert_count: catalogDelta?.suppliers_upsert.length || 0,
        supplier_delete_count: catalogDelta?.suppliers_delete.length || 0,
      },
    });
  } catch (error: any) {
    console.error('❌ Terminal config refresh error:', error?.message || error);

    const cachedSnapshot = getCachedTerminalSnapshot(localTerminalId);
    if (cachedSnapshot) {
      const applied = applyTerminalConfigSnapshot(config, {
        terminalId: localTerminalId,
        posDeviceId,
        incomingSnapshot: cachedSnapshot,
        cachedSnapshot,
      });

      saveSetting('config', applied.config);
      persistOperationalDocumentState(applied.config, applied.terminalId);

      return res.json({
        success: true,
        source: 'CACHED_SNAPSHOT',
        tenant_id: asString(cachedSnapshot.tenant_id) || tenantId,
        terminal_id: applied.terminalId,
        erp_terminal_id: erpTerminalId,
        terminal_config: cachedSnapshot,
        config: applied.config,
        catalog_delta: null,
        snapshot_meta: {
          used_resolved: applied.usedResolved,
          used_fallback_config: applied.usedFallbackConfig,
          used_cached_snapshot: true,
          resolution_error: null,
          full_pull_on_pairing: applied.fullPullOnPairing ?? false,
          used_catalog_delta: false,
          catalog_cursor: computeCatalogCursor(cachedSnapshot),
          previous_catalog_cursor: null,
          catalog_upsert_count: 0,
          catalog_delete_count: 0,
        },
      });
    }

    return res.status(500).json({
      status: 'error',
      message: error?.message || 'No se pudo refrescar la configuración de la terminal.',
    });
  }
});

router.get('/:terminalId/manifest', async (req, res) => {
  const erpTerminalId = asString(req.params.terminalId);
  const localTerminalId = asString(req.query.local_terminal_id) || erpTerminalId;
  const tenantId = resolveTenantId(req);
  const tenantSlug = resolveTenantSlug(req);
  const tenantEmail = resolveTenantEmail(req);
  const erpBaseUrl = resolveErpBaseUrl(req);
  const posDeviceId = asString(req.query.pos_device_id);

  if (!erpTerminalId) {
    return res.status(400).json({ status: 'error', message: 'terminalId es obligatorio.' });
  }

  if (!tenantId || !erpBaseUrl) {
    return res.status(400).json({
      status: 'error',
      message: 'tenant_id y erp_base_url son obligatorios para refrescar la terminal.',
    });
  }

  try {
    const resolvedTenant = await resolveErpTenantId(req, erpBaseUrl, {
      tenantId,
      tenantSlug,
      tenantEmail,
      deviceId: posDeviceId,
    });
    const effectiveTenantId = resolvedTenant.tenantId || tenantId;
    const params = new URLSearchParams();
    params.set('tenant_id', effectiveTenantId);
    if (typeof req.query.terminal_cursor === 'string') params.set('terminal_cursor', asString(req.query.terminal_cursor));
    if (typeof req.query.items_cursor === 'string') params.set('items_cursor', asString(req.query.items_cursor));
    if (typeof req.query.customers_cursor === 'string') params.set('customers_cursor', asString(req.query.customers_cursor));
    if (typeof req.query.suppliers_cursor === 'string') params.set('suppliers_cursor', asString(req.query.suppliers_cursor));
    if (typeof req.query.purchase_orders_cursor === 'string') params.set('purchase_orders_cursor', asString(req.query.purchase_orders_cursor));
    if (typeof req.query.transfers_cursor === 'string') params.set('transfers_cursor', asString(req.query.transfers_cursor));
    if (typeof req.query.inventory_cursor === 'string') params.set('inventory_cursor', asString(req.query.inventory_cursor));
    if (typeof req.query.product_prices_cursor === 'string') params.set('product_prices_cursor', asString(req.query.product_prices_cursor));

    const payload = await fetchErpJson(
      req,
      erpBaseUrl,
      `/api/sync/terminals/${encodeURIComponent(erpTerminalId)}/manifest?${params.toString()}`,
      effectiveTenantId,
    );

    return res.json({
      success: true,
      tenant_id: effectiveTenantId,
      terminal_id: localTerminalId,
      erp_terminal_id: erpTerminalId,
      tenant_resolution_source: resolvedTenant.source,
      manifest: payload?.manifest && typeof payload.manifest === 'object' ? payload.manifest : payload,
    });
  } catch (error: any) {
    console.error('❌ Terminal manifest refresh error:', error?.message || error);
    return res.status(500).json({
      status: 'error',
      message: error?.message || 'No se pudo consultar el manifest de maestros.',
    });
  }
});

export default router;
