import type { Transaction } from '../../types';
import type { ReturnAttempt } from './FiscalReturnV1';
import { RETURN_PROFILE, returnContract, returnJSON, sameReturn } from './FiscalReturnV1';
import { financialIdentity } from '../db/LargeMasterSyncV3FinancialRetention';
import { fiscalStatusSourceChecksum } from './FiscalStatusProof';
import { sha256Utf8 } from '../sync/LargeMasterSyncV3Client';
import { validateDgiiPrintContext } from './FiscalPrintEvidence';
export async function verifyReturnStatus(source: Transaction, state: any, a: ReturnAttempt | null, before?: any): Promise<boolean> {
    try {
        if (!a?.preparation || !a.localCommittedAt || !['SEALED', 'COMMITTED'].includes(a.phase) || !state || state.schemaVersion !== 2 || state.source !== 'ERP_POS_FISCAL_WORKFLOW_V2' || state.sourceKind !== 'RETURN_SOURCE_V1' || state.transactionId !== source.id || state.transactionId !== a.checkout?.transactionId || !sameReturn(state.scope, a.scope) || state.environment !== a.preparation.environment || state.issuerRnc !== a.preparation.issuerRnc || state.operationKind !== 'RETURN' || !sameReturn(state.originalReference, a.preparation.originalReference) || state.canCorrect !== false || !Number.isSafeInteger(state.observationVersion) || state.observationVersion < 0)
            return false;
        const expected = { profile: RETURN_PROFILE, preparationId: a.preparation.preparationId };
        for (const [key, value] of Object.entries(expected))
            if (state[key] !== undefined && !sameReturn(state[key], value))
                return false;
        if (before) {
            if (state.observationVersion < before.observationVersion || before.mode === 'WORKFLOW' && state.mode !== 'WORKFLOW' || before.decision !== 'PENDING' && state.decision !== before.decision || before.signature && !sameReturn(before.signature, state.signature))
                return false;
            if (state.observationVersion === before.observationVersion && before.mode === state.mode && !sameReturn(before, state))
                return false;
        }
        if (state.mode === 'PREPARED')
            return state.profile === RETURN_PROFILE && state.preparationId === a.preparation.preparationId && state.workflowId === null && state.state === 'AWAITING_APPLICATION' && state.decision === 'PENDING' && state.signature === null && state.observationVersion === 0 && !Object.hasOwn(state, 'ncf') && !Object.hasOwn(state, 'originalSourceEnvelope');
        if (state.mode !== 'WORKFLOW' || state.workflowId !== a.checkout.checkoutId || state.permitId !== null || state.ncf !== source.ncf || state.ncfType !== 'E34' || state.total !== source.total || state.currency !== 'DOP' || state.exchangeRate !== 1 || !sameReturn(state.buyer, source.customerSnapshot) || state.saleEventId !== a.financialEventId || !Number.isFinite(Date.parse(state.observedAt)) || !Number.isSafeInteger(state.draftRevision) || state.draftRevision < 0 || !['PENDING', 'ACCEPTED', 'ACCEPTED_CONDITIONAL', 'REJECTED'].includes(state.decision))
            return false;
        const envelope = state.originalSourceEnvelope, contract = envelope?.fiscalReturnContract;
        if (!sameReturn(contract, returnContract(a)) || financialIdentity(envelope?.transaction) !== financialIdentity(source) || await fiscalStatusSourceChecksum(source) !== state.checksumV1 || !sameReturn(envelope.inventoryMovementIds, a.preparation.inventoryMovementIds))
            return false;
        if (await sha256Utf8(returnJSON({ schemaVersion: 2, source: 'POS_ORIGINAL_ENVELOPE_V2', scope: state.scope, saleEventId: state.saleEventId, payload: envelope })) !== state.originalDigestV2)
            return false;
        const birth = envelope.fiscalWorkflowBirth;
        if (!sameReturn(birth, { schemaVersion: 3, authorizationKind: 'OFFLINE_FISCAL_ALLOCATION_V2', authorizationId: a.preparation.authorizationId, authorityHash: a.preparation.authorityHash, checkoutId: a.checkout.checkoutId, transactionId: source.id }))
            return false;
        if (state.signature && !validateDgiiPrintContext({ issuerRnc: state.issuerRnc, environment: state.environment, ncf: state.ncf, evidence: state.signature }, source))
            return false;
        if (['ACCEPTED', 'ACCEPTED_CONDITIONAL'].includes(state.decision) && (!state.signature || state.state !== state.decision))
            return false;
        if (state.decision === 'REJECTED' && state.state !== 'REJECTED' || state.decision === 'PENDING' && ['ACCEPTED', 'ACCEPTED_CONDITIONAL', 'REJECTED'].includes(state.state))
            return false;
        return ['AWAITING_APPLICATION', 'DRAFT', 'READY', 'NEEDS_CORRECTION', 'HELD', 'DISPATCH_FENCED', 'OUTCOME_UNKNOWN', 'SIGNED_PENDING', 'ACCEPTED', 'ACCEPTED_CONDITIONAL', 'REJECTED'].includes(state.state);
    }
    catch {
        return false;
    }
}
export function returnStatusMessage(state: any): string {
    if (state.decision === 'ACCEPTED')
        return 'Nota de crédito aceptada por DGII.';
    if (state.decision === 'ACCEPTED_CONDITIONAL')
        return 'Nota de crédito aceptada condicionalmente por DGII.';
    if (state.decision === 'REJECTED')
        return 'Nota de crédito rechazada por DGII. Requiere revisión; no se reenvía automáticamente.';
    if (state.signature)
        return 'Nota de crédito firmada; pendiente de aceptación DGII.';
    if (state.mode === 'PREPARED')
        return 'Guardada localmente; pendiente de sincronización o aplicación comercial.';
    if (state.state === 'OUTCOME_UNKNOWN')
        return 'Resultado del envío pendiente de conciliación. Sólo se consultará el mismo comprobante.';
    if (state.state === 'DISPATCH_FENCED')
        return 'Envío fiscal reservado; resultado, firma y aceptación todavía no confirmados.';
    if (state.state === 'HELD' || state.state === 'NEEDS_CORRECTION')
        return 'Nota de crédito aplicada comercialmente; emisión fiscal pendiente de revisión.';
    return 'Nota de crédito aplicada comercialmente; pendiente de emisión fiscal.';
}
