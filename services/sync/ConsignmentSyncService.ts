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

const unwrapPayload = <T>(payload: unknown): T => {
    const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    return (root.data ?? root.payload ?? root.result ?? payload) as T;
};

const normalizeBaseUrl = (value?: string | null): string | null => {
    const normalized = String(value || '').trim().replace(/\/+$/, '');
    return normalized || null;
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
    const profile = loadSyncProfile();
    const target = resolveSyncTarget(profile);
    const credentials = readTerminalCredentialsSync();
    const terminalId = target.terminalId || profile.erpTerminalId || credentials.terminalId || '';
    const deviceId = credentials.deviceId || resolveOrCreateLocalDeviceId();
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

    const tenantId = profile.erpTenantId || profile.cloudTenantId || localStorage.getItem('clic_erp_sync_tenant_id') || '';
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
        const baseUrl = normalizeBaseUrl(target.kind === 'ERP_ACTIVE' ? target.baseUrl : profile.erpBaseUrl || target.baseUrl);
        if (!baseUrl) {
            throw new Error('No hay ERP configurado para consultar consignaciones.');
        }
        return baseUrl;
    }

    async searchConsignments(query: string): Promise<ErpConsignment[]> {
        const url = new URL(`${this.resolveBaseUrl()}/api/sync/consignments`);
        const term = query.trim();
        if (term) {
            url.searchParams.set('q', term);
            url.searchParams.set('search', term);
        }

        const response = await requestJson<unknown>({
            url: url.toString(),
            method: 'GET',
            headers: buildHeaders(),
            timeoutMs: 20000,
            diagnosticContext: { operation: 'CONSIGNMENT_SEARCH' },
        });

        if (!response.ok) {
            throw new Error(`ERP consignaciones HTTP ${response.status}`);
        }

        const payload = unwrapPayload<unknown>(response.data);
        if (Array.isArray(payload)) return payload as ErpConsignment[];
        if (payload && typeof payload === 'object') {
            const objectPayload = payload as Record<string, unknown>;
            const rows = objectPayload.items || objectPayload.consignments || objectPayload.rows;
            return Array.isArray(rows) ? rows as ErpConsignment[] : [];
        }
        return [];
    }

    async getConsignment(id: string): Promise<ErpConsignment> {
        const response = await requestJson<unknown>({
            url: `${this.resolveBaseUrl()}/api/sync/consignments/${encodeURIComponent(id)}`,
            method: 'GET',
            headers: buildHeaders(),
            timeoutMs: 20000,
            diagnosticContext: { operation: 'CONSIGNMENT_DETAIL', consignmentId: id },
        });

        if (!response.ok) {
            throw new Error(`ERP consignación ${id} HTTP ${response.status}`);
        }

        return unwrapPayload<ErpConsignment>(response.data);
    }

    async liquidateConsignment(id: string, payload: ConsignmentLiquidationPayload): Promise<unknown> {
        const response = await requestJson<unknown>({
            url: `${this.resolveBaseUrl()}/api/sync/consignments/${encodeURIComponent(id)}/liquidate`,
            method: 'POST',
            headers: buildHeaders(true),
            body: JSON.stringify(payload),
            timeoutMs: 20000,
            diagnosticContext: { operation: 'CONSIGNMENT_LIQUIDATE', consignmentId: id },
        });

        if (!response.ok) {
            throw new Error(`ERP liquidación consignación ${id} HTTP ${response.status}`);
        }

        return unwrapPayload<unknown>(response.data);
    }

    async returnConsignment(id: string, payload: ConsignmentLiquidationPayload): Promise<unknown> {
        const response = await requestJson<unknown>({
            url: `${this.resolveBaseUrl()}/api/sync/consignments/${encodeURIComponent(id)}/return`,
            method: 'POST',
            headers: buildHeaders(true),
            body: JSON.stringify(payload),
            timeoutMs: 20000,
            diagnosticContext: { operation: 'CONSIGNMENT_RETURN', consignmentId: id },
        });

        if (!response.ok) {
            throw new Error(`ERP devolución consignación ${id} HTTP ${response.status}`);
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

    findMatchingProduct(line: ErpConsignmentLine, products: Product[]): Product | null {
        const candidates = [
            line.productId,
            line.product_id,
            line.itemId,
            line.item_id,
            line.sku,
            line.barcode,
            line.reference,
        ].map(value => String(value || '').trim().toLowerCase()).filter(Boolean);

        if (candidates.length === 0) return null;

        return products.find(product => {
            const source = product as unknown as Record<string, unknown>;
            const productCandidates = [
                product.id,
                source.reference,
                source.referenceCode,
                source.reference_code,
                product.barcode,
                source.barcode2,
                source.barcode3,
                source.barcode_2,
                source.barcode_3,
            ].map(value => String(value || '').trim().toLowerCase()).filter(Boolean);
            return productCandidates.some(candidate => candidates.includes(candidate));
        }) || null;
    }
}

export const consignmentSyncService = new ConsignmentSyncService();
