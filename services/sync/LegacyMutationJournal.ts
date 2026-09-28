import { dbAdapter } from '../db';

export const LEGACY_MUTATION_JOURNAL_COLLECTION = 'legacyMutationJournal';
const CLOSED_RETENTION = 200;

export type LegacyMutationClassification =
    | 'RESPONSE_VALID'
    | 'SAFE_PRE_SIDE_EFFECT'
    | 'OUTCOME_UNKNOWN'
    | 'NOT_DISPATCHED';

export interface LegacyMutationJournalEntry {
    id: string;
    operationCorrelationId: string;
    authorityFingerprint: string;
    generation: number;
    method: string;
    canonicalPath: string;
    diagnosticRequestId: string;
    state: 'DISPATCHED' | 'OUTCOME_UNKNOWN' | 'CLOSED';
    createdAt: string;
    dispatchedAt: string | null;
    httpStatus: number | null;
    classification: LegacyMutationClassification | null;
    callerAckAt: string | null;
    callerAckReference: string | null;
    closedAt: string | null;
}

export interface LegacyMutationJournalStore {
    getCollection<T>(collectionName: string): Promise<T[]>;
    saveDocument<T extends { id: string }>(collectionName: string, document: T): Promise<void>;
    deleteDocument(collectionName: string, id: string): Promise<void>;
}

const randomId = (): string => {
    try {
        return crypto.randomUUID();
    } catch {
        return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
};

const canonicalPath = (url: string): string => {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
};

export class LegacyMutationJournal {
    private entries = new Map<string, LegacyMutationJournalEntry>();
    private blockingMutations = new Set<string>();
    private healthy = false;
    private initialized = false;

    constructor(private readonly store: LegacyMutationJournalStore = dbAdapter) {}

    async initializeForStartup(): Promise<void> {
        this.entries.clear();
        this.blockingMutations.clear();
        this.initialized = true;
        this.healthy = false;
        let entries: LegacyMutationJournalEntry[];
        try {
            entries = await this.store.getCollection<LegacyMutationJournalEntry>(LEGACY_MUTATION_JOURNAL_COLLECTION);
        } catch (error) {
            this.blockingMutations.add('STORE_UNHEALTHY');
            throw Object.assign(new Error('LEGACY_MUTATION_JOURNAL_UNAVAILABLE'), { cause: error });
        }

        for (const entry of Array.isArray(entries) ? entries : []) {
            if (!entry?.id) continue;
            let current = entry;
            if (!entry.closedAt) {
                current = {
                    ...entry,
                    state: 'OUTCOME_UNKNOWN',
                    classification: 'OUTCOME_UNKNOWN',
                    closedAt: null,
                };
                await this.store.saveDocument(LEGACY_MUTATION_JOURNAL_COLLECTION, current);
                this.blockingMutations.add(current.id);
            }
            this.entries.set(current.id, current);
        }
        this.healthy = true;
        await this.pruneClosedBestEffort();
    }

    isHealthy(): boolean {
        return this.initialized && this.healthy;
    }

    isInitialized(): boolean {
        return this.initialized;
    }

    hasBlockingMutations(): boolean {
        return this.blockingMutations.size > 0;
    }

    hasOutcomeUnknown(): boolean {
        return [...this.blockingMutations].some(id => this.entries.get(id)?.state === 'OUTCOME_UNKNOWN');
    }

    assertRemoteAuthorityAllowed(nextAuthorityFingerprint?: string): void {
        if (!this.isHealthy()) throw new Error('LEGACY_MUTATION_JOURNAL_UNAVAILABLE');
        if (!this.hasBlockingMutations()) return;
        const open = [...this.blockingMutations]
            .map(id => this.entries.get(id))
            .filter((entry): entry is LegacyMutationJournalEntry => Boolean(entry));
        const onlySameAuthorityDispatched = Boolean(nextAuthorityFingerprint)
            && open.length > 0
            && open.every(entry => entry.state === 'DISPATCHED'
                && (entry.authorityFingerprint === nextAuthorityFingerprint
                    || entry.authorityFingerprint.startsWith(`${nextAuthorityFingerprint}|`)));
        if (!onlySameAuthorityDispatched) throw new Error('LEGACY_MUTATION_HANDOFF_BLOCKED');
    }

    assertAuthorityGenerationChangeAllowed(): void {
        if (!this.isHealthy()) throw new Error('LEGACY_MUTATION_JOURNAL_UNAVAILABLE');
        if (this.hasBlockingMutations()) throw new Error('LEGACY_MUTATION_AUTHORITY_GENERATION_BLOCKED');
    }

    async begin(input: {
        operationCorrelationId?: string;
        authorityFingerprint: string;
        generation: number;
        method: string;
        url: string;
        diagnosticRequestId: string;
    }): Promise<LegacyMutationJournalEntry> {
        if (!this.isHealthy() || this.hasOutcomeUnknown()) {
            throw new Error(this.isHealthy() ? 'LEGACY_MUTATION_OUTCOME_UNKNOWN' : 'LEGACY_MUTATION_JOURNAL_UNAVAILABLE');
        }
        const id = randomId();
        const now = new Date().toISOString();
        const entry: LegacyMutationJournalEntry = {
            id,
            operationCorrelationId: input.operationCorrelationId || input.diagnosticRequestId,
            authorityFingerprint: input.authorityFingerprint,
            generation: input.generation,
            method: input.method,
            canonicalPath: canonicalPath(input.url),
            diagnosticRequestId: input.diagnosticRequestId,
            state: 'DISPATCHED',
            createdAt: now,
            dispatchedAt: null,
            httpStatus: null,
            classification: null,
            callerAckAt: null,
            callerAckReference: null,
            closedAt: null,
        };
        this.entries.set(id, entry);
        this.blockingMutations.add(id);
        try {
            await this.store.saveDocument(LEGACY_MUTATION_JOURNAL_COLLECTION, entry);
            return entry;
        } catch (error) {
            this.healthy = false;
            throw Object.assign(new Error('LEGACY_MUTATION_JOURNAL_UNAVAILABLE'), { cause: error });
        }
    }

    async prepareDispatch(id: string, authorityFingerprint: string, generation: number): Promise<void> {
        const entry = this.entries.get(id);
        if (!entry || !this.healthy) throw new Error('LEGACY_MUTATION_JOURNAL_UNAVAILABLE');
        if (entry.authorityFingerprint !== authorityFingerprint || entry.generation !== generation) {
            await this.markOutcomeUnknown(id, null);
            throw new Error('LEGACY_MUTATION_AUTHORITY_CHANGED');
        }
        const updated = { ...entry, dispatchedAt: new Date().toISOString() };
        this.entries.set(id, updated);
        try {
            await this.store.saveDocument(LEGACY_MUTATION_JOURNAL_COLLECTION, updated);
        } catch {
            // DISPATCHED is already durable. Keep the mutation blocking even if
            // the diagnostic timestamp cannot be updated.
        }
    }

    async recordHttpStatus(id: string, status: number): Promise<void> {
        const entry = this.entries.get(id);
        if (!entry) return;
        const updated = { ...entry, httpStatus: status };
        this.entries.set(id, updated);
        try {
            await this.store.saveDocument(LEGACY_MUTATION_JOURNAL_COLLECTION, updated);
        } catch {
            this.healthy = false;
        }
    }

    async markOutcomeUnknown(id: string, httpStatus: number | null): Promise<void> {
        const entry = this.entries.get(id);
        if (!entry) return;
        const updated: LegacyMutationJournalEntry = {
            ...entry,
            state: 'OUTCOME_UNKNOWN',
            classification: 'OUTCOME_UNKNOWN',
            httpStatus,
            closedAt: null,
        };
        this.entries.set(id, updated);
        this.blockingMutations.add(id);
        try {
            await this.store.saveDocument(LEGACY_MUTATION_JOURNAL_COLLECTION, updated);
        } catch {
            this.healthy = false;
        }
    }

    async acknowledge(
        id: string,
        classification: 'RESPONSE_VALID' | 'SAFE_PRE_SIDE_EFFECT' | 'NOT_DISPATCHED',
        callerAckReference: string,
    ): Promise<void> {
        const entry = this.entries.get(id);
        if (!entry || !this.healthy) throw new Error('LEGACY_MUTATION_JOURNAL_UNAVAILABLE');
        const now = new Date().toISOString();
        const updated: LegacyMutationJournalEntry = {
            ...entry,
            state: 'CLOSED',
            classification,
            callerAckAt: now,
            callerAckReference: String(callerAckReference || '').slice(0, 160),
            closedAt: now,
        };
        await this.store.saveDocument(LEGACY_MUTATION_JOURNAL_COLLECTION, updated);
        this.entries.set(id, updated);
        this.blockingMutations.delete(id);
        await this.pruneClosedBestEffort();
    }

    getEntry(id: string): LegacyMutationJournalEntry | null {
        return this.entries.get(id) || null;
    }

    getBlockingIds(): string[] {
        return [...this.blockingMutations];
    }

    private async pruneClosedBestEffort(): Promise<void> {
        const closed = [...this.entries.values()]
            .filter(entry => Boolean(entry.closedAt))
            .sort((a, b) => String(b.closedAt).localeCompare(String(a.closedAt)));
        for (const entry of closed.slice(CLOSED_RETENTION)) {
            try {
                await this.store.deleteDocument(LEGACY_MUTATION_JOURNAL_COLLECTION, entry.id);
                this.entries.delete(entry.id);
            } catch {
                // Pruning never weakens the fail-closed admission state.
            }
        }
    }
}

export const legacyMutationJournal = new LegacyMutationJournal();
