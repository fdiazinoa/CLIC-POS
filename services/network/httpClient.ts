import { Capacitor, CapacitorHttp } from '@capacitor/core';

export type NetworkEngine = 'capacitor-http' | 'fetch';

export interface RequestJsonInput {
    url: string;
    method?: string;
    headers?: Record<string, unknown>;
    body?: unknown;
    timeoutMs?: number;
    diagnosticContext?: Record<string, unknown>;
}

export interface RequestJsonResult<T = unknown> {
    ok: boolean;
    status: number;
    headers: Record<string, string>;
    data: T | null;
    text: string;
    networkEngine: NetworkEngine;
    fetchStage: string;
}

export interface HttpClientErrorDiagnostic {
    networkEngine: NetworkEngine;
    fetchStage: string;
    method: string;
    url: string;
    headersPresent: {
        authorization: boolean;
        xSyncToken: boolean;
        xTerminalId: boolean;
        xDeviceId: boolean;
        xDeviceToken: boolean;
    };
    tokenPresent: boolean;
    tokenPreview: string | null;
    bodySize: number;
    contentType: string | null;
    networkOnline: boolean | null;
    platform: string;
    errorName?: string | null;
    errorMessage?: string | null;
    errorStack?: string | null;
    errorCause?: string | null;
    [key: string]: unknown;
}

const INVALID_HEADER_VALUES = new Set(['', 'undefined', 'null', '[object object]']);

const isNativeHttpPreferred = (): boolean => {
    try {
        return Capacitor.isNativePlatform() || Capacitor.getPlatform() === 'android';
    } catch {
        return false;
    }
};

export const getNetworkEngine = (): NetworkEngine => isNativeHttpPreferred() ? 'capacitor-http' : 'fetch';

export const sanitizeHeaders = (headers?: Record<string, unknown>): Record<string, string> => {
    const sanitized: Record<string, string> = {};
    Object.entries(headers || {}).forEach(([key, rawValue]) => {
        const headerName = String(key || '').trim();
        const headerValue = String(rawValue ?? '').replace(/[\r\n]/g, '').trim();
        if (!headerName || INVALID_HEADER_VALUES.has(headerValue.toLowerCase())) {
            if (headerName) {
                console.warn('[INVALID_SYNC_HEADERS]', { headerName, reason: 'EMPTY_OR_INVALID_VALUE' });
            }
            return;
        }
        sanitized[headerName] = headerValue;
    });
    return sanitized;
};

const previewToken = (token?: string | null): string | null => {
    const normalized = String(token || '').trim();
    return normalized ? '(redacted)' : null;
};

const summarizeHeaders = (headers: Record<string, string>) => {
    const authorization = headers.Authorization || headers.authorization || '';
    const syncToken = headers['X-Sync-Token'] || headers['x-sync-token'] || '';
    const deviceToken = headers['X-Device-Token'] || headers['x-device-token'] || '';
    const effectiveToken = syncToken || authorization.replace(/^Bearer\s+/i, '') || deviceToken;
    return {
        authorization: Boolean(authorization),
        xSyncToken: Boolean(syncToken),
        xTerminalId: Boolean(headers['X-Terminal-Id'] || headers['X-POS-Terminal-Id'] || headers['x-terminal-id'] || headers['x-pos-terminal-id']),
        xDeviceId: Boolean(headers['X-Device-Id'] || headers['X-POS-Device-Id'] || headers['x-device-id'] || headers['x-pos-device-id']),
        xDeviceToken: Boolean(deviceToken),
        tokenPresent: Boolean(effectiveToken),
        tokenPreview: previewToken(effectiveToken),
        contentType: headers['Content-Type'] || headers['content-type'] || null,
    };
};

const resolveBodySize = (body: unknown): number => {
    if (body === undefined || body === null) return 0;
    if (typeof body === 'string') return body.length;
    try {
        return JSON.stringify(body).length;
    } catch {
        return -1;
    }
};

const normalizeBodyForNative = (body: unknown, contentType?: string | null): unknown => {
    if (body === undefined || body === null) return undefined;
    if (typeof body !== 'string') return body;
    if (contentType?.toLowerCase().includes('application/json')) {
        try {
            return JSON.parse(body);
        } catch {
            return body;
        }
    }
    return body;
};

const normalizeResponseHeaders = (headers: unknown): Record<string, string> => {
    const normalized: Record<string, string> = {};
    if (!headers || typeof headers !== 'object') return normalized;
    Object.entries(headers as Record<string, unknown>).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        normalized[key] = String(value);
    });
    return normalized;
};

const stringifyNativeData = (data: unknown): string => {
    if (data === undefined || data === null) return '';
    if (typeof data === 'string') return data;
    try {
        return JSON.stringify(data);
    } catch {
        return String(data);
    }
};

const parseJsonText = <T>(text: string): T | null => {
    if (!text) return null;
    try {
        return JSON.parse(text) as T;
    } catch {
        return null;
    }
};

export const attachHttpClientDiagnostic = (error: unknown, diagnostic: HttpClientErrorDiagnostic): void => {
    if (!error || typeof error !== 'object') return;
    try {
        Object.defineProperty(error, '__httpClientDiagnostic', {
            value: diagnostic,
            configurable: true,
            enumerable: false,
        });
    } catch {
        (error as any).__httpClientDiagnostic = diagnostic;
    }
};

export async function requestJson<T = unknown>(input: RequestJsonInput): Promise<RequestJsonResult<T>> {
    const method = String(input.method || 'GET').toUpperCase();
    const headers = sanitizeHeaders(input.headers);
    const headersSummary = summarizeHeaders(headers);
    const networkEngine = getNetworkEngine();
    const timeoutMs = input.timeoutMs || 5000;
    const bodySize = resolveBodySize(input.body);
    const platform = (() => {
        try {
            return Capacitor.getPlatform();
        } catch {
            return 'web';
        }
    })();
    const baseDiagnostic = {
        ...(input.diagnosticContext || {}),
        method,
        url: input.url,
        endpoint: input.url,
        networkEngine,
        headersPresent: {
            authorization: headersSummary.authorization,
            xSyncToken: headersSummary.xSyncToken,
            xTerminalId: headersSummary.xTerminalId,
            xDeviceId: headersSummary.xDeviceId,
            xDeviceToken: headersSummary.xDeviceToken,
        },
        tokenPresent: headersSummary.tokenPresent,
        tokenPreview: headersSummary.tokenPreview,
        bodySize,
        contentType: headersSummary.contentType,
        networkOnline: typeof navigator !== 'undefined' ? navigator.onLine : null,
        platform,
    };

    console.log('[FETCH_PREPARE]', { ...baseDiagnostic, fetchStage: 'PREPARE_HEADERS' });
    console.log('[FETCH_HEADERS]', {
        method,
        url: input.url,
        networkEngine,
        headersPresent: baseDiagnostic.headersPresent,
        tokenPresent: headersSummary.tokenPresent,
        tokenPreview: headersSummary.tokenPreview,
        contentType: headersSummary.contentType,
    });

    if (networkEngine === 'capacitor-http') {
        try {
            console.log('[FETCH_SENT]', { ...baseDiagnostic, fetchStage: 'NATIVE_HTTP_SENT' });
            console.log('[NATIVE_HTTP_SENT]', baseDiagnostic);
            const response = await CapacitorHttp.request({
                method,
                url: input.url,
                headers,
                data: normalizeBodyForNative(input.body, headersSummary.contentType),
                connectTimeout: timeoutMs,
                readTimeout: timeoutMs,
            });
            const text = stringifyNativeData(response.data);
            const data = typeof response.data === 'string' ? parseJsonText<T>(response.data) : (response.data as T | null);
            const result: RequestJsonResult<T> = {
                ok: response.status >= 200 && response.status < 300,
                status: response.status,
                headers: normalizeResponseHeaders(response.headers),
                data,
                text,
                networkEngine,
                fetchStage: 'NATIVE_HTTP_RESPONSE',
            };
            console.log('[FETCH_RESPONSE]', { ...baseDiagnostic, fetchStage: result.fetchStage, httpStatus: response.status, ok: result.ok });
            console.log('[NATIVE_HTTP_RESPONSE]', { ...baseDiagnostic, httpStatus: response.status, ok: result.ok });
            return result;
        } catch (error: any) {
            const diagnostic: HttpClientErrorDiagnostic = {
                ...baseDiagnostic,
                networkEngine,
                fetchStage: 'NATIVE_HTTP_FAILED',
                errorName: error?.name || null,
                errorMessage: error?.message || String(error || ''),
                errorStack: error?.stack || null,
                errorCause: error?.cause ? String(error.cause) : null,
            };
            attachHttpClientDiagnostic(error, diagnostic);
            console.error('[FETCH_FAILED]', diagnostic);
            console.error('[NATIVE_HTTP_FAILED]', diagnostic);
            throw error;
        }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        console.log('[FETCH_SENT]', { ...baseDiagnostic, fetchStage: 'FETCH_SENT' });
        const response = await fetch(input.url, {
            method,
            headers,
            body: input.body === undefined || input.body === null ? undefined : input.body as BodyInit,
            mode: 'cors',
            credentials: 'omit',
            cache: 'no-store',
            signal: controller.signal,
        });
        clearTimeout(timeout);
        const text = await response.text();
        const result: RequestJsonResult<T> = {
            ok: response.ok,
            status: response.status,
            headers: Object.fromEntries(response.headers.entries()),
            data: parseJsonText<T>(text),
            text,
            networkEngine,
            fetchStage: 'FETCH_RESPONSE',
        };
        console.log('[FETCH_RESPONSE]', { ...baseDiagnostic, fetchStage: 'FETCH_RESPONSE', httpStatus: response.status, ok: response.ok });
        return result;
    } catch (error: any) {
        clearTimeout(timeout);
        const diagnostic: HttpClientErrorDiagnostic = {
            ...baseDiagnostic,
            networkEngine,
            fetchStage: error?.name === 'AbortError' ? 'NETWORK_ERROR' : 'NETWORK_ERROR',
            errorName: error?.name || null,
            errorMessage: error?.message || String(error || ''),
            errorStack: error?.stack || null,
            errorCause: error?.cause ? String(error.cause) : null,
        };
        attachHttpClientDiagnostic(error, diagnostic);
        console.error('[FETCH_FAILED]', diagnostic);
        throw error;
    }
}
