import { requestJson } from '../network/httpClient';
import { LegacyMutationJournal, legacyMutationJournal, type LegacyMutationClassification } from './LegacyMutationJournal';
import { apiSyncAdapter } from './ApiSyncAdapter';
import { dbAdapter } from '../db';

const COMPLETION_COLLECTION = 'legacyMutationCompletions';

export const persistLegacyLanMutationCompletion = async (
    correlationId: string,
    reference: string,
    responseStatus: number,
): Promise<void> => {
    await dbAdapter.saveDocument(COMPLETION_COLLECTION, {
        id: correlationId,
        reference,
        responseStatus,
        completedAt: new Date().toISOString(),
    });
};

export interface LegacyLanMutationReceipt<T = any> {
    data: T;
    response: Response;
    journalId: string;
    correlationId: string;
    completeAfterDurableCommit(reference: string, persist: () => Promise<void>): Promise<void>;
    markOutcomeUnknown(): Promise<void>;
}

export const dispatchLegacyLanMutation = async <T = any>(input: {
    url: string;
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    headers?: Record<string, string>;
    body?: BodyInit | null;
    timeoutMs?: number;
    operation: string;
    correlationId?: string;
    assertAuthorityCurrent?: () => boolean;
    journal?: LegacyMutationJournal;
    authorityState?: { revision: number; terminalId: string | null };
}): Promise<LegacyLanMutationReceipt<T>> => {
    const journal = input.journal || legacyMutationJournal;
    const authority = input.authorityState || apiSyncAdapter.getOperationalAuthorityState();
    const generation = authority.revision;
    const terminalId = authority.terminalId || '';
    const fingerprint = `${new URL(input.url).origin}|${terminalId}`;
    const correlationId = input.correlationId || `${input.operation}:${crypto.randomUUID()}`;
    const entry = await journal.begin({
        operationCorrelationId: correlationId,
        authorityFingerprint: fingerprint,
        generation,
        method: input.method,
        url: input.url,
        diagnosticRequestId: correlationId,
    });
    await journal.prepareDispatch(entry.id, fingerprint, generation);
    const current = input.authorityState || apiSyncAdapter.getOperationalAuthorityState();
    if (current.revision !== generation || input.assertAuthorityCurrent?.() === false) {
        await journal.markOutcomeUnknown(entry.id, null);
        throw new Error('LEGACY_MUTATION_AUTHORITY_CHANGED');
    }

    try {
        const native = await requestJson<T>({
            url: input.url,
            method: input.method,
            headers: input.headers,
            body: input.body,
            timeoutMs: input.timeoutMs || 5_000,
            diagnosticContext: { operation: input.operation, correlationId },
        });
        const response = new Response(native.text, { status: native.status, headers: native.headers });
        await journal.recordHttpStatus(entry.id, response.status);
        if (response.status !== 401 && !response.ok) {
            await journal.markOutcomeUnknown(entry.id, response.status);
            throw Object.assign(new Error(`LEGACY_MUTATION_OUTCOME_UNKNOWN:${response.status}`), { httpStatus: response.status });
        }
        let completed = false;
        return {
            data: native.data,
            response,
            journalId: entry.id,
            correlationId,
            completeAfterDurableCommit: async (reference, persist) => {
                if (completed) return;
                await persist();
                const classification: Exclude<LegacyMutationClassification, 'OUTCOME_UNKNOWN'> = response.status === 401
                    ? 'SAFE_PRE_SIDE_EFFECT'
                    : 'RESPONSE_VALID';
                await journal.acknowledge(entry.id, classification, reference);
                completed = true;
                await dbAdapter.deleteDocument(COMPLETION_COLLECTION, correlationId).catch(() => undefined);
            },
            markOutcomeUnknown: () => journal.markOutcomeUnknown(entry.id, response.status),
        };
    } catch (error: any) {
        const httpStatus = Number.isFinite(Number(error?.httpStatus)) ? Number(error.httpStatus) : null;
        await journal.markOutcomeUnknown(entry.id, httpStatus);
        throw error;
    }
};
