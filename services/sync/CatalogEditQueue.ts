export type CatalogDomain = 'prices' | 'tariff_prices' | 'classifications' | 'classification_hierarchy' | 'classification_lifecycle' | 'items' | 'item_taxes' | 'item_operations' | 'item_general' | 'item_lifecycle';
export type CatalogScope = { terminalId: string; tenantId: string; companyId: string; deviceId: string; baseUrl: string };
export type CatalogTariffPriceValue = { price: number; margin: number | null };
export type CatalogMutationValue = string | number | boolean | string[] | CatalogTariffPriceValue | Record<string, any> | null;
export type CatalogMutation = {
    id: string; recordId: string; domain: CatalogDomain; field: string;
    before: CatalogMutationValue; after: CatalogMutationValue; actorId: string;
    conflictAction?: 'RETRY' | 'FORCE';
    resolvesMutationId?: string;
};
export type CatalogConflictResolution = 'RETRIED' | 'DISCARDED' | 'ERP_ACCEPTED' | 'FORCED';
export type CatalogEdit = {
    id: string; scope: CatalogScope; mutation: CatalogMutation; label: string;
    status: 'PENDING' | 'APPLIED' | 'CONFLICT' | 'REJECTED';
    syncStatus?: 'PENDING' | 'SYNCED' | 'ERROR';
    syncError?: string;
    terminalId?: string;
    dependsOn?: string;
    attempts: number; nextAttemptAt: number; createdAt: string; message?: string;
    conflictCurrent?: CatalogMutationValue;
    resolution?: CatalogConflictResolution;
    resolvedBy?: string;
    resolvedAt?: string;
};
export type CatalogResult = { id: string; status: 'APPLIED' | 'CONFLICT' | 'REJECTED'; code?: string; current?: unknown };
export interface CatalogQueueDependencies {
    read(): Promise<CatalogEdit[]>;
    save(edit: CatalogEdit): Promise<void>;
    matchesScope(scope: CatalogScope): boolean;
    send(edit: CatalogEdit): Promise<CatalogResult>;
    now(): number;
}
const resultMatchesRequestedValue = (current: unknown, requested: CatalogMutationValue): boolean => {
    if (Array.isArray(current) && Array.isArray(requested)) {
        return current.length === requested.length && current.every((value, index) => value === requested[index]);
    }
    if (current && requested && typeof current === 'object' && typeof requested === 'object') {
        return JSON.stringify(current) === JSON.stringify(requested);
    }
    return current === requested;
};
// A single worker prevents duplicate concurrent sends. The server also deduplicates
// by immutable mutation id, including when its commit succeeds but the ACK is lost.
export class CatalogEditQueue {
    private static readonly SCOPE_RECHECK_DELAY_MS = 5 * 60 * 1000;
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
            if (edit.status !== 'PENDING') continue;
            const now = this.deps.now();
            if (!this.deps.matchesScope(edit.scope)) {
                const scopeError = 'CATALOG_EDIT_SCOPE_MISMATCH';
                if (edit.syncStatus !== 'ERROR' || edit.syncError !== scopeError || edit.nextAttemptAt <= now) {
                    await this.deps.save({
                        ...edit,
                        syncStatus: 'ERROR',
                        syncError: scopeError,
                        nextAttemptAt: now + CatalogEditQueue.SCOPE_RECHECK_DELAY_MS,
                        message: 'El cambio pertenece a otra vinculacion de terminal y no se envio. Se reintentara si la vinculacion vuelve a coincidir.',
                    });
                }
                continue;
            }
            if (edit.nextAttemptAt > now) continue;
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
                const effectiveStatus = result.status === 'CONFLICT'
                    && resultMatchesRequestedValue(result.current, edit.mutation.after)
                    ? 'APPLIED'
                    : result.status;
                outcomes.set(edit.id, effectiveStatus);
                await this.deps.save({ ...edit, status: effectiveStatus, syncStatus: effectiveStatus === 'APPLIED' ? 'SYNCED' : 'ERROR',
                    syncError: effectiveStatus === 'APPLIED' ? undefined : result.code,
                    ...(effectiveStatus === 'CONFLICT' ? { conflictCurrent: result.current as CatalogMutationValue } : {}),
                    message: effectiveStatus === 'CONFLICT'
                    ? `El valor cambió en ERP: ${JSON.stringify(result.current)}. Revisa la configuración recibida del ERP antes de editar de nuevo.`
                    : effectiveStatus === 'APPLIED' ? undefined : result.code });
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
