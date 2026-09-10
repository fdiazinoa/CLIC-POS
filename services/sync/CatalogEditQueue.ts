export type CatalogDomain = 'prices' | 'classifications';
export type CatalogScope = { terminalId: string; tenantId: string; companyId: string; deviceId: string; baseUrl: string };
export type CatalogMutation = {
    id: string; recordId: string; domain: CatalogDomain; field: string;
    before: string | number | null; after: string | number; actorId: string;
};
export type CatalogEdit = {
    id: string; scope: CatalogScope; mutation: CatalogMutation; label: string;
    status: 'PENDING' | 'APPLIED' | 'CONFLICT' | 'REJECTED';
    attempts: number; nextAttemptAt: number; createdAt: string; message?: string;
};
export type CatalogResult = { id: string; status: 'APPLIED' | 'CONFLICT' | 'REJECTED'; code?: string; current?: unknown };
export interface CatalogQueueDependencies {
    read(): Promise<CatalogEdit[]>;
    save(edit: CatalogEdit): Promise<void>;
    matchesScope(scope: CatalogScope): boolean;
    send(edit: CatalogEdit): Promise<CatalogResult>;
    now(): number;
}
// A single worker prevents duplicate concurrent sends. The server also deduplicates
// by immutable mutation id, including when its commit succeeds but the ACK is lost.
export class CatalogEditQueue {
    private running: Promise<void> | null = null;
    constructor(private deps: CatalogQueueDependencies) {}
    process(): Promise<void> {
        if (this.running) return this.running;
        this.running = this.run().finally(() => { this.running = null; });
        return this.running;
    }
    private async run() {
        for (const edit of await this.deps.read()) {
            if (edit.status !== 'PENDING' || edit.nextAttemptAt > this.deps.now() || !this.deps.matchesScope(edit.scope)) continue;
            try {
                const result = await this.deps.send(edit);
                if (result?.id !== edit.id || !['APPLIED', 'CONFLICT', 'REJECTED'].includes(result.status)) {
                    throw new Error('El ERP no confirmó este cambio.');
                }
                await this.deps.save({ ...edit, status: result.status, message: result.status === 'CONFLICT'
                    ? `El valor cambió en ERP: ${JSON.stringify(result.current)}. Consulta de nuevo y crea otro cambio.`
                    : result.code });
            } catch (error) {
                const attempts = edit.attempts + 1;
                await this.deps.save({ ...edit, attempts,
                    nextAttemptAt: this.deps.now() + Math.min(300_000, 5_000 * 2 ** Math.min(attempts, 6)),
                    message: error instanceof Error ? error.message : 'No se pudo enviar el cambio.',
                });
            }
        }
    }
}
