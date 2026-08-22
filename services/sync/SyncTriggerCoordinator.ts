import { syncMetrics } from './SyncMetrics';

export type SyncTriggerReason =
    | 'REALTIME_HINT'
    | 'STARTUP'
    | 'ONLINE'
    | 'FOREGROUND'
    | 'REALTIME_RECONNECTED'
    | 'RECONCILIATION'
    | 'MANUAL'
    | 'RETRY';

export type SyncDomainVersions = Record<string, number | string>;

export type SyncTriggerRequest = {
    reason: SyncTriggerReason;
    domainVersions?: SyncDomainVersions;
    collections?: string[];
    imageOnly?: boolean;
};

export type SyncExecution = {
    reasons: SyncTriggerReason[];
    domainVersions: SyncDomainVersions;
    collections: string[];
    imageOnly: boolean;
    pendingHintCount: number;
};

export type SyncTriggerCoordinatorOptions = {
    debounceMs?: number;
    setTimeoutFn?: typeof setTimeout;
    clearTimeoutFn?: typeof clearTimeout;
};

const IMMEDIATE_REASONS = new Set<SyncTriggerReason>([
    'STARTUP',
    'ONLINE',
    'FOREGROUND',
    'REALTIME_RECONNECTED',
    'MANUAL',
    'RETRY',
]);

export class SyncTriggerCoordinator {
    private executor: ((execution: SyncExecution) => Promise<void>) | null = null;
    private reasons = new Set<SyncTriggerReason>();
    private domainVersions = new Map<string, number | string>();
    private collections = new Set<string>();
    private imageOnly = false;
    private pendingHintCount = 0;
    private running = false;
    private pending = false;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];
    private readonly debounceMs: number;
    private readonly setTimeoutFn: typeof setTimeout;
    private readonly clearTimeoutFn: typeof clearTimeout;

    constructor(options: SyncTriggerCoordinatorOptions = {}) {
        this.debounceMs = options.debounceMs ?? 350;
        this.setTimeoutFn = options.setTimeoutFn || globalThis.setTimeout;
        this.clearTimeoutFn = options.clearTimeoutFn || globalThis.clearTimeout;
    }

    configure(executor: (execution: SyncExecution) => Promise<void>): void {
        this.executor = executor;
        if (this.pending || this.reasons.size > 0) this.schedule(0);
    }

    clear(): void {
        this.executor = null;
        if (this.debounceTimer) this.clearTimeoutFn(this.debounceTimer);
        this.debounceTimer = null;
        this.reasons.clear();
        this.domainVersions.clear();
        this.collections.clear();
        this.imageOnly = false;
        this.pendingHintCount = 0;
        syncMetrics.setPendingHints(0);
        this.pending = false;
        this.resolveWaiters();
    }

    request(request: SyncTriggerRequest): Promise<void> {
        this.reasons.add(request.reason);
        this.mergeDomainVersions(request.domainVersions || {});
        (request.collections || []).filter(Boolean).forEach((collection) => this.collections.add(collection));
        this.imageOnly ||= Boolean(request.imageOnly);
        if (request.reason === 'REALTIME_HINT') {
            this.pendingHintCount += 1;
            syncMetrics.markHintReceived();
            syncMetrics.setPendingHints(this.pendingHintCount);
        }
        this.pending = true;

        const promise = new Promise<void>((resolve, reject) => this.waiters.push({ resolve, reject }));
        if (this.running) return promise;

        const immediate = IMMEDIATE_REASONS.has(request.reason);
        this.schedule(immediate ? 0 : this.debounceMs);
        return promise;
    }

    getSnapshot() {
        return {
            running: this.running,
            pending: this.pending,
            reasons: Array.from(this.reasons),
            domainVersions: Object.fromEntries(this.domainVersions),
            collections: Array.from(this.collections),
            imageOnly: this.imageOnly,
            pendingHintCount: this.pendingHintCount,
        };
    }

    private mergeDomainVersions(incoming: SyncDomainVersions): void {
        Object.entries(incoming).forEach(([domain, version]) => {
            const current = this.domainVersions.get(domain);
            if (typeof current === 'number' && typeof version === 'number') {
                this.domainVersions.set(domain, Math.max(current, version));
                return;
            }
            this.domainVersions.set(domain, version);
        });
    }

    private schedule(delayMs: number): void {
        if (!this.executor) return;
        if (this.debounceTimer) this.clearTimeoutFn(this.debounceTimer);
        this.debounceTimer = this.setTimeoutFn(() => {
            this.debounceTimer = null;
            void this.drain();
        }, delayMs);
    }

    private async drain(): Promise<void> {
        if (this.running || !this.executor) return;
        this.running = true;
        let firstError: unknown = null;

        try {
            while (this.pending && this.executor) {
                this.pending = false;
                const execution: SyncExecution = {
                    reasons: Array.from(this.reasons),
                    domainVersions: Object.fromEntries(this.domainVersions),
                    collections: Array.from(this.collections),
                    imageOnly: this.imageOnly,
                    pendingHintCount: this.pendingHintCount,
                };
                this.reasons.clear();
                this.domainVersions.clear();
                this.collections.clear();
                this.imageOnly = false;
                this.pendingHintCount = 0;
                syncMetrics.setPendingHints(0);
                try {
                    await this.executor(execution);
                } catch (error) {
                    firstError ||= error;
                }
            }
        } finally {
            this.running = false;
            if (firstError) this.rejectWaiters(firstError);
            else this.resolveWaiters();
        }
    }

    private resolveWaiters(): void {
        const waiters = this.waiters.splice(0);
        waiters.forEach(({ resolve }) => resolve());
    }

    private rejectWaiters(error: unknown): void {
        const waiters = this.waiters.splice(0);
        waiters.forEach(({ reject }) => reject(error));
    }
}

export const syncTriggerCoordinator = new SyncTriggerCoordinator();
