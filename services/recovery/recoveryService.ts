import { dbAdapter } from "../db";
import { apiSyncAdapter } from "../sync/ApiSyncAdapter";
import { isSyncFeatureEnabled } from "../sync/SyncFeatureFlags";
import { PendingOperationsRecovery } from "./PendingOperationsRecovery";
import { originalProvenance } from "./RecoveryRuntime";
export const pendingOperationsRecovery = new PendingOperationsRecovery(
  dbAdapter,
  {
    context: async () => {
      if (!isSyncFeatureEnabled("pending_operations_recovery"))
        return { ...originalProvenance(), enabled: false };
      const before = originalProvenance();
      const capabilities = await apiSyncAdapter.recoveryCapabilities();
      const after = originalProvenance();
      if (before.key !== after.key) throw new Error("RECOVERY_SCOPE_CHANGED");
      return {
        ...after,
        enabled:
          capabilities.enabled === true && capabilities.contractVersion === 1,
      };
    },
    receive: (records) => apiSyncAdapter.receiveRecoveryOriginals(records),
    snapshot: () => apiSyncAdapter.createRecoverySnapshot(),
    page: (id, cursor) => apiSyncAdapter.getRecoveryPage(id, cursor),
  },
);
