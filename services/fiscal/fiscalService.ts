import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { CompanyInfo, FiscalProviderDeliveryMode, FiscalProviderId, Transaction } from '../../types';
import { buildMasterUrlFromHost, resolveMasterEndpointFromCloud } from '../../utils/cloudMasterRegistry';
import { db } from '../../utils/db';

export interface FiscalCredentialMetaResponse {
    providerId: FiscalProviderId;
    hasCredential: boolean;
    source?: 'env' | 'sqlite' | 'supabase';
    resolvedCredentialKey?: string;
    updatedAt?: string;
    label?: string;
    availableSources?: Array<'env' | 'sqlite' | 'supabase'>;
    hasLocalCredential?: boolean;
    hasSupabaseCredential?: boolean;
    hasEnvCredential?: boolean;
    supportsSupabaseWrite?: boolean;
}

export interface FiscalCredentialMutationResponse {
    success: boolean;
    message: string;
    meta?: FiscalCredentialMetaResponse;
}

export interface FiscalIssueResponse {
    success: boolean;
    providerId: FiscalProviderId;
    environment: number;
    documentCode: 'E31' | 'E32' | 'E34';
    providerTransactionId?: string;
    status?: string;
    message: string;
    pending?: boolean;
    raw?: unknown;
}

export interface FiscalStatusResponse {
    success: boolean;
    providerId: FiscalProviderId;
    environment: number;
    providerTransactionId: string;
    status?: string;
    message: string;
    pending?: boolean;
    raw?: unknown;
}

interface IssueFiscalDocumentInput {
    providerId: FiscalProviderId;
    environment: number;
    companyInfo: CompanyInfo;
    transaction: Transaction;
    taxRate?: number;
    sequenceExpiryDate?: string;
    credentialKey?: string;
    tipoIngreso?: number;
    modificationCode?: number;
    unitCodeGoods?: number;
    unitCodeServices?: number;
    deliveryMode?: FiscalProviderDeliveryMode;
    apiBaseUrl?: string;
    testUrl?: string;
    issueUrl?: string;
    statusUrl?: string;
    establishmentCode?: string;
    branchCode?: string;
    branchName?: string;
    cashierCode?: string;
}

const isNativeAndroidRuntime = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
const FISCAL_BACKEND_BASE_KEY = 'CLIC_POS_FISCAL_BASE_URL';
const LOCAL_FISCAL_CREDENTIAL_COLLECTION = 'fiscalCredentials';
const POLARIS_API_BASE = 'https://api.polarisedi.com';
const DIGIFACT_TEST_BASE_URL = 'https://testnucdo.digifact.com/api';
const DIGIFACT_PROD_BASE_URL = 'https://nucdo.digifact.com/api';

interface LocalFiscalCredentialRecord {
    id: string;
    providerId: FiscalProviderId;
    companyRnc?: string;
    credentialKey?: string;
    authToken: string;
    label?: string;
    updatedAt: string;
}

const normalizeBaseUrl = (value?: string | null): string | null => {
    const raw = String(value || '').trim();
    if (!raw) return null;

    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `${window.location.protocol}//${raw}`;

    try {
        const url = new URL(withProtocol);
        return url
            .toString()
            .replace(/\/api\/sync\/?$/i, '')
            .replace(/\/api\/?$/i, '')
            .replace(/\/+$/, '');
    } catch {
        return null;
    }
};

const uniqueStrings = (values: Array<string | null | undefined>) =>
    Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));

const cleanString = (value: unknown): string =>
    typeof value === 'string' ? value.trim() : '';

const normalizeTaxId = (value: unknown): string =>
    String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

const sanitizeNumber = (value: unknown): number => {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
};

const round2 = (value: number): number =>
    Math.round((value + Number.EPSILON) * 100) / 100;

const normalizePercentRate = (value: unknown, fallback = 18): number => {
    const parsed = sanitizeNumber(value);
    if (parsed <= 0) return fallback;
    return parsed <= 1 ? round2(parsed * 100) : round2(parsed);
};

const normalizeCredentialKey = (value?: string | null) =>
    String(value || '').trim().replace(/[^A-Za-z0-9]/g, '').toUpperCase();

const deriveCredentialKey = (companyInfo?: CompanyInfo, credentialKey?: string) => {
    const explicit = normalizeCredentialKey(credentialKey);
    if (explicit) return explicit;
    const companyKey = normalizeCredentialKey(companyInfo?.rnc);
    return companyKey || undefined;
};

const buildLocalCredentialRecordId = (providerId: FiscalProviderId, credentialKey?: string) =>
    `${providerId}:${credentialKey || 'DEFAULT'}`;

const pickNewestCredentialRecord = (records: LocalFiscalCredentialRecord[]): LocalFiscalCredentialRecord | null => {
    if (!Array.isArray(records) || records.length === 0) return null;
    return [...records].sort((left, right) =>
        new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime()
    )[0] || null;
};

const readLocalFiscalCredentialRecords = async (): Promise<LocalFiscalCredentialRecord[]> => {
    const raw = await db.get(LOCAL_FISCAL_CREDENTIAL_COLLECTION as any);
    return (Array.isArray(raw) ? raw : []).filter((entry): entry is LocalFiscalCredentialRecord =>
        Boolean(
            entry
            && typeof entry === 'object'
            && typeof (entry as any).id === 'string'
            && typeof (entry as any).providerId === 'string'
            && typeof (entry as any).authToken === 'string'
        )
    );
};

const resolveLocalFiscalCredential = async (
    providerId: FiscalProviderId,
    companyInfo?: CompanyInfo,
    credentialKey?: string
): Promise<{ record: LocalFiscalCredentialRecord; resolvedCredentialKey?: string } | null> => {
    const records = await readLocalFiscalCredentialRecords();
    const normalizedCredentialKey = deriveCredentialKey(companyInfo, credentialKey);
    const scopedId = buildLocalCredentialRecordId(providerId, normalizedCredentialKey);
    const defaultId = buildLocalCredentialRecordId(providerId);
    const providerRecords = records.filter((entry) => entry.providerId === providerId);

    const exactRecord = records.find((entry) => entry.id === scopedId);
    if (exactRecord) {
        return {
            record: exactRecord,
            resolvedCredentialKey: normalizedCredentialKey,
        };
    }

    const matchingCredentialKey = normalizedCredentialKey
        ? providerRecords.find((entry) => deriveCredentialKey(undefined, entry.credentialKey) === normalizedCredentialKey)
        : null;
    if (matchingCredentialKey) {
        return {
            record: matchingCredentialKey,
            resolvedCredentialKey: deriveCredentialKey(undefined, matchingCredentialKey.credentialKey),
        };
    }

    const normalizedCompanyRnc = normalizeCredentialKey(companyInfo?.rnc);
    const matchingCompany = normalizedCompanyRnc
        ? providerRecords.find((entry) => normalizeCredentialKey(entry.companyRnc) === normalizedCompanyRnc)
        : null;
    if (matchingCompany) {
        return {
            record: matchingCompany,
            resolvedCredentialKey: deriveCredentialKey(undefined, matchingCompany.credentialKey),
        };
    }

    const defaultRecord = records.find((entry) => entry.id === defaultId);
    if (defaultRecord) {
        return {
            record: defaultRecord,
            resolvedCredentialKey: undefined,
        };
    }

    const fallbackRecord = pickNewestCredentialRecord(providerRecords);
    if (!fallbackRecord) return null;

    return {
        record: fallbackRecord,
        resolvedCredentialKey: deriveCredentialKey(undefined, fallbackRecord.credentialKey),
    };
};

const buildLocalCredentialMeta = async (
    providerId: FiscalProviderId,
    companyInfo?: CompanyInfo,
    credentialKey?: string
): Promise<FiscalCredentialMetaResponse | null> => {
    const resolved = await resolveLocalFiscalCredential(providerId, companyInfo, credentialKey);
    if (!resolved) return null;

    return {
        providerId,
        hasCredential: true,
        source: 'sqlite',
        resolvedCredentialKey: resolved.resolvedCredentialKey,
        updatedAt: resolved.record.updatedAt,
        label: resolved.record.label,
        availableSources: ['sqlite'],
        hasLocalCredential: true,
        hasSupabaseCredential: false,
        hasEnvCredential: false,
    };
};

const mergeCredentialMeta = (
    remote: FiscalCredentialMetaResponse,
    local: FiscalCredentialMetaResponse | null
): FiscalCredentialMetaResponse => {
    if (!local?.hasCredential) return remote;

    const availableSources = Array.from(new Set([
        ...(Array.isArray(local.availableSources) ? local.availableSources : []),
        ...(Array.isArray(remote.availableSources) ? remote.availableSources : []),
    ])) as Array<'env' | 'sqlite' | 'supabase'>;

    return {
        ...remote,
        hasCredential: remote.hasCredential || local.hasCredential,
        source: local.source || remote.source,
        resolvedCredentialKey: local.resolvedCredentialKey || remote.resolvedCredentialKey,
        updatedAt: local.updatedAt || remote.updatedAt,
        label: local.label || remote.label,
        availableSources,
        hasLocalCredential: true,
        hasSupabaseCredential: Boolean(remote.hasSupabaseCredential),
        hasEnvCredential: Boolean(remote.hasEnvCredential),
    };
};

const extractBaseUrlFromEndpoint = (endpoint: string): string | null => {
    try {
        const url = new URL(endpoint, window.location.origin);
        if (!/^https?:$/i.test(url.protocol)) return null;
        return `${url.protocol}//${url.host}`;
    } catch {
        return null;
    }
};

const resolveCloudMasterBase = async (): Promise<string | null> => {
    if (!isNativeAndroidRuntime()) return null;

    try {
        const endpoint = await resolveMasterEndpointFromCloud();
        if (!endpoint) return null;

        const directEndpoint = normalizeBaseUrl(endpoint.endpointUrl || null);
        if (directEndpoint) return directEndpoint;

        if (endpoint.localIp) {
            return normalizeBaseUrl(
                buildMasterUrlFromHost(endpoint.localIp, endpoint.port || 3001, endpoint.protocol || 'http')
            );
        }
    } catch (error) {
        console.warn('[fiscalService] No se pudo resolver el master desde cloud:', error);
    }

    return null;
};

const buildFiscalEndpointCandidates = async (
    path: string,
    options?: { localOnly?: boolean }
): Promise<string[]> => {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const fiscalPath = `/api/fiscal${normalizedPath}`;
    const env = (import.meta as any)?.env || {};

    const pinnedFiscalBase = normalizeBaseUrl(localStorage.getItem(FISCAL_BACKEND_BASE_KEY));
    const persistedMasterBase = normalizeBaseUrl(localStorage.getItem('CLIC_POS_MASTER_URL'));
    const persistedErpBase =
        normalizeBaseUrl(localStorage.getItem('CLIC_ERP_BASE_URL'))
        || normalizeBaseUrl(localStorage.getItem('erp_base_url'))
        || normalizeBaseUrl(env.VITE_ERP_BASE_URL)
        || normalizeBaseUrl(env.VITE_ERP_SYNC_API_URL)
        || normalizeBaseUrl(env.VITE_SYNC_API_URL);
    const runtimeMasterBase = normalizeBaseUrl(buildMasterUrlFromHost(window.location.hostname));
    const cloudMasterBase = await resolveCloudMasterBase();

    const erpCandidates = options?.localOnly
        ? []
        : uniqueStrings([
            persistedErpBase ? `${persistedErpBase}${fiscalPath}` : null,
        ]);
    const localCandidates = uniqueStrings([
        !options?.localOnly && pinnedFiscalBase ? `${pinnedFiscalBase}${fiscalPath}` : null,
        persistedMasterBase ? `${persistedMasterBase}${fiscalPath}` : null,
        cloudMasterBase ? `${cloudMasterBase}${fiscalPath}` : null,
        runtimeMasterBase ? `${runtimeMasterBase}${fiscalPath}` : null,
    ]);

    if (isNativeAndroidRuntime()) {
        return uniqueStrings([
            ...localCandidates,
            `${buildMasterUrlFromHost('127.0.0.1')}${fiscalPath}`,
            `${buildMasterUrlFromHost('10.0.2.2')}${fiscalPath}`,
            `${buildMasterUrlFromHost('10.0.3.2')}${fiscalPath}`,
            ...erpCandidates,
        ]);
    }

    return uniqueStrings([
        fiscalPath,
        ...localCandidates,
        ...erpCandidates,
    ]);
};

const buildDelegatedFiscalEndpointCandidates = async (path: string): Promise<string[]> => {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const fiscalPath = `/api/fiscal${normalizedPath}`;
    const env = (import.meta as any)?.env || {};
    const persistedErpBase =
        normalizeBaseUrl(localStorage.getItem('CLIC_ERP_BASE_URL'))
        || normalizeBaseUrl(localStorage.getItem('erp_base_url'))
        || normalizeBaseUrl(env.VITE_ERP_BASE_URL)
        || normalizeBaseUrl(env.VITE_ERP_SYNC_API_URL)
        || normalizeBaseUrl(env.VITE_SYNC_API_URL);
    const pinnedFiscalBase = normalizeBaseUrl(localStorage.getItem(FISCAL_BACKEND_BASE_KEY));
    const endpoints = uniqueStrings([
        persistedErpBase ? `${persistedErpBase}${fiscalPath}` : null,
        pinnedFiscalBase ? `${pinnedFiscalBase}${fiscalPath}` : null,
    ]);

    if (endpoints.length > 0) return endpoints;

    if (isNativeAndroidRuntime()) {
        return uniqueStrings([
            pinnedFiscalBase ? `${pinnedFiscalBase}${fiscalPath}` : null,
            `${buildMasterUrlFromHost('127.0.0.1')}${fiscalPath}`
        ]);
    }

    return uniqueStrings([
        fiscalPath,
        pinnedFiscalBase ? `${pinnedFiscalBase}${fiscalPath}` : null
    ]);
};

const readJsonPayload = async <T>(response: Response): Promise<{ payload: T | null; rawText: string }> => {
    const rawText = await response.text().catch(() => '');
    if (!rawText) {
        return { payload: null, rawText: '' };
    }

    try {
        return {
            payload: JSON.parse(rawText) as T,
            rawText,
        };
    } catch {
        return {
            payload: null,
            rawText,
        };
    }
};

const buildInvalidFiscalPayload = <T extends Record<string, any>>(status: number, seed: T): T => ({
    ...seed,
    success: false,
    message: `Respuesta inválida del backend fiscal (HTTP ${status}).`
});

const extractFiscalMessage = (payload: any): string => {
    const candidates = [
        payload?.message,
        payload?.mensaje,
        payload?.Message,
        payload?.descripcion,
        payload?.Description,
        payload?.StatusDescription,
        payload?.data?.message,
        payload?.data?.mensaje,
    ];

    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }

    return '';
};

const joinProviderMessages = (values: unknown[]): string => {
    const messages = values
        .flatMap((value) => {
            if (Array.isArray(value)) {
                return value.map(item => typeof item === 'string' ? item : JSON.stringify(item));
            }
            if (typeof value === 'string') return [value];
            if (value && typeof value === 'object') return [JSON.stringify(value)];
            return [];
        })
        .map(value => value.trim())
        .filter(Boolean);

    return Array.from(new Set(messages)).join(': ');
};

type DirectDigifactCredential = {
    token?: string;
    authToken?: string;
    environment?: string | number;
    Environment?: string | number;
    username?: string;
    Username?: string;
    user?: string;
    password?: string;
    Password?: string;
    taxId?: string;
    rnc?: string;
    establishmentCode?: string;
    establishment_code?: string;
    branchCode?: string;
    branch_code?: string;
    digifactEstablishmentCode?: string;
    digifactBranchCode?: string;
    cashierCode?: string;
    cashier_code?: string;
    posCode?: string;
    pos_code?: string;
    pointOfSaleCode?: string;
    point_of_sale_code?: string;
    terminalCode?: string;
    terminal_code?: string;
    caja?: string;
    cajaCode?: string;
    caja_code?: string;
    digifactCashierCode?: string;
    autoAssignSequence?: boolean | string | number;
    autogestionNuc?: boolean | string | number;
    useSequenceAssignment?: boolean | string | number;
    assignSequence?: boolean | string | number;
};

const parseDirectDigifactCredential = (authToken: string): DirectDigifactCredential => {
    const raw = authToken.trim();
    if (!raw) return {};
    if (raw.startsWith('{')) {
        try {
            return JSON.parse(raw) as DirectDigifactCredential;
        } catch {
            return { token: raw };
        }
    }
    return { token: raw };
};

const resolveDirectDigifactBaseUrl = (input: Pick<IssueFiscalDocumentInput, 'environment' | 'apiBaseUrl' | 'testUrl'>) => {
    const explicit = normalizeBaseUrl(input.apiBaseUrl || input.testUrl || null);
    if (explicit) return explicit.replace(/\/+$/, '');
    return Number(input.environment) === 1 ? DIGIFACT_PROD_BASE_URL : DIGIFACT_TEST_BASE_URL;
};

const isDirectDigifactTestCredential = (credential?: DirectDigifactCredential): boolean => {
    const username = cleanString(credential?.Username || credential?.username || credential?.user).toUpperCase();
    const environment = cleanString(credential?.Environment || credential?.environment).toUpperCase();
    return username.startsWith('TEST')
        || username.includes('.TEST')
        || ['0', '2', '3', 'TEST', 'SANDBOX', 'PRUEBA', 'PRUEBAS'].includes(environment);
};

const isDirectDigifactTestTarget = (
    input: Pick<IssueFiscalDocumentInput, 'environment' | 'apiBaseUrl' | 'testUrl' | 'issueUrl'>,
    credential?: DirectDigifactCredential
): boolean => {
    const baseUrl = resolveDirectDigifactBaseUrl(input).toLowerCase();
    const issueUrl = cleanString(input.issueUrl).toLowerCase();
    const testUrl = cleanString(input.testUrl).toLowerCase();
    return Number(input.environment) !== 1
        || baseUrl.includes('testnucdo')
        || issueUrl.includes('testnucdo')
        || testUrl.includes('testnucdo')
        || isDirectDigifactTestCredential(credential);
};

const appendDigifactPath = (baseOrUrl: string, fallbackPath: string): string => {
    const clean = baseOrUrl.replace(/\/+$/, '');
    if (clean.toLowerCase().endsWith(fallbackPath.toLowerCase())) return clean;
    return `${clean}${fallbackPath}`;
};

const resolveDirectDigifactIssueUrl = (
    input: Pick<IssueFiscalDocumentInput, 'environment' | 'apiBaseUrl' | 'testUrl' | 'issueUrl'>,
    credential?: DirectDigifactCredential
): string => {
    if (isDirectDigifactTestTarget(input, credential)) {
        return `${DIGIFACT_TEST_BASE_URL}/v2/transform/nuc_json`;
    }
    const baseUrl = resolveDirectDigifactBaseUrl(input);
    return appendDigifactPath(normalizeBaseUrl(input.issueUrl || null) || baseUrl, '/v2/transform/nuc_json');
};

const resolveDirectDigifactUsername = (credential: DirectDigifactCredential, taxId: string): string | undefined => {
    const rawUsername = cleanString(credential.Username || credential.username || credential.user);
    if (!rawUsername) return undefined;
    if (rawUsername.includes('.')) return rawUsername;
    return `DO.${taxId}.${rawUsername}`;
};

const resolveDirectDigifactQueryUsername = (username?: string): string | undefined => {
    if (!username) return undefined;
    return username;
};

const extractDirectDigifactToken = (payload: any): string => {
    const candidates = [
        payload?.token,
        payload?.Token,
        payload?.accessToken,
        payload?.AccessToken,
        payload?.data,
        payload?.Data,
        payload?.responseData,
        payload?.responseData1
    ];
    for (const candidate of candidates) {
        if (candidate != null && String(candidate).trim()) return String(candidate).trim();
    }
    return '';
};

const extractDirectDigifactMessage = (payload: any): string => {
    return joinProviderMessages([
        extractFiscalMessage(payload),
        payload?.description,
        payload?.Description,
        payload?.descripcion,
        payload?.infoDetails,
        payload?.error,
        payload?.errors
    ]);
};

const resolveDirectDigifactAuth = async (
    input: Pick<IssueFiscalDocumentInput, 'environment' | 'companyInfo' | 'credentialKey' | 'apiBaseUrl' | 'testUrl'>,
    authToken: string
): Promise<{ authorization: string; username?: string; taxId: string; source: 'token' | 'login' }> => {
    const credential = parseDirectDigifactCredential(authToken);
    const taxId = normalizeTaxId(credential.taxId || credential.rnc || input.companyInfo.rnc || input.credentialKey);
    const inlineToken = cleanString(credential.token || credential.authToken);
    const username = resolveDirectDigifactUsername(credential, taxId);
    const password = cleanString(credential.Password || credential.password);

    if (!taxId) {
        throw new Error('DigiFact requiere RNC/TAXID para emitir desde el POS.');
    }

    if (inlineToken && !password) {
        return {
            authorization: inlineToken,
            username: resolveDirectDigifactQueryUsername(username),
            taxId,
            source: 'token'
        };
    }

    if (!username || !password) {
        throw new Error('Para DigiFact local guarda un token vigente o credenciales JSON: {"taxId":"132752155","username":"TESTUSERTIK","password":"...","establishmentCode":"0001","cashierCode":"1"}');
    }

    const baseUrl = resolveDirectDigifactBaseUrl(input);
    const loginUrl = appendDigifactPath(baseUrl, '/login/get_token');
    const response = await CapacitorHttp.request({
        url: loginUrl,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        data: { Username: username, Password: password },
        connectTimeout: 10000,
        readTimeout: 15000,
        responseType: 'json'
    });
    const payload = response.data && typeof response.data === 'object' ? response.data : {};
    const token = extractDirectDigifactToken(payload);
    if (Number(response.status) >= 400 || !token) {
        throw new Error(
            `DigiFact auth HTTP ${response.status}: ${extractDirectDigifactMessage(payload) || 'Sin mensaje devuelto por DigiFact'} ` +
            `(ambiente=${Number(input.environment) === 1 ? 'produccion' : 'test'}, taxId=${taxId}, username=${resolveDirectDigifactQueryUsername(username)}, endpoint=${loginUrl})`
        );
    }

    return {
        authorization: token,
        username: resolveDirectDigifactQueryUsername(username),
        taxId,
        source: 'login'
    };
};

const directDigifactDocumentCode = (documentCode: string) => documentCode.replace(/^E/, '');

const directDigifactSequence = (encf: string, documentCode: string) => {
    const digits = encf.replace(new RegExp(`^E?${directDigifactDocumentCode(documentCode)}`, 'i'), '').replace(/\D/g, '');
    return (digits || encf.replace(/\D/g, '')).slice(-10).padStart(10, '0');
};

const mapDirectDigifactPaymentMethod = (method?: string): string => {
    const normalized = cleanString(method).toUpperCase();
    if (['CREDIT', 'CREDITO'].includes(normalized)) return '2';
    if (['GIFT', 'VOUCHER', 'STORE_CREDIT', 'CREDIT_NOTE', 'VALE_NC', 'GRATIS', 'GRATUITO'].includes(normalized)) return '3';
    return '1';
};

const mapDirectDigifactPaymentCode = (method?: string): string => {
    const normalized = cleanString(method).toUpperCase();
    if (['CASH', 'EFECTIVO'].includes(normalized)) return '1';
    if (['TRANSFER', 'WIRE', 'ACH', 'CHEQUE', 'CHECK', 'DEPOSITO'].includes(normalized)) return '2';
    if (['CARD', 'CREDIT_CARD', 'DEBIT_CARD', 'TARJETA'].includes(normalized)) return '3';
    if (['CREDIT', 'CREDITO'].includes(normalized)) return '4';
    if (['GIFT', 'VOUCHER', 'CERTIFICATE', 'BONO', 'REGALO'].includes(normalized)) return '5';
    if (['BARTER', 'PERMUTA'].includes(normalized)) return '6';
    if (['STORE_CREDIT', 'CREDIT_NOTE', 'VALE_NC', 'NOTA_CREDITO'].includes(normalized)) return '7';
    return '8';
};

const toDirectDigifactDateTime = (value?: string): string => {
    const date = value ? new Date(value) : new Date();
    const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
    const pad = (number: number) => String(number).padStart(2, '0');
    const offsetMinutes = -safeDate.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const absoluteOffset = Math.abs(offsetMinutes);
    return `${safeDate.getFullYear()}-${pad(safeDate.getMonth() + 1)}-${pad(safeDate.getDate())}` +
        `T${pad(safeDate.getHours())}:${pad(safeDate.getMinutes())}:${pad(safeDate.getSeconds())}` +
        `${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`;
};

const directDigifactInfoList = (items: Array<{ Name: string; Value: unknown }>) =>
    items
        .map(item => ({ Name: item.Name, Value: String(item.Value ?? '').trim() }))
        .filter(item => item.Name && item.Value)
        .map(item => ({ Name: item.Name, Data: null, Value: item.Value }));

const directDigifactOptionalInfoList = (items: Array<{ Name: string; Value: unknown }>) => {
    const list = directDigifactInfoList(items);
    return list.length > 0 ? list : undefined;
};

const directDigifactPhone = (phone: unknown): string => {
    const digits = String(phone || '').replace(/\D/g, '').slice(-10);
    const safeDigits = digits.length === 10 ? digits : '8090000000';
    return `${safeDigits.slice(0, 3)}-${safeDigits.slice(3, 6)}-${safeDigits.slice(6)}`;
};

const directDigifactContact = (phone: unknown, email?: unknown) => {
    const contact: any = {
        PhoneList: {
            Phone: [directDigifactPhone(phone)]
        }
    };
    const cleanEmail = cleanString(email).slice(0, 80);
    if (cleanEmail.includes('@')) {
        contact.EmailList = {
            Email: [cleanEmail]
        };
    }
    return contact;
};

const normalizeDirectDigifactBranchCode = (value: unknown): string =>
    String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

const resolveDirectDigifactBranchCode = (input: IssueFiscalDocumentInput, credential?: DirectDigifactCredential): string => {
    if (isDirectDigifactTestTarget(input, credential)) {
        return '0001';
    }
    const code = normalizeDirectDigifactBranchCode(
        input.establishmentCode
        || input.branchCode
        || (input.companyInfo as any).establishmentCode
        || (input.companyInfo as any).branchCode
    );
    if (!code) {
        throw new Error('DigiFact requiere el código de establecimiento/sucursal configurado en la terminal fiscal o en la credencial local. Agrega establishmentCode con el código exacto registrado en DigiFact/Hacienda.');
    }
    return code.slice(0, 20);
};

const normalizeDirectDigifactCashierCode = (value: unknown): string =>
    String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

const resolveDirectDigifactCashierCode = (input: IssueFiscalDocumentInput, credential?: DirectDigifactCredential): string => {
    if (isDirectDigifactTestTarget(input, credential)) {
        return '1';
    }
    const code = normalizeDirectDigifactCashierCode(
        input.cashierCode
        || (input.companyInfo as any).cashierCode
        || (input.companyInfo as any).posCode
        || (input.companyInfo as any).terminalCode
        || (input.companyInfo as any).caja
    );
    if (!code) {
        throw new Error('DigiFact requiere el código de caja/punto de emisión configurado en la terminal fiscal o en la credencial local.');
    }
    return code.slice(0, 60);
};

const directDigifactBranchInfo = (address: unknown, branchCode: string) => {
    const cleanAddress = cleanString(address).slice(0, 100) || 'Santo Domingo';
    return {
        Name: branchCode,
        AddressInfo: {
            Address: cleanAddress,
            Country: 'DO'
        }
    };
};

const directDigifactTipoIngreso = (value?: number): string => {
    const normalized = Math.trunc(Number(value || 1));
    const safe = normalized >= 1 && normalized <= 6 ? normalized : 1;
    return String(safe).padStart(2, '0');
};

const directDigifactIndicatorMontoGravado = (transaction: Transaction): string => {
    const raw = (transaction as any).isTaxIncluded ?? (transaction as any).taxIncluded ?? true;
    return raw === false ? '0' : '1';
};

const directDigifactFlagEnabled = (value: unknown): boolean => {
    if (value === true) return true;
    if (typeof value === 'number') return value === 1;
    const normalized = cleanString(value).toUpperCase();
    return ['1', 'TRUE', 'YES', 'SI', 'SÍ', 'Y'].includes(normalized);
};

const shouldUseDirectDigifactSequenceAssignment = (
    input: IssueFiscalDocumentInput,
    credential?: DirectDigifactCredential,
    options?: { forceLocalSequence?: boolean }
): boolean => {
    if (options?.forceLocalSequence) {
        return false;
    }
    if (isDirectDigifactTestTarget(input, credential)) {
        return true;
    }
    return directDigifactFlagEnabled(credential?.autoAssignSequence)
        || directDigifactFlagEnabled(credential?.autogestionNuc)
        || directDigifactFlagEnabled(credential?.useSequenceAssignment)
        || directDigifactFlagEnabled(credential?.assignSequence);
};

const buildDirectDigifactPayload = (
    input: IssueFiscalDocumentInput,
    credential?: DirectDigifactCredential,
    options?: { forceLocalSequence?: boolean }
) => {
    const { companyInfo, transaction } = input;
    const branchCode = resolveDirectDigifactBranchCode(input, credential);
    const cashierCode = resolveDirectDigifactCashierCode(input, credential);
    const documentCode = String(transaction.ncfType || '');
    const eNCF = cleanString(transaction.electronicNcf || transaction.ncf);
    const customer = (transaction.customerSnapshot || {}) as any;
    const total = round2(Math.abs(sanitizeNumber(transaction.total)));
    const taxAmount = round2(Math.abs(sanitizeNumber(transaction.taxAmount)));
    const netAmount = round2(Math.abs(sanitizeNumber(transaction.netAmount)) || Math.max(0, total - taxAmount));
    const taxRate = normalizePercentRate(input.taxRate, 18);
    const useSequenceAssignment = shouldUseDirectDigifactSequenceAssignment(input, credential, options);
    const sequenceInfo = useSequenceAssignment
        ? { Name: 'AsignacionDeSecuencia', Value: '1' }
        : { Name: 'Secuencia', Value: directDigifactSequence(eNCF, documentCode) };
    const items = (transaction.items || []).map((item: any) => {
        const quantity = Math.abs(sanitizeNumber(item.quantity)) || 1;
        const unitPrice = round2(Math.abs(sanitizeNumber(item.price)));
        const type = cleanString(item.type).toUpperCase() === 'SERVICE' ? 2 : 1;
        const taxIndicator = (Array.isArray(item.appliedTaxIds) && item.appliedTaxIds.length > 0) || taxAmount > 0 ? 1 : 4;
        const payloadItem: any = {
            Type: String(type),
            Description: (cleanString(item.name || item.id) || 'Item POS').slice(0, 80),
            Qty: quantity,
            Price: unitPrice,
            Totals: { TotalItem: round2(quantity * unitPrice) },
            AdditionalInfo: directDigifactInfoList([{ Name: 'IndicadorFacturacion', Value: String(taxIndicator) }])
        };
        const configuredUnitCode = Number(item.fiscalUnitCode || 0);
        if (Number.isFinite(configuredUnitCode) && configuredUnitCode > 0) {
            payloadItem.UnitOfMeasure = configuredUnitCode;
        }
        return payloadItem;
    });

    const payload: any = {
        Version: '1.0',
        CountryCode: 'DO',
        Header: {
            DocType: directDigifactDocumentCode(documentCode),
            IssuedDateTime: toDirectDigifactDateTime(transaction.date),
            AdditionalIssueDocInfo: directDigifactInfoList([
                sequenceInfo,
                { Name: 'IndicadorMontoGravado', Value: directDigifactIndicatorMontoGravado(transaction) },
                { Name: 'TipoIngresos', Value: directDigifactTipoIngreso(input.tipoIngreso) },
                { Name: 'TipoPago', Value: mapDirectDigifactPaymentMethod(transaction.payments?.[0]?.method) }
            ])
        },
        Seller: {
            TaxID: normalizeTaxId(companyInfo.rnc),
            Name: cleanString(companyInfo.name).slice(0, 150),
            Contact: directDigifactContact(companyInfo.phone, (companyInfo as any).email),
            BranchInfo: directDigifactBranchInfo(companyInfo.address, branchCode),
            AdditionalInfo: directDigifactInfoList([
                { Name: 'CodigoVendedor', Value: cashierCode },
                { Name: 'NumeroFacturaInterna', Value: cleanString(transaction.displayId || transaction.id).slice(0, 20) }
            ])
        },
        Items: items,
        Totals: {
            QtyItems: items.length,
            TotalTaxableAmount: taxAmount > 0 ? netAmount : 0,
            TotalTaxes: taxAmount > 0
                ? { TotalTax: [{ Code: 'ITBIS1', TaxableAmount: netAmount, Rate: taxRate, Amount: taxAmount }] }
                : { TotalTax: [{ Code: 'EXENTO', TaxableAmount: netAmount, Amount: 0 }] },
            GrandTotal: { InvoiceTotal: total }
        },
        Payments: [{
            Code: mapDirectDigifactPaymentCode(transaction.payments?.[0]?.method),
            Amount: total
        }]
    };

    const buyerTaxId = normalizeTaxId(customer.taxId || customer.rnc || (transaction as any).customerTaxId);
    const buyerName = cleanString(customer.name || transaction.customerName);
    payload.Buyer = {
        TaxID: buyerTaxId || 'NO_APLICA',
        Name: (buyerName || 'Consumidor final').slice(0, 150)
    };

    if (input.sequenceExpiryDate && documentCode !== 'E32' && documentCode !== 'E34') {
        payload.Header.AdditionalIssueDocInfo.push({ Name: 'FechaVencimientoSecuencia', Data: null, Value: input.sequenceExpiryDate.slice(0, 10) });
    }

    if (documentCode === 'E34') {
        const referenceInfo = directDigifactOptionalInfoList([
            { Name: 'NCFModificado', Value: cleanString(transaction.affectedNCF || transaction.affectedInvoiceNumber) },
            { Name: 'FechaNCFModificado', Value: cleanString(transaction.affectedInvoiceDate).slice(0, 10) },
            { Name: 'CodigoModificacion', Value: String(input.modificationCode || 2) },
            { Name: 'RazonModificacion', Value: (cleanString(transaction.refundReason) || 'Nota de crédito generada desde POS').slice(0, 90) }
        ]);
        if (referenceInfo) {
            payload.AdditionalDocumentInfo = {
                AdditionalInfo: {
                    AditionalData: {
                        Data: [{
                            Name: 'INFORMACION_REFERENCIA',
                            Info: referenceInfo
                        }]
                    }
                }
            };
        }
    }

    return payload;
};

const extractDirectDigifactProviderId = (payload: any, fallbackENCF?: string): string | undefined => {
    const candidates = [
        payload?.batch,
        payload?.Batch,
        payload?.eNCF,
        payload?.encf,
        payload?.authNumber,
        payload?.AuthNumber,
        payload?.authorizationNumber,
        fallbackENCF
    ];
    for (const candidate of candidates) {
        if (candidate != null && String(candidate).trim()) return String(candidate).trim();
    }
    return undefined;
};

const isDirectDigifactFailure = (payload: any, message: string): boolean => {
    if (payload?.success === false || payload?.ok === false) return true;
    if (Array.isArray(payload?.infoDetails) && payload.infoDetails.length > 0) return true;
    const code = Number(payload?.code ?? payload?.Code);
    return (Number.isFinite(code) && code !== 1) ||
        /rechaz|error|failed|invalid|invalido|inválido|no coincide|esquema\s+nuc|schema/i.test(message);
};

const isDirectDigifactSequenceUnavailable = (message: string): boolean =>
    /no se pudo obtener la secuencia|secuencias disponibles|secuencia.*disponible/i.test(message);

const directDigifactPayloadSequenceMode = (payload: any): string =>
    payload?.Header?.AdditionalIssueDocInfo?.find?.((item: any) => item.Name === 'AsignacionDeSecuencia')
        ? 'autogestion'
        : 'local';

const issueDirectDigifactDocument = async (
    input: IssueFiscalDocumentInput,
    authToken: string
): Promise<FiscalIssueResponse> => {
    const credential = parseDirectDigifactCredential(authToken);
    const auth = await resolveDirectDigifactAuth(input, authToken);
    const isTestTarget = isDirectDigifactTestTarget(input, credential);
    const issueUrl = resolveDirectDigifactIssueUrl(input, credential);
    const url = new URL(issueUrl);
    url.searchParams.set('TAXID', auth.taxId);
    url.searchParams.set('FORMAT', 'XML|HTML|PDF');
    if (auth.username) url.searchParams.set('USERNAME', auth.username);

    const issueInput: IssueFiscalDocumentInput = {
        ...input,
        establishmentCode: isTestTarget ? '0001' : input.establishmentCode || credential.establishmentCode || credential.establishment_code || credential.digifactEstablishmentCode,
        branchCode: isTestTarget ? '0001' : input.branchCode || credential.branchCode || credential.branch_code || credential.digifactBranchCode,
        cashierCode: isTestTarget ? '1' : input.cashierCode
            || credential.cashierCode
            || credential.cashier_code
            || credential.posCode
            || credential.pos_code
            || credential.pointOfSaleCode
            || credential.point_of_sale_code
            || credential.terminalCode
            || credential.terminal_code
            || credential.caja
            || credential.cajaCode
            || credential.caja_code
            || credential.digifactCashierCode
    };

    const sendIssuePayload = (payload: any) => CapacitorHttp.request({
        url: url.toString(),
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: auth.authorization
        },
        data: payload,
        connectTimeout: 10000,
        readTimeout: 30000,
        responseType: 'json'
    });

    let issuePayload = buildDirectDigifactPayload(issueInput, credential);
    let response = await sendIssuePayload(issuePayload);
    let raw = response.data && typeof response.data === 'object' ? response.data : {};
    let providerMessage = extractDirectDigifactMessage(raw) || (Number(response.status) < 400 ? 'DigiFact procesó la emisión.' : `DigiFact HTTP ${response.status}`);
    let sequenceMode = directDigifactPayloadSequenceMode(issuePayload);
    let failure = Number(response.status) >= 400 || isDirectDigifactFailure(raw, providerMessage);

    if (isTestTarget && sequenceMode === 'autogestion' && failure && isDirectDigifactSequenceUnavailable(providerMessage)) {
        const autogestionMessage = providerMessage;
        issuePayload = buildDirectDigifactPayload(issueInput, credential, { forceLocalSequence: true });
        response = await sendIssuePayload(issuePayload);
        raw = response.data && typeof response.data === 'object' ? response.data : {};
        providerMessage = extractDirectDigifactMessage(raw) || (Number(response.status) < 400 ? 'DigiFact procesó la emisión.' : `DigiFact HTTP ${response.status}`);
        sequenceMode = 'local-fallback';
        failure = Number(response.status) >= 400 || isDirectDigifactFailure(raw, providerMessage);
        if (failure) {
            providerMessage = `${providerMessage} [Autogestión no disponible: ${autogestionMessage}]`;
        }
    }

    const diagnostic = isTestTarget
        ? ` [DigiFact test: endpoint=oficial, establecimiento=${issuePayload?.Seller?.BranchInfo?.Name || 'N/D'}, caja=${issuePayload?.Seller?.AdditionalInfo?.find?.((item: any) => item.Name === 'CodigoVendedor')?.Value || 'N/D'}, username=${auth.username || 'N/D'}, secuencia=${sequenceMode}]`
        : '';
    const message = `${providerMessage}${diagnostic}`;
    const providerTransactionId = extractDirectDigifactProviderId(raw, cleanString(input.transaction.electronicNcf || input.transaction.ncf));

    return {
        success: !failure,
        providerId: 'DIGIFACT',
        environment: input.environment,
        documentCode: input.transaction.ncfType as FiscalIssueResponse['documentCode'],
        providerTransactionId,
        status: failure ? 'Rechazado' : 'Aceptado',
        message,
        pending: false,
        raw
    };
};

const getDirectDigifactStatus = async (
    providerId: FiscalProviderId,
    environment: number,
    providerTransactionId: string,
    companyInfo: CompanyInfo | undefined,
    credentialKey: string | undefined,
    authToken: string
): Promise<FiscalStatusResponse> => {
    const auth = await resolveDirectDigifactAuth({ environment, companyInfo: companyInfo || {} as CompanyInfo, credentialKey }, authToken);
    const url = new URL(`${Number(environment) === 1 ? DIGIFACT_PROD_BASE_URL : DIGIFACT_TEST_BASE_URL}/SHAREDINFO`);
    url.searchParams.set('TAXID', auth.taxId);
    if (auth.username) url.searchParams.set('USERNAME', auth.username);
    url.searchParams.set('DATA1', 'SHARED_GETRESULTADOENVIO');
    url.searchParams.set('DATA2', `ENCF|${providerTransactionId}`);
    const response = await CapacitorHttp.request({
        url: url.toString(),
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: auth.authorization },
        connectTimeout: 10000,
        readTimeout: 15000,
        responseType: 'json'
    });
    const raw = response.data && typeof response.data === 'object' ? response.data : {};
    const message = extractDirectDigifactMessage(raw) || `DigiFact status HTTP ${response.status}`;
    const pending = /en espera|procesando|pendiente/i.test(message);
    return {
        success: Number(response.status) < 400 && !isDirectDigifactFailure(raw, message),
        providerId,
        environment,
        providerTransactionId,
        status: pending ? 'Pendiente' : Number(response.status) < 400 ? 'Consultado' : 'Error',
        message,
        pending,
        raw
    };
};

type FiscalHttpResponse = {
    ok: boolean;
    status: number;
};

const fetchFiscalWithTimeout = async (input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> => {
    if (typeof AbortController === 'undefined') {
        return fetch(input, init);
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(input, {
            ...init,
            signal: controller.signal,
        });
    } finally {
        window.clearTimeout(timeoutId);
    }
};

const requestFiscalNativeJson = async <T extends Record<string, any>>(
    endpoint: string,
    init: RequestInit,
    timeoutMs: number
): Promise<{ response: FiscalHttpResponse; payload: T | null; rawText: string }> => {
    const method = String(init.method || 'GET').toUpperCase();
    const headers = Object.fromEntries(
        Object.entries(init.headers || {}).map(([key, value]) => [key, String(value)])
    );
    const body = typeof init.body === 'string'
        ? (() => {
            try {
                return JSON.parse(init.body);
            } catch {
                return init.body;
            }
        })()
        : undefined;

    const nativeResponse = await CapacitorHttp.request({
        url: endpoint,
        method,
        headers,
        data: body,
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
        responseType: 'json',
    });

    const rawData = nativeResponse.data;
    const payload = rawData && typeof rawData === 'object'
        ? (rawData as T)
        : null;
    const rawText = typeof rawData === 'string'
        ? rawData
        : rawData == null
            ? ''
            : JSON.stringify(rawData);

    return {
        response: {
            ok: nativeResponse.status >= 200 && nativeResponse.status < 300,
            status: nativeResponse.status,
        },
        payload,
        rawText,
    };
};

const requestFiscalJson = async <T extends Record<string, any>>(
    path: string,
    init: RequestInit,
    invalidPayloadFactory: (status: number) => T,
    options?: { delegatedToErp?: boolean; localOnly?: boolean }
): Promise<{ response: FiscalHttpResponse; payload: T }> => {
    const endpoints = options?.delegatedToErp
        ? await buildDelegatedFiscalEndpointCandidates(path)
        : await buildFiscalEndpointCandidates(path, { localOnly: options?.localOnly });
    let lastInvalid: { response: FiscalHttpResponse; payload: T } | null = null;
    let lastError: Error | null = null;
    const timeoutMs = isNativeAndroidRuntime() ? 2200 : 5000;

    for (const endpoint of endpoints) {
        try {
            const { response, payload, rawText } = isNativeAndroidRuntime()
                ? await requestFiscalNativeJson<T>(endpoint, init, timeoutMs)
                : await (async () => {
                    const response = await fetchFiscalWithTimeout(endpoint, init, timeoutMs);
                    const parsed = await readJsonPayload<T>(response);
                    return { response, payload: parsed.payload, rawText: parsed.rawText };
                })();

            if (payload && typeof payload === 'object') {
                const unsupportedLocalProvider =
                    options?.delegatedToErp
                    && payload.success === false
                    && /proveedor fiscal (inv[aá]lido|no soportado)/i.test(String(payload.message || ''));
                if (unsupportedLocalProvider) {
                    lastInvalid = {
                        response,
                        payload
                    };
                    continue;
                }
                const resolvedBase = extractBaseUrlFromEndpoint(endpoint);
                if (resolvedBase && !options?.delegatedToErp) {
                    localStorage.setItem(FISCAL_BACKEND_BASE_KEY, resolvedBase);
                }
                return { response, payload };
            }

            lastInvalid = {
                response,
                payload: invalidPayloadFactory(response.status),
            };

            const trimmed = rawText.trim().toLowerCase();
            const looksLikeHtml =
                trimmed.startsWith('<!doctype html')
                || trimmed.startsWith('<html')
                || trimmed.startsWith('<');

            if (response.ok && looksLikeHtml) {
                continue;
            }
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
        }
    }

    if (lastInvalid) {
        return lastInvalid;
    }

    throw lastError || new Error('No se pudo contactar el backend fiscal.');
};

export const issueFiscalDocument = async (
    input: IssueFiscalDocumentInput
): Promise<FiscalIssueResponse> => {
    if (!input.transaction.ncfType || !String(input.transaction.ncfType).startsWith('E')) {
        throw new Error('Solo se pueden emitir documentos electrónicos con esta ruta.');
    }

    const localCredential = await resolveLocalFiscalCredential(
        input.providerId,
        input.companyInfo,
        input.credentialKey
    );
    const isLocalDirectDigiFact = input.providerId === 'DIGIFACT' && Boolean(localCredential?.record.authToken);
    const isDelegatedProvider =
        input.providerId === 'DIGIFACT'
        && input.deliveryMode === 'DELEGATED_ERP'
        && !localCredential?.record.authToken;

    if (isLocalDirectDigiFact && isNativeAndroidRuntime() && localCredential?.record.authToken) {
        return issueDirectDigifactDocument(input, localCredential.record.authToken);
    }

    const { response, payload } = await requestFiscalJson<FiscalIssueResponse>(
        '/documents/issue',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                providerId: input.providerId,
                environment: input.environment,
                documentCode: input.transaction.ncfType,
                authToken: localCredential?.record.authToken,
                companyInfo: input.companyInfo,
                transaction: input.transaction,
                options: {
                    taxRate: input.taxRate,
                    sequenceExpiryDate: input.sequenceExpiryDate,
                    credentialKey: input.credentialKey,
                    tipoIngreso: input.tipoIngreso,
                    modificationCode: input.modificationCode,
                    unitCodeGoods: input.unitCodeGoods,
                    unitCodeServices: input.unitCodeServices,
                    deliveryMode: input.deliveryMode,
                    apiBaseUrl: input.apiBaseUrl,
                    testUrl: input.testUrl,
                    issueUrl: input.issueUrl,
                    statusUrl: input.statusUrl,
                    establishmentCode: input.establishmentCode,
                    branchCode: input.branchCode,
                    branchName: input.branchName,
                    cashierCode: input.cashierCode
                }
            })
        },
        (status) => buildInvalidFiscalPayload(status, {
            success: false,
            providerId: input.providerId,
            environment: input.environment,
            documentCode: input.transaction.ncfType as FiscalIssueResponse['documentCode'],
            message: ''
        }),
        { delegatedToErp: isDelegatedProvider, localOnly: isLocalDirectDigiFact }
    );

    if (!response.ok && payload?.success !== false) {
        throw new Error(payload?.message || `Error fiscal HTTP ${response.status}`);
    }

    return payload as FiscalIssueResponse;
};

export const getFiscalDocumentStatus = async (
    providerId: FiscalProviderId,
    environment: number,
    providerTransactionId: string,
    companyInfo?: CompanyInfo,
    credentialKey?: string,
    deliveryMode?: FiscalProviderDeliveryMode
): Promise<FiscalStatusResponse> => {
    const localCredential = await resolveLocalFiscalCredential(providerId, companyInfo, credentialKey);
    const isLocalDirectDigiFact = providerId === 'DIGIFACT' && Boolean(localCredential?.record.authToken);
    const isDelegatedProvider =
        providerId === 'DIGIFACT'
        && deliveryMode === 'DELEGATED_ERP'
        && !localCredential?.record.authToken;
    const params = new URLSearchParams({
        providerId,
        environment: String(environment),
        providerTransactionId
    });
    if (companyInfo?.rnc) params.set('companyRnc', companyInfo.rnc);
    if (credentialKey) params.set('credentialKey', credentialKey);

    if (isLocalDirectDigiFact && isNativeAndroidRuntime() && localCredential?.record.authToken) {
        return getDirectDigifactStatus(
            providerId,
            environment,
            providerTransactionId,
            companyInfo,
            credentialKey,
            localCredential.record.authToken
        );
    }

    const { response, payload } = await requestFiscalJson<FiscalStatusResponse>(
        `/documents/status?${params.toString()}`,
        {
            method: 'GET',
            headers: localCredential?.record.authToken
                ? { 'X-Fiscal-AuthToken': localCredential.record.authToken }
                : undefined,
        },
        (status) => buildInvalidFiscalPayload(status, {
            success: false,
            providerId,
            environment,
            providerTransactionId,
            message: ''
        }),
        { delegatedToErp: isDelegatedProvider, localOnly: isLocalDirectDigiFact }
    );

    if (!response.ok && payload?.success !== false) {
        throw new Error(payload?.message || `Error fiscal HTTP ${response.status}`);
    }

    return {
        ...(payload as FiscalStatusResponse),
        pending: /en espera|procesando|pendiente/i.test(String((payload as any)?.status || '')) || /en espera|procesando|pendiente/i.test(String((payload as any)?.message || ''))
    };
};

export const testFiscalProviderConnection = async (
    providerId: FiscalProviderId,
    environment: number,
    companyInfo?: CompanyInfo,
    credentialKey?: string,
    endpointOptions?: {
        apiBaseUrl?: string;
        testUrl?: string;
        issueUrl?: string;
        statusUrl?: string;
    }
) => {
    const localCredential = await resolveLocalFiscalCredential(providerId, companyInfo, credentialKey);
    if (providerId === 'DIGIFACT' && isNativeAndroidRuntime() && localCredential?.record.authToken) {
        const auth = await resolveDirectDigifactAuth(
            {
                environment,
                companyInfo: companyInfo || {} as CompanyInfo,
                credentialKey,
                apiBaseUrl: endpointOptions?.apiBaseUrl,
                testUrl: endpointOptions?.testUrl
            },
            localCredential.record.authToken
        );
        return {
            success: true,
            message: auth.source === 'login'
                ? 'Autenticación con DigiFact completada correctamente.'
                : 'Token local DigiFact disponible. La validación final ocurre al emitir el NUC.',
            providerId,
            environment,
            credentialSource: 'sqlite',
            resolvedCredentialKey: localCredential.resolvedCredentialKey || credentialKey || normalizeTaxId(companyInfo?.rnc),
            raw: {
                source: auth.source,
                taxId: auth.taxId,
                username: auth.username || null
            }
        };
    }
    const testDirectPolaris = async () => {
        if (providerId !== 'POLARIS' || !localCredential?.record.authToken) {
            throw new Error('No se pudo contactar el backend fiscal.');
        }

        if (!isNativeAndroidRuntime()) {
            throw new Error('El token está guardado en SQLite, pero la prueba remota necesita acceso al backend fiscal en el puerto 3001.');
        }

        const response = await CapacitorHttp.get({
            url: `${POLARIS_API_BASE}/autenticacion/token`,
            params: {
                authtoken: localCredential.record.authToken,
            },
            readTimeout: 6000,
            connectTimeout: 6000,
            headers: {
                Accept: 'application/json',
            },
        });
        const payload = response.data;
        const accessToken = String(payload?.data || payload?.token || payload?.accessToken || '').trim();
        const message = extractFiscalMessage(payload) || `Polaris auth HTTP ${response.status}`;

        if (Number(response.status) >= 400) {
            throw new Error(message);
        }

        if (!accessToken) {
            throw new Error(message || 'Polaris no devolvió Access Token.');
        }

        return {
            success: true,
            message: 'Autenticación con Polaris completada correctamente.',
            providerId,
            environment,
            credentialSource: 'sqlite',
            resolvedCredentialKey: localCredential.resolvedCredentialKey,
            raw: payload,
        };
    };

    try {
        const { response, payload } = await requestFiscalJson<{ success: boolean; message: string; providerId?: FiscalProviderId; environment?: number; credentialSource?: string; resolvedCredentialKey?: string; raw?: unknown }>(
            '/providers/test',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    providerId,
                    environment,
                    authToken: localCredential?.record.authToken,
                    companyInfo,
                    options: {
                        credentialKey,
                        apiBaseUrl: endpointOptions?.apiBaseUrl,
                        testUrl: endpointOptions?.testUrl,
                        issueUrl: endpointOptions?.issueUrl,
                        statusUrl: endpointOptions?.statusUrl
                    }
                })
            },
            (status) => buildInvalidFiscalPayload(status, {
                success: false,
                message: ''
            })
        );

        const backendLooksUnavailable = !response.ok || /backend fiscal/i.test(String(payload?.message || ''));
        if (backendLooksUnavailable && providerId === 'POLARIS' && localCredential?.record.authToken) {
            return await testDirectPolaris();
        }

        if (!response.ok && payload?.success !== false) {
            throw new Error(payload?.message || `Error fiscal HTTP ${response.status}`);
        }

        return payload;
    } catch (error) {
        if (providerId === 'POLARIS' && localCredential?.record.authToken) {
            return await testDirectPolaris();
        }
        throw error;
    }
};

export const getFiscalCredentialMetadata = async (
    providerId: FiscalProviderId,
    companyInfo?: CompanyInfo,
    credentialKey?: string
): Promise<FiscalCredentialMetaResponse> => {
    const localMeta = await buildLocalCredentialMeta(providerId, companyInfo, credentialKey);
    if (localMeta?.hasCredential) {
        return localMeta;
    }
    const params = new URLSearchParams({ providerId });
    if (companyInfo?.rnc) params.set('companyRnc', companyInfo.rnc);
    if (credentialKey) params.set('credentialKey', credentialKey);

    try {
        const { response, payload } = await requestFiscalJson<FiscalCredentialMetaResponse>(
            `/credentials/meta?${params.toString()}`,
            {
                method: 'GET',
            },
            (status) => buildInvalidFiscalPayload(status, {
                providerId,
                hasCredential: false
            } as FiscalCredentialMetaResponse)
        );

        if (!response.ok) {
            throw new Error((payload as any)?.message || `Error consultando credencial fiscal (HTTP ${response.status})`);
        }

        return mergeCredentialMeta(payload as FiscalCredentialMetaResponse, localMeta);
    } catch (error) {
        if (localMeta?.hasCredential) {
            return localMeta;
        }
        throw error;
    }
};

export const saveLocalFiscalCredential = async (
    providerId: FiscalProviderId,
    authToken: string,
    companyInfo?: CompanyInfo,
    credentialKey?: string,
    label?: string
): Promise<FiscalCredentialMutationResponse> => {
    const normalizedToken = String(authToken || '').trim();
    if (!normalizedToken) {
        throw new Error('Ingresa un Authentication Token válido.');
    }

    const resolvedCredentialKey = deriveCredentialKey(companyInfo, credentialKey);
    const baseRecord: LocalFiscalCredentialRecord = {
        id: buildLocalCredentialRecordId(providerId, resolvedCredentialKey),
        providerId,
        companyRnc: companyInfo?.rnc,
        credentialKey: resolvedCredentialKey,
        authToken: normalizedToken,
        label: String(label || '').trim() || undefined,
        updatedAt: new Date().toISOString(),
    };

    const recordsToPersist: LocalFiscalCredentialRecord[] = [
        baseRecord,
        {
            ...baseRecord,
            id: buildLocalCredentialRecordId(providerId),
            credentialKey: undefined,
        }
    ];

    for (const record of recordsToPersist) {
        await db.saveDocument(LOCAL_FISCAL_CREDENTIAL_COLLECTION as any, record);
    }

    const localMeta = await buildLocalCredentialMeta(providerId, companyInfo, credentialKey);
    return {
        success: true,
        message: 'Credencial fiscal guardada en SQLite.',
        meta: localMeta || undefined,
    };
};

export const saveSupabaseFiscalCredential = async (
    providerId: FiscalProviderId,
    authToken: string,
    companyInfo?: CompanyInfo,
    credentialKey?: string
): Promise<FiscalCredentialMutationResponse> => {
    const { response, payload } = await requestFiscalJson<FiscalCredentialMutationResponse>(
        '/credentials/supabase',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                providerId,
                authToken,
                companyInfo,
                options: {
                    credentialKey
                }
            })
        },
        (status) => buildInvalidFiscalPayload(status, {
            success: false,
            message: ''
        })
    );

    if (!response.ok) {
        throw new Error((payload as any)?.message || `Error guardando credencial fiscal en Supabase (HTTP ${response.status})`);
    }

    return payload as FiscalCredentialMutationResponse;
};

export const deleteLocalFiscalCredential = async (
    providerId: FiscalProviderId,
    companyInfo?: CompanyInfo,
    credentialKey?: string
): Promise<FiscalCredentialMutationResponse> => {
    const resolvedCredentialKey = deriveCredentialKey(companyInfo, credentialKey);
    await db.deleteDocument(LOCAL_FISCAL_CREDENTIAL_COLLECTION as any, buildLocalCredentialRecordId(providerId, resolvedCredentialKey));
    await db.deleteDocument(LOCAL_FISCAL_CREDENTIAL_COLLECTION as any, buildLocalCredentialRecordId(providerId));
    const localMetaAfterDelete = await buildLocalCredentialMeta(providerId, companyInfo, credentialKey);
    return {
        success: true,
        message: 'Credencial fiscal local eliminada de SQLite.',
        meta: localMetaAfterDelete || {
            providerId,
            hasCredential: false,
            availableSources: [],
            hasLocalCredential: false,
            hasSupabaseCredential: false,
            hasEnvCredential: false,
        },
    };
};

export const deleteSupabaseFiscalCredential = async (
    providerId: FiscalProviderId,
    companyInfo?: CompanyInfo,
    credentialKey?: string
): Promise<FiscalCredentialMutationResponse> => {
    const { response, payload } = await requestFiscalJson<FiscalCredentialMutationResponse>(
        '/credentials/supabase',
        {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                providerId,
                companyInfo,
                options: {
                    credentialKey
                }
            })
        },
        (status) => buildInvalidFiscalPayload(status, {
            success: false,
            message: ''
        })
    );

    if (!response.ok) {
        throw new Error((payload as any)?.message || `Error eliminando credencial fiscal en Supabase (HTTP ${response.status})`);
    }

    return payload as FiscalCredentialMutationResponse;
};
