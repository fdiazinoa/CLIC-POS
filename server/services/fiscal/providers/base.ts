export type FiscalProviderId = 'POLARIS';
export type ElectronicDocumentCode = 'E31' | 'E32' | 'E34' | 'E44' | 'E45';
export type FiscalCredentialSource = 'env' | 'sqlite' | 'supabase';

export interface FiscalCompanyInfo {
    name: string;
    rnc: string;
    phone?: string;
    address?: string;
    email?: string;
    website?: string;
}

export interface FiscalCustomerSnapshot {
    name?: string;
    taxId?: string;
    address?: string;
    phone?: string;
    email?: string;
}

export interface FiscalTransactionItem {
    id?: string;
    name?: string;
    type?: string;
    measurementUnit?: string;
    fiscalUnitCode?: number;
    quantity?: number;
    price?: number;
    appliedTaxIds?: string[];
}

export interface FiscalPaymentInput {
    method?: string;
    amount?: number;
}

export interface FiscalTransactionInput {
    id: string;
    displayId?: string;
    date: string;
    dueDate?: string;
    total: number;
    netAmount?: number;
    taxAmount?: number;
    discountAmount?: number;
    isTaxIncluded?: boolean;
    ncf?: string;
    ncfType?: string;
    electronicNcf?: string;
    customerName?: string;
    customerSnapshot?: FiscalCustomerSnapshot;
    items: FiscalTransactionItem[];
    payments?: FiscalPaymentInput[];
    refundReason?: string;
    affectedNCF?: string;
    affectedInvoiceNumber?: string;
    affectedInvoiceDate?: string;
}

export interface FiscalIssueOptions {
    taxRate?: number;
    sequenceExpiryDate?: string;
    credentialKey?: string;
    authToken?: string;
    tipoIngreso?: number;
    modificationCode?: number;
    unitCodeGoods?: number;
    unitCodeServices?: number;
}

export interface FiscalDocumentIssueRequest {
    environment: number;
    documentCode: ElectronicDocumentCode;
    companyInfo: FiscalCompanyInfo;
    transaction: FiscalTransactionInput;
    options?: FiscalIssueOptions;
}

export interface FiscalProviderTestResult {
    success: boolean;
    providerId: FiscalProviderId;
    environment: number;
    message: string;
    credentialSource?: FiscalCredentialSource;
    resolvedCredentialKey?: string;
    raw?: unknown;
}

export interface FiscalProviderTestRequest {
    environment: number;
    companyInfo?: FiscalCompanyInfo;
    credentialKey?: string;
    authToken?: string;
}

export interface FiscalDocumentIssueResult {
    success: boolean;
    providerId: FiscalProviderId;
    environment: number;
    documentCode: ElectronicDocumentCode;
    providerTransactionId?: string;
    status?: string;
    message: string;
    pending?: boolean;
    raw?: unknown;
}

export interface FiscalStatusResult {
    success: boolean;
    providerId: FiscalProviderId;
    environment: number;
    providerTransactionId: string;
    status?: string;
    message: string;
    raw?: unknown;
}

export interface FiscalStatusRequest {
    environment: number;
    providerTransactionId: string;
    companyRnc?: string;
    credentialKey?: string;
    authToken?: string;
}

export interface FiscalProvider {
    readonly id: FiscalProviderId;
    testConnection(request: FiscalProviderTestRequest): Promise<FiscalProviderTestResult>;
    issueDocument(request: FiscalDocumentIssueRequest): Promise<FiscalDocumentIssueResult>;
    getStatus(request: FiscalStatusRequest): Promise<FiscalStatusResult>;
}
