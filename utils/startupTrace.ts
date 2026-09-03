// Only fixed stage names and elapsed time may cross the release diagnostics bridge.
export const STARTUP_STAGES = [
  'STARTED', 'LOCAL_DATABASE_READY', 'IDENTITY_READY', 'LICENSE_CHECKED',
  'PAIRING_READY', 'MASTER_CONFIG_READY', 'LOCAL_STATE_READY', 'SYNC_INITIALIZED',
  'TERMINAL_CONFIG_READY', 'CATALOG_READY', 'REHYDRATION_READY',
  'SECURITY_STARTED', 'SECURITY_READY', 'READY', 'FAILED',
] as const;
export type StartupStage = typeof STARTUP_STAGES[number];

export function createStartupTrace() {
  const startedAt = performance.now();
  return (stage: StartupStage) => {
    if (!STARTUP_STAGES.includes(stage)) return;
    const elapsedMs = Math.min(300_000, Math.max(0, Math.round(performance.now() - startedAt)));
    console.info('[POS_BOOT]', { stage, elapsedMs });
    try {
      if (typeof window !== 'undefined') {
        const bridge = (window as Window & {
          ClicPOSAppBridge?: { recordStartupStage?: (stage: string, elapsedMs: number) => void };
        }).ClicPOSAppBridge;
        bridge?.recordStartupStage?.(stage, elapsedMs);
      }
    } catch {
      // Diagnostics must never change the outcome of startup, including older APK shells.
    }
  };
}
