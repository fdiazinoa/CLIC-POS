import type { BusinessConfig } from '../../types';

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

/**
 * Persist a terminal-assignment repair only when the *stored* document actually changes.
 * The latest stored copy is the base, never the stale React snapshot: an ERP update that
 * landed after the render must not be overwritten by an old clone.
 */
export const repairStoredConfig = (
    stored: BusinessConfig | null,
    fallback: BusinessConfig,
    deviceId: string,
    options: TerminalAssignmentOptions,
    clear: (config: BusinessConfig, deviceId: string, options?: TerminalAssignmentOptions) => TerminalAssignmentRepair,
): BusinessConfig | null => {
    const repaired = clear(stored || fallback, deviceId, options);
    return repaired.changed ? repaired.config : null;
};
