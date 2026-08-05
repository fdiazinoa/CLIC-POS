export type AutomaticMasterSyncStrategy = 'CONFIG_PUSH_V2_PRIMARY' | 'LEGACY_COLLECTION_SWEEP';

export type AutomaticMasterSyncStrategyInput = {
    targetKind: string;
    configPushV2Enabled: boolean;
};

export const resolveAutomaticMasterSyncStrategy = ({
    targetKind,
    configPushV2Enabled,
}: AutomaticMasterSyncStrategyInput): AutomaticMasterSyncStrategy => (
    targetKind === 'ERP_ACTIVE' && configPushV2Enabled
        ? 'CONFIG_PUSH_V2_PRIMARY'
        : 'LEGACY_COLLECTION_SWEEP'
);

export const shouldRunLegacyAutomaticMasterSweep = (input: AutomaticMasterSyncStrategyInput): boolean =>
    resolveAutomaticMasterSyncStrategy(input) === 'LEGACY_COLLECTION_SWEEP';
