import type { BusinessConfig } from '../../types';
import type { DatabaseAdapter } from '../db/DatabaseAdapter';

export interface TerminalAssignmentRepair {
    config: BusinessConfig;
    changed: boolean;
    preferredTerminalId: string | null;
}
export type TerminalAssignmentOptions = {
    activeTerminalId?: string | null;
    bindingTerminalId?: string | null;
    bindingLocalTerminalId?: string | null;
};

export async function persistTerminalAssignmentRepair(
    database: Pick<DatabaseAdapter, 'getDocument' | 'saveConfigIfUnchanged'>,
    repair: (stored: BusinessConfig) => TerminalAssignmentRepair,
    isCurrent: () => boolean = () => true,
): Promise<BusinessConfig | null> {
    if (!database.saveConfigIfUnchanged) return null;
    for (let attempt = 0; attempt < 2 && isCurrent(); attempt++) {
        const stored = await database.getDocument<BusinessConfig>('config', 'current');
        if (!stored || !isCurrent()) return null;
        const next = repair(stored);
        if (!next.changed) return null;
        if (await database.saveConfigIfUnchanged(stored, next.config)) return next.config;
    }
    return null;
}
