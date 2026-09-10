export type CatalogDomain = 'prices' | 'tariff_prices' | 'classifications' | 'items' | 'item_taxes' | 'item_operations';
export type CatalogScope = { terminalId: string; tenantId: string; companyId: string; deviceId: string; baseUrl: string };
export type CatalogTariffPriceValue = { price: number; margin: number | null };
export type CatalogMutationValue = string | number | boolean | string[] | CatalogTariffPriceValue | null;
export type CatalogMutation = {
    id: string; recordId: string; domain: CatalogDomain; field: string;
    before: CatalogMutationValue; after: CatalogMutationValue; actorId: string;
};
export type CatalogEdit = {
    id: string; scope: CatalogScope; mutation: CatalogMutation; label: string;
    status: 'PENDING' | 'APPLIED' | 'CONFLICT' | 'REJECTED';
    syncStatus?: 'PENDING' | 'SYNCED' | 'ERROR';
    syncError?: string;
    terminalId?: string;
    dependsOn?: string;
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
        const rows = (await this.deps.read()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const outcomes = new Map(rows.map(edit => [edit.id, edit.status]));
        for (const edit of rows) {
            if (edit.status !== 'PENDING' || edit.nextAttemptAt > this.deps.now() || !this.deps.matchesScope(edit.scope)) continue;
            if (edit.dependsOn && outcomes.get(edit.dependsOn) !== 'APPLIED') {
                if (['CONFLICT', 'REJECTED'].includes(outcomes.get(edit.dependsOn) || '')) {
                    outcomes.set(edit.id, 'CONFLICT');
                    await this.deps.save({ ...edit, status: 'CONFLICT', syncStatus: 'ERROR',
                        syncError: 'PREVIOUS_CHANGE_NOT_APPLIED', message: 'El cambio anterior tiene un conflicto. Revisa la configuración recibida del ERP antes de editar de nuevo.' });
                }
                continue;
            }
            try {
                const result = await this.deps.send(edit);
                if (result?.id !== edit.id || !['APPLIED', 'CONFLICT', 'REJECTED'].includes(result.status)) {
                    throw new Error('El ERP no confirmó este cambio.');
                }
                outcomes.set(edit.id, result.status);
                await this.deps.save({ ...edit, status: result.status, syncStatus: result.status === 'APPLIED' ? 'SYNCED' : 'ERROR',
                    syncError: result.code, message: result.status === 'CONFLICT'
                    ? `El valor cambió en ERP: ${JSON.stringify(result.current)}. Revisa la configuración recibida del ERP antes de editar de nuevo.`
                    : result.code });
            } catch (error) {
                const attempts = edit.attempts + 1;
                await this.deps.save({ ...edit, attempts, syncStatus: 'PENDING',
                    syncError: error instanceof Error ? error.message : 'Envío pendiente',
                    nextAttemptAt: this.deps.now() + Math.min(300_000, 5_000 * 2 ** Math.min(attempts, 6)),
                    message: error instanceof Error ? error.message : 'No se pudo enviar el cambio.',
                });
            }
        }
    }
}
