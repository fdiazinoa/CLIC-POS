import type { CartItem, Product, Transaction } from '../../types';
import { requestJson } from '../network/httpClient';
import { readTerminalCredentialsSync } from './TerminalCredentialStore';
import { resolveSyncDeviceToken } from './deviceToken';
import { loadSyncProfile, resolveSyncTarget } from './SyncProfile';
import { persistLocalDeviceId, resolveLocalDeviceId } from '../../utils/deviceRevocation';

export interface ErpConsignmentLine {
    id: string;
    productId?: string;
    product_id?: string;
    itemId?: string;
    item_id?: string;
    sku?: string;
    barcode?: string;
    reference?: string;
    name?: string;
    description?: string;
    quantity?: number;
    qty?: number;
    availableQuantity?: number;
    available_quantity?: number;
    price?: number;
    unitPrice?: number;
    unit_price?: number;
    [key: string]: unknown;
}

export interface ErpConsignment {
    id: string;
    documentNo?: string;
    document_no?: string;
    number?: string;
    customerId?: string;
    customer_id?: string;
    customerName?: string;
    customer_name?: string;
    status?: string;
    lines?: ErpConsignmentLine[];
    items?: ErpConsignmentLine[];
    [key: string]: unknown;
}

export interface ConsignmentLiquidationPayload {
    transaction: Pick<Transaction, 'id' | 'displayId' | 'date' | 'terminalId' | 'userId' | 'userName'>;
    lines: Array<{
        consignmentLineId: string;
        productId: string;
        quantity: number;
        unitPrice: number;
        total: number;
        localCartId?: string;
        idempotencyKey: string;
    }>;
}

export interface ConsignmentProductIndexes {
    products: Product[];
    productsByItemId: Map<string, Product>;
    productsByItemCode: Map<string, Product>;
    productsBySku: Map<string, Product>;
    productsByBarcode: Map<string, Product>;
    productsByReference: Map<string, Product>;
    totalProducts: number;
    sampleItemIds: string[];
    sampleItemCodes: string[];
    sampleSkus: string[];
    sampleBarcodes: string[];
    sampleReferences: string[];
}

const unwrapPayload = <T>(payload: unknown): T => {
    const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    return (root.data ?? root.payload ?? root.result ?? payload) as T;
};

const normalizeBaseUrl = (value?: string | null): string | null => {
    const normalized = String(value || '').trim().replace(/\/+$/, '');
    return normalized || null;
};

const normalizeErpOriginUrl = (value?: string | null): string | null => {
    const normalized = normalizeBaseUrl(value);
    if (!normalized) return null;

    try {
        const url = new URL(normalized);
        url.pathname = url.pathname
            .replace(/\/api\/sync\/?$/i, '')
            .replace(/\/api\/?$/i, '')
            .replace(/\/+$/, '');
        url.search = '';
        url.hash = '';
        return url.toString().replace(/\/+$/, '');
    } catch {
        return normalized
            .replace(/\/api\/sync\/?$/i, '')
            .replace(/\/api\/?$/i, '')
            .replace(/\/+$/, '');
    }
};

const normalizeLookupToken = (value: unknown): string => String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const indexProduct = (index: Map<string, Product>, value: unknown, product: Product): void => {
    const token = normalizeLookupToken(value);
    if (token && !index.has(token)) index.set(token, product);
};

const asProductIndexRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const indexProductBarcodeValues = (index: Map<string, Product>, value: unknown, product: Product): void => {
    if (Array.isArray(value)) {
        value.forEach(entry => {
            const record = asProductIndexRecord(entry);
            if (record) {
                indexProduct(index, record.barcode, product);
                indexProduct(index, record.code, product);
                indexProduct(index, record.value, product);
                return;
            }
            indexProduct(index, entry, product);
        });
        return;
    }
    indexProduct(index, value, product);
};

const indexProductRecord = (
    indexes: ConsignmentProductIndexes,
    product: Product,
    record: Record<string, unknown> | null
): void => {
    if (!record) return;
    indexProduct(indexes.productsByItemId, record.id, product);
    indexProduct(indexes.productsByItemId, record.erpItemId, product);
    indexProduct(indexes.productsByItemId, record.erp_item_id, product);
    indexProduct(indexes.productsByItemId, record.item_id, product);
    indexProduct(indexes.productsByItemId, record.itemId, product);
    indexProduct(indexes.productsByItemId, record.sourceItemId, product);
    indexProduct(indexes.productsByItemId, record.source_item_id, product);
    indexProduct(indexes.productsByItemId, record.erpProductId, product);
    indexProduct(indexes.productsByItemId, record.erp_product_id, product);
    indexProduct(indexes.productsByItemCode, record.code, product);
    indexProduct(indexes.productsByItemCode, record.itemCode, product);
    indexProduct(indexes.productsByItemCode, record.item_code, product);
    indexProduct(indexes.productsBySku, record.sku, product);
    indexProductBarcodeValues(indexes.productsByBarcode, record.barcode, product);
    indexProductBarcodeValues(indexes.productsByBarcode, record.barcodes, product);
    indexProduct(indexes.productsByReference, record.reference, product);
    indexProduct(indexes.productsByReference, record.referenceCode, product);
    indexProduct(indexes.productsByReference, record.reference_code, product);
};

const canonicalLineDiagnostic = (line: ErpConsignmentLine) => ({
    item_id: String((line as any).item_id || ''),
    item_code: String((line as any).item_code || ''),
    sku: String(line.sku || ''),
    barcode: String(line.barcode || ''),
    reference: String(line.reference || ''),
    name: String(line.name || line.description || ''),
});

const isUuidLike = (value: unknown): boolean =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());

const consignmentDocumentTokens = (consignment: ErpConsignment | Record<string, unknown>): string[] => {
    const record = consignment as Record<string, unknown>;
    return [
        record.documentNo,
        record.document_no,
        record.documentNumber,
        record.document_number,
        record.number,
        record.code,
        record.reference,
        record.id,
    ].map(normalizeLookupToken).filter(Boolean);
};

const consignmentDetailIdCandidates = (consignment: ErpConsignment | Record<string, unknown>): string[] => {
    const record = consignment as Record<string, unknown>;
    const candidates = [
        record.uuid,
        record.consignmentId,
        record.consignment_id,
        record.documentId,
        record.document_id,
        record.erpConsignmentId,
        record.erp_consignment_id,
        record.sourceId,
        record.source_id,
        record.remoteId,
        record.remote_id,
        record.id,
    ]
        .map(value => String(value || '').trim())
        .filter(Boolean);

    return Array.from(new Set(candidates)).sort((left, right) => {
        const leftUuid = isUuidLike(left) ? 0 : 1;
        const rightUuid = isUuidLike(right) ? 0 : 1;
        return leftUuid - rightUuid;
    });
};

const pickToken = (): string | null => {
    const credentials = readTerminalCredentialsSync();
    return String(credentials.syncToken || '').trim()
        || localStorage.getItem('clic_erp_sync_token')?.trim()
        || localStorage.getItem('clic_erp_sync_auth_token')?.trim()
        || localStorage.getItem('CLIC_ERP_SYNC_TOKEN')?.trim()
        || null;
};

const isTerminalCodeLikeDeviceId = (deviceId?: string | null, terminalId?: string | null): boolean => {
    const normalizedDeviceId = String(deviceId || '').trim().toLowerCase();
    const normalizedTerminalId = String(terminalId || '').trim().toLowerCase();
    if (!normalizedDeviceId) return false;
    return Boolean(normalizedTerminalId && normalizedDeviceId === normalizedTerminalId);
};

const resolveRequestContext = () => {
    const profile = loadSyncProfile();
    const target = resolveSyncTarget(profile);
    const credentials = readTerminalCredentialsSync();
    const terminalId = target.terminalId || profile.erpTerminalId || credentials.terminalId || '';
    const deviceId = credentials.deviceId || resolveOrCreateLocalDeviceId();
    const tenantId = profile.erpTenantId || profile.cloudTenantId || localStorage.getItem('clic_erp_sync_tenant_id') || '';

    return { profile, target, credentials, terminalId, deviceId, tenantId };
};

const resolveOrCreateLocalDeviceId = (): string => {
    const existing = resolveLocalDeviceId();
    if (existing) return existing;
    const generated = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `pos-${crypto.randomUUID()}`
        : `pos-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    persistLocalDeviceId(generated);
    return generated;
};

const buildHeaders = (includeContentType = false): Record<string, string> => {
    const { credentials, terminalId, deviceId, tenantId } = resolveRequestContext();
    const token = pickToken();
    const headers: Record<string, string> = includeContentType ? { 'Content-Type': 'application/json' } : {};

    if (token) {
        headers.Authorization = `Bearer ${token}`;
        headers['X-Sync-Token'] = token;
    }

    if (terminalId) {
        headers['X-Terminal-Id'] = terminalId;
        headers['X-POS-Terminal-Id'] = terminalId;
    }

    if (deviceId && !isTerminalCodeLikeDeviceId(deviceId, terminalId)) {
        headers['X-Device-Id'] = deviceId;
        headers['X-POS-Device-Id'] = deviceId;
    }

    const deviceToken = credentials.deviceToken || resolveSyncDeviceToken().token;
    if (deviceToken) {
        headers['X-Device-Token'] = deviceToken;
    }

    if (tenantId) {
        headers['X-Tenant-Id'] = tenantId;
        headers['X-POS-Tenant-Id'] = tenantId;
    }

    return headers;
};

class ConsignmentSyncService {
    private resolveBaseUrl(): string {
        const profile = loadSyncProfile();
        const target = resolveSyncTarget(profile);
        const baseUrl = normalizeErpOriginUrl(target.kind === 'ERP_ACTIVE' ? target.baseUrl : profile.erpBaseUrl || target.baseUrl);
        if (!baseUrl) {
            throw new Error('No hay ERP configurado para consultar consignaciones.');
        }
        return baseUrl;
    }

    private buildUrl(path: string, params?: Record<string, string | null | undefined>): string {
        const { terminalId, deviceId, tenantId } = resolveRequestContext();
        const url = new URL(`${this.resolveBaseUrl()}${path}`);

        if (tenantId) {
            url.searchParams.set('tenant_id', tenantId);
            url.searchParams.set('tenantId', tenantId);
        }
        if (terminalId) {
            url.searchParams.set('terminal_id', terminalId);
            url.searchParams.set('terminalId', terminalId);
        }
        if (deviceId && !isTerminalCodeLikeDeviceId(deviceId, terminalId)) {
            url.searchParams.set('device_id', deviceId);
            url.searchParams.set('deviceId', deviceId);
        }

        Object.entries(params || {}).forEach(([key, value]) => {
            const normalized = String(value || '').trim();
            if (normalized) url.searchParams.set(key, normalized);
        });

        return url.toString();
    }

    private async requestFirstAvailable<T>(
        paths: string[],
        options: {
            method?: 'GET' | 'POST';
            includeContentType?: boolean;
            body?: string;
            timeoutMs?: number;
            diagnosticContext?: Record<string, unknown>;
            params?: Record<string, string | null | undefined>;
        }
    ) {
        let lastResponse: any = null;

        for (const path of paths) {
            const response = await requestJson<T>({
                url: this.buildUrl(path, options.params),
                method: options.method || 'GET',
                headers: buildHeaders(Boolean(options.includeContentType)),
                body: options.body,
                timeoutMs: options.timeoutMs || 20000,
                diagnosticContext: {
                    ...(options.diagnosticContext || {}),
                    consignmentPath: path,
                },
            });

            if (response.ok) return response;
            lastResponse = response;

            if (![400, 404, 405].includes(response.status)) {
                break;
            }
        }

        return lastResponse;
    }

    async searchConsignments(query: string): Promise<ErpConsignment[]> {
        const term = query.trim();
        const searchPaths = [
            '/api/consignments',
            '/api/sync/consignments',
        ];
        let lastResponse: Awaited<ReturnType<typeof this.requestFirstAvailable<unknown>>> | null = null;

        for (const path of searchPaths) {
            const response = await this.requestFirstAvailable<unknown>([path], {
                diagnosticContext: { operation: 'CONSIGNMENT_SEARCH' },
                params: {
                    q: term,
                    search: term,
                    query: term,
                    document_no: term,
                    documentNo: term,
                    document_number: term,
                    documentNumber: term,
                    number: term,
                    customer: term,
                    customer_name: term,
                    customerName: term,
                    include_open: 'true',
                    includeOpen: 'true',
                },
            });

            lastResponse = response;
            if (!response?.ok) {
                if (![400, 404, 405].includes(response?.status || 0)) {
                    break;
                }
                continue;
            }

            const payload = unwrapPayload<unknown>(response.data);
            if (Array.isArray(payload)) {
                if (payload.length > 0 || path === searchPaths[searchPaths.length - 1]) {
                    return payload as ErpConsignment[];
                }
                continue;
            }
            if (payload && typeof payload === 'object') {
                const objectPayload = payload as Record<string, unknown>;
                const rows = objectPayload.items || objectPayload.consignments || objectPayload.rows || objectPayload.data;
                if (Array.isArray(rows)) {
                    if (rows.length > 0 || path === searchPaths[searchPaths.length - 1]) {
                        return rows as ErpConsignment[];
                    }
                    continue;
                }
            }

            if (path === searchPaths[searchPaths.length - 1]) {
                return [];
            }
        }

        throw new Error(`ERP consignaciones HTTP ${lastResponse?.status || 'N/A'}`);
    }

    private async fetchConsignmentByIdentifier(id: string): Promise<ErpConsignment> {
        const response = await this.requestFirstAvailable<unknown>([
            `/api/consignments/${encodeURIComponent(id)}`,
            `/api/sync/consignments/${encodeURIComponent(id)}`,
        ], {
            diagnosticContext: { operation: 'CONSIGNMENT_DETAIL', consignmentId: id },
        });

        if (!response?.ok) {
            throw new Error(`ERP consignación ${id} HTTP ${response?.status || 'N/A'}`);
        }

        return unwrapPayload<ErpConsignment>(response.data);
    }

    async getConsignment(id: string): Promise<ErpConsignment> {
        const lookup = String(id || '').trim();
        const attemptedIds = new Set<string>();

        const tryFetch = async (candidate: string): Promise<ErpConsignment | null> => {
            const normalized = candidate.trim();
            if (!normalized || attemptedIds.has(normalized)) return null;
            attemptedIds.add(normalized);
            try {
                return await this.fetchConsignmentByIdentifier(normalized);
            } catch (error) {
                console.warn('POS_CONSIGNMENT_DETAIL_LOOKUP_FAILED', {
                    candidate: normalized,
                    error: error instanceof Error ? error.message : String(error),
                });
                return null;
            }
        };

        if (isUuidLike(lookup)) {
            const detail = await tryFetch(lookup);
            if (detail) return detail;
        }

        const searchRows = await this.searchConsignments(lookup).catch((error) => {
            console.warn('POS_CONSIGNMENT_DETAIL_SEARCH_LOOKUP_FAILED', {
                lookup,
                error: error instanceof Error ? error.message : String(error),
            });
            return [] as ErpConsignment[];
        });
        const lookupToken = normalizeLookupToken(lookup);
        const matchedRow = searchRows.find(row => consignmentDocumentTokens(row).includes(lookupToken)) || searchRows[0];
        if (matchedRow) {
            for (const candidate of consignmentDetailIdCandidates(matchedRow)) {
                const detail = await tryFetch(candidate);
                if (detail) return {
                    ...matchedRow,
                    ...detail,
                    lines: detail.lines || detail.items || matchedRow.lines || matchedRow.items,
                    items: detail.items || detail.lines || matchedRow.items || matchedRow.lines,
                };
            }

            return matchedRow;
        }

        const fallbackDetail = await tryFetch(lookup);
        if (fallbackDetail) return fallbackDetail;
        throw new Error(`ERP consignación ${lookup} HTTP N/A`);
    }

    async liquidateConsignment(id: string, payload: ConsignmentLiquidationPayload): Promise<unknown> {
        const response = await this.requestFirstAvailable<unknown>([
            `/api/consignments/${encodeURIComponent(id)}/liquidate`,
            `/api/sync/consignments/${encodeURIComponent(id)}/liquidate`,
        ], {
            method: 'POST',
            includeContentType: true,
            body: JSON.stringify(payload),
            diagnosticContext: { operation: 'CONSIGNMENT_LIQUIDATE', consignmentId: id },
        });

        if (!response?.ok) {
            throw new Error(`ERP liquidación consignación ${id} HTTP ${response?.status || 'N/A'}`);
        }

        return unwrapPayload<unknown>(response.data);
    }

    async returnConsignment(id: string, payload: ConsignmentLiquidationPayload): Promise<unknown> {
        const response = await this.requestFirstAvailable<unknown>([
            `/api/consignments/${encodeURIComponent(id)}/return`,
            `/api/sync/consignments/${encodeURIComponent(id)}/return`,
        ], {
            method: 'POST',
            includeContentType: true,
            body: JSON.stringify(payload),
            diagnosticContext: { operation: 'CONSIGNMENT_RETURN', consignmentId: id },
        });

        if (!response?.ok) {
            throw new Error(`ERP devolución consignación ${id} HTTP ${response?.status || 'N/A'}`);
        }

        return unwrapPayload<unknown>(response.data);
    }

    buildCartItemPatch(consignment: ErpConsignment, line: ErpConsignmentLine): Pick<CartItem, 'consignmentId' | 'consignmentDocumentNo' | 'consignmentLineId'> {
        return {
            consignmentId: String(consignment.id),
            consignmentDocumentNo: String(consignment.documentNo || consignment.document_no || consignment.number || consignment.id),
            consignmentLineId: String(line.id),
        };
    }

    buildProductIndexes(products: Product[]): ConsignmentProductIndexes {
        const indexes: ConsignmentProductIndexes = {
            products,
            productsByItemId: new Map<string, Product>(),
            productsByItemCode: new Map<string, Product>(),
            productsBySku: new Map<string, Product>(),
            productsByBarcode: new Map<string, Product>(),
            productsByReference: new Map<string, Product>(),
            totalProducts: products.length,
            sampleItemIds: [],
            sampleItemCodes: [],
            sampleSkus: [],
            sampleBarcodes: [],
            sampleReferences: [],
        };

        products.forEach(product => {
            const record = product as unknown as Record<string, unknown>;
            indexProductRecord(indexes, product, record);
            [
                record.source,
                record.metadata,
                record.erp,
                record.raw,
                record.original,
                record.product,
                record.item,
                asProductIndexRecord(record.config)?.metadata,
            ].forEach(nested => indexProductRecord(indexes, product, asProductIndexRecord(nested)));
        });

        indexes.sampleItemIds = Array.from(indexes.productsByItemId.keys()).slice(0, 5);
        indexes.sampleItemCodes = Array.from(indexes.productsByItemCode.keys()).slice(0, 5);
        indexes.sampleSkus = Array.from(indexes.productsBySku.keys()).slice(0, 5);
        indexes.sampleBarcodes = Array.from(indexes.productsByBarcode.keys()).slice(0, 5);
        indexes.sampleReferences = Array.from(indexes.productsByReference.keys()).slice(0, 5);

        return indexes;
    }

    findMatchingProduct(line: ErpConsignmentLine, source: Product[] | ConsignmentProductIndexes): Product | null {
        const indexes = Array.isArray(source) ? this.buildProductIndexes(source) : source;
        const itemId = normalizeLookupToken((line as any).item_id);
        if (itemId) {
            const product = indexes.productsByItemId.get(itemId);
            if (product) return product;
        }

        const itemCode = normalizeLookupToken((line as any).item_code);
        if (itemCode) {
            const product = indexes.productsByItemCode.get(itemCode);
            if (product) return product;
        }

        const sku = normalizeLookupToken(line.sku);
        if (sku) {
            const product = indexes.productsBySku.get(sku);
            if (product) return product;
        }

        const barcode = normalizeLookupToken(line.barcode);
        if (barcode) {
            const product = indexes.productsByBarcode.get(barcode);
            if (product) return product;
        }

        const reference = normalizeLookupToken(line.reference);
        if (reference) {
            const product = indexes.productsByReference.get(reference);
            if (product) return product;
        }

        return null;
    }

    describeProductNotFound(line: ErpConsignmentLine, indexes?: ConsignmentProductIndexes): string {
        const diagnostic = canonicalLineDiagnostic(line);
        const diagnosticNameToken = normalizeLookupToken(diagnostic.name);
        const nameMatches = diagnosticNameToken && indexes?.products
            ? indexes.products
                .filter(product => normalizeLookupToken(product.name).includes(diagnosticNameToken) || diagnosticNameToken.includes(normalizeLookupToken(product.name)))
                .slice(0, 3)
                .map(product => {
                    const record = product as unknown as Record<string, unknown>;
                    return [
                        product.name,
                        `id=${product.id || 'N/A'}`,
                        `code=${record.code || record.itemCode || record.item_code || 'N/A'}`,
                        `sku=${record.sku || 'N/A'}`,
                        `barcode=${product.barcode || record.barcode || 'N/A'}`,
                    ].join(' ');
                })
            : [];
        return [
            'CONSIGNMENT_PRODUCT_NOT_AVAILABLE_FOR_TERMINAL',
            'producto no está habilitado en el catálogo POS de esta terminal; revise categorías permitidas o configuración de catálogo en ERP y sincronice nuevamente',
            `local_products=${indexes?.totalProducts ?? 'N/A'}`,
            `sample_item_codes=${indexes?.sampleItemCodes?.join(',') || 'N/A'}`,
            `sample_barcodes=${indexes?.sampleBarcodes?.join(',') || 'N/A'}`,
            `local_name_matches=${nameMatches.length > 0 ? nameMatches.join(' / ') : 'N/A'}`,
            `item_id=${diagnostic.item_id || 'N/A'}`,
            `item_code=${diagnostic.item_code || 'N/A'}`,
            `sku=${diagnostic.sku || 'N/A'}`,
            `barcode=${diagnostic.barcode || 'N/A'}`,
            `reference=${diagnostic.reference || 'N/A'}`,
            `name=${diagnostic.name || 'N/A'}`,
        ].join(' | ');
    }
}

export const consignmentSyncService = new ConsignmentSyncService();
