import type { Transaction, CartItem } from '../../types';
import type { FiscalWorkflowScope, FiscalWorkflowCheckoutV2, FiscalWorkflowPermitV2 } from './FiscalWorkflowV2Types';
import { sha256Utf8 } from '../sync/LargeMasterSyncV3Client';
export const RETURN_PROFILE = 'ORDINARY_RETURN_DOP_V1' as const;
export const canonicalReturn = (v: any): any => Array.isArray(v) ? v.map(canonicalReturn) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => [k, canonicalReturn(v[k])])) : v;
export const returnJSON = (v: unknown) => JSON.stringify(canonicalReturn(v));
export const returnDigest = (value: unknown) => sha256Utf8(returnJSON({ schemaVersion: 1, source: 'ERP_POS_FISCAL_RETURN_V1', value }));
export const returnNeed = (ok: unknown, code = 'FISCAL_RETURN_PROOF_INVALID'): void => { if (!ok)
    throw Error(code); };
export type ReturnReference = NonNullable<FiscalWorkflowPermitV2['originalReference']>;
export interface ReturnCommand {
    schemaVersion: 1;
    capability: 'fiscalReturnV1';
    operationId: string;
    checkoutId: string;
    transactionId: string;
    authorizationId: string;
    authorityHash: string;
    originalReference: ReturnReference;
    lines: Array<{
        cartId: string;
        quantity: number;
        stockDisposition: 'RESTOCK' | 'DAMAGED' | 'SERVICE';
    }>;
    payments: Array<{
        id: string;
        methodId: string;
        amount: number;
        currency: 'DOP';
    }>;
    financialEventId: string;
    inventoryMovementIds: string[];
}
export interface ReturnContract {
    schemaVersion: 1;
    profile: typeof RETURN_PROFILE;
    preparationId: string;
    returnSnapshotDigest: string;
    originalReference: ReturnReference;
    localCommittedAt: string;
}
export interface ReturnPreparation {
    schemaVersion: 1;
    profile: typeof RETURN_PROFILE;
    preparationId: string;
    operationId: string;
    checkoutId: string;
    transactionId: string;
    financialEventId: string;
    inventoryMovementIds: string[];
    authorizationId: string;
    authorityHash: string;
    scope: FiscalWorkflowScope;
    environment: number;
    issuerRnc: string;
    originalReference: ReturnReference;
    originalProofDigest: string;
    returnSnapshot: Record<string, any>;
    returnSnapshotDigest: string;
    reservationState: 'PREPARED';
    preparedAt: string;
    expiresAt: string;
}
export interface ReturnAttempt {
    id: string;
    slot: string;
    scope: FiscalWorkflowScope;
    intent: string;
    operationId: string;
    financialEventId: string;
    paymentEventId: string;
    paymentIds: string[];
    phase: 'WAITING_AUTHORITY' | 'PREPARING' | 'PREPARED' | 'SEALED' | 'COMMITTED';
    checkout?: FiscalWorkflowCheckoutV2;
    commandBytes?: string;
    preparation?: ReturnPreparation;
    localCommittedAt?: string;
    admission?: any;
    source?: Transaction;
    committedSource?: Transaction;
}
export interface ReturnCapability {
    schemaVersion: 1;
    version: 1;
    capability: 'fiscalReturnV1';
    profile: typeof RETURN_PROFILE;
    enabled: boolean;
    ready: boolean;
    operationKind: 'RETURN';
    ncfType: 'E34';
    birthSchemaVersion: 3;
    eventSchemaVersion: 1;
    scope: FiscalWorkflowScope;
    bindingAuthorityHash: string;
    authorizationId: string;
    authorityHash: string;
    environment: number;
    issuerRnc: string;
    requiresOnlinePreparation: true;
    readiness: {
        admission: boolean;
        recovery: boolean;
        bank: boolean;
    };
    transport: {
        requiresPreservedOuterContract: boolean;
        batch: {
            path: string;
            enabled: boolean;
        };
        singular: {
            path: string;
            enabled: boolean;
        };
    };
}
export const sameReturn = (a: unknown, b: unknown) => returnJSON(a) === returnJSON(b);
const uuid = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
export function assertReturnAdmission(c: ReturnCapability, scope: FiscalWorkflowScope, p?: ReturnPreparation, now = Date.now()) {
    returnNeed(c?.schemaVersion === 1 && c.version === 1 && c.capability === 'fiscalReturnV1' && c.profile === RETURN_PROFILE && c.enabled === true && c.ready === true && c.readiness?.admission === true && c.operationKind === 'RETURN' && c.ncfType === 'E34' && c.birthSchemaVersion === 3 && c.eventSchemaVersion === 1 && c.requiresOnlinePreparation === true && sameReturn(c.scope, scope) && uuid(c.authorizationId) && /^[a-f0-9]{64}$/.test(c.authorityHash) && /^[a-f0-9]{64}$/.test(c.bindingAuthorityHash) && [0, 1, 2].includes(c.environment) && /^\d{9}(?:\d{2})?$/.test(c.issuerRnc), 'FISCAL_RETURN_AUTHORITY_REQUIRED');
    returnNeed(c.transport?.requiresPreservedOuterContract === true && ((c.transport.batch?.enabled === true && c.transport.batch.path === '/api/sync/inbox/batch') || (c.transport.singular?.enabled === true && c.transport.singular.path === '/api/sync/inbox')), 'FISCAL_RETURN_TRANSPORT_REQUIRED');
    if (p)
        returnNeed(p.authorizationId === c.authorizationId && p.authorityHash === c.authorityHash && p.environment === c.environment && p.issuerRnc === c.issuerRnc && sameReturn(p.scope, scope) && Date.parse(p.preparedAt) <= now && now <= Date.parse(p.expiresAt), 'FISCAL_RETURN_PREPARATION_EXPIRED');
}
export async function assertReturnPreparation(p: ReturnPreparation, a: ReturnAttempt) {
    const c: ReturnCommand = JSON.parse(a.commandBytes!);
    returnNeed(p?.schemaVersion === 1 && p.profile === RETURN_PROFILE && uuid(p.preparationId) && p.reservationState === 'PREPARED' && ['operationId', 'checkoutId', 'transactionId', 'financialEventId', 'authorizationId', 'authorityHash'].every(k => (p as any)[k] === (c as any)[k]) && sameReturn(p.scope, a.scope) && sameReturn(p.originalReference, c.originalReference) && sameReturn(p.inventoryMovementIds, c.inventoryMovementIds) && p.environment === c.originalReference.environment && p.issuerRnc === c.originalReference.issuerRnc && /^[a-f0-9]{64}$/.test(p.originalProofDigest) && Date.parse(p.preparedAt) < Date.parse(p.expiresAt));
    const s = p.returnSnapshot;
    returnNeed(s?.schemaVersion === 1 && s.profile === RETURN_PROFILE && s.currency === 'DOP' && s.exchangeRate === 1 && s.loyaltyDisposition === 'NO_EFFECT_VERIFIED' && /^[a-f0-9]{64}$/.test(s.loyaltyProofDigest) && sameReturn(s.originalReference, c.originalReference) && await returnDigest(s) === p.returnSnapshotDigest);
    returnNeed(Array.isArray(s.lines) && s.lines.length === c.lines.length && new Set(s.lines.map((l: any) => l.cartId)).size === s.lines.length && Array.isArray(s.paymentCommands) && s.paymentCommands.length === c.payments.length);
    for (const l of s.lines) {
        const requested = c.lines.find(x => x.cartId === l.cartId);
        returnNeed(requested && l.quantity === requested.quantity && l.stockDisposition === requested.stockDisposition && l.originalItem?.id === l.itemId && l.originalItem?.cartId === l.cartId && Array.isArray(l.inventoryEntries) && l.inventoryEntries.length <= 1 && l.inventoryEntries.every((e: any) => e.itemId === l.itemId && Number.isFinite(e.quantity) && e.quantity > 0 && Number.isFinite(e.unitCost) && e.unitCost >= 0));
    }
    for (const payment of s.paymentCommands) {
        const requested = c.payments.find(x => x.id === payment.id);
        returnNeed(requested && sameReturn({ ...payment, method: undefined }, requested) && ['CASH', 'CARD', 'TRANSFER', 'CREDIT', 'OTHER'].includes(payment.method), 'FISCAL_RETURN_PAYMENT_INVALID');
    }
    const money = (n: any) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && Number.isSafeInteger(Math.round(n * 100)) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
    returnNeed(['netAmount', 'taxAmount', 'total', 'discountAmount', 'pendingBalance', 'paidAmount'].every(k => money(s[k])) && Math.round((s.netAmount + s.taxAmount) * 100) === Math.round(s.total * 100) && Math.round((s.pendingBalance + s.paidAmount) * 100) === Math.round(s.total * 100) && Math.round(s.paymentCommands.reduce((n: number, x: any) => n + x.amount, 0) * 100) === Math.round(s.paidAmount * 100));
}
export function buildReturnSource(a: ReturnAttempt, original: Transaction, seriesId: string, user: {
    id: string;
    name: string;
}): Transaction {
    const p = a.preparation!, s = p.returnSnapshot, c = a.checkout!;
    const items = s.lines.map((l: any) => ({ ...l.originalItem, id: l.itemId, cartId: l.cartId, quantity: l.quantity, price: l.unitPrice, discountAmount: l.discountAmount,
        netAmount: l.netAmount, taxAmount: l.taxAmount, totalAmount: l.totalAmount, cost: l.inventoryEntries[0]?.unitCost ?? 0,
        ...(l.originalItem.inventoryPresentation ? { inventoryPresentation: { ...l.originalItem.inventoryPresentation, commercialQuantity: l.quantity, baseQuantity: l.inventoryEntries[0]?.quantity } } : {}) })) as CartItem[];
    return { terminalId: p.scope.terminalId, isTaxIncluded: original.isTaxIncluded, serviceType: original.serviceType, serviceTaxPolicySnapshot: original.serviceTaxPolicySnapshot, id: c.transactionId, displayId: undefined, seriesId, seriesNumber: undefined, globalSequence: undefined, date: c.offlineSaleDate!, documentType: 'REFUND', status: 'REFUNDED', items,
        refundReason: JSON.parse(a.intent).reason, total: s.total, netAmount: s.netAmount, taxAmount: s.taxAmount, discountAmount: s.discountAmount, serviceChargeAmount: s.sourceServiceChargeAmount,
        customerId: s.sourceCustomerId ?? undefined, customerSnapshot: s.buyer, customerName: s.buyer?.name, payments: s.paymentCommands as any, currency: 'DOP', exchangeRate: 1,
        pendingBalance: s.pendingBalance, paidAmount: s.paidAmount, taxBreakdown: s.taxBreakdown, userId: user.id, userName: user.name,
        relatedTransactions: [], zReportId: undefined, originalTransactionId: p.originalReference.transactionId, original_transaction_id: p.originalReference.transactionId,
        affectedNCF: p.originalReference.ncf, affectedInvoiceNumber: s.originalDisplayId, affectedInvoiceDate: s.originalDate, modificationCode: s.modificationCode,
        fiscalMode: 'ECF', fiscalProvider: 'MSELLER', ncf: c.allocation!.ncf, ncfType: 'E34', electronicNcf: c.allocation!.ncf, legacyNcf: undefined, fiscalIssuance: c.allocationIssuance,
        fiscalEnvironment: p.environment, fiscalWorkflowCheckoutId: c.checkoutId, fiscalAllocationAuthorizationId: p.authorizationId,
        fiscalSyncStatus: 'PENDING', fiscalSyncError: undefined, fiscalReferenceId: undefined, fiscalCertifiedNcf: undefined, fiscalStatusProof: undefined,
        fiscalPrintProof: undefined, fiscalQrUrl: undefined, fiscalSecurityCode: undefined, fiscalSignedAt: undefined, fiscalProviderStatus: undefined,
        fiscalSubmissionScope: undefined, fiscalLookupApproval: undefined, syncStatus: 'PENDING' } as Transaction;
}
export function returnContract(a: ReturnAttempt): ReturnContract { return { schemaVersion: 1, profile: RETURN_PROFILE, preparationId: a.preparation!.preparationId, returnSnapshotDigest: a.preparation!.returnSnapshotDigest, originalReference: a.preparation!.originalReference, localCommittedAt: a.localCommittedAt! }; }
/** This is authenticated identity metadata, not RETURN admission authority. */
export function validOrdinaryReturnReference(source: Transaction, state: import('./FiscalWorkflowV2Types').FiscalWorkflowStateV2): boolean {
    const reference = state.originalReference;
    return Boolean(reference && Object.keys(reference).sort().join(',') === 'documentId,environment,issuerRnc,ncf,sourceChecksum,transactionId'
        && uuid(reference.documentId) && reference.transactionId === source.id && reference.ncf === source.ncf
        && reference.ncf === state.ncf && reference.issuerRnc === state.issuerRnc && reference.environment === state.environment
        && reference.sourceChecksum === state.checksumV1 && /^[a-f0-9]{64}$/.test(reference.sourceChecksum));
}
export function originalReferencePendingCode(reason: unknown): string {
    return typeof reason === 'string' && /^FISCAL_ORIGINAL_REFERENCE_[A-Z0-9_]{1,96}$/.test(reason)
        ? reason : 'FISCAL_RETURN_ACCEPTED_ORIGINAL_REQUIRED';
}
export function returnOperatorMessage(error: unknown): string {
    const code = (error as Error)?.message || '';
    if (code === 'FISCAL_ORIGINAL_REFERENCE_STORAGE_UNAVAILABLE')
        return 'El ERP no pudo verificar la factura original. La devolución sigue pendiente; vuelve a consultar cuando haya conexión.';
    if (/CONFLICT|MISMATCH|PROOF|REFERENCE|SOURCE|BUYER/.test(code))
        return 'Esta devolución necesita revisión del documento original. No se emitió otra nota de crédito.';
    if (/PAYMENT|BANK/.test(code))
        return 'El medio de reembolso requiere revisión. La devolución sigue pendiente.';
    return 'Conecta la caja para preparar o confirmar esta devolución. Se conserva la misma operación pendiente; no se emitió otra nota de crédito.';
}
