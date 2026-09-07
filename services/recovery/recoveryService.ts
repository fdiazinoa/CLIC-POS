import { ReceivedCloseFlow } from "./ReceivedCloseFlow";
import { RecoveryCloseController } from "./RecoveryCloseController";
import { dbAdapter } from "../db";
import { apiSyncAdapter } from "../sync/ApiSyncAdapter";
import { isSyncFeatureEnabled } from "../sync/SyncFeatureFlags";
import { PendingOperationsRecovery } from "./PendingOperationsRecovery";
import { captureOriginalTransport } from "./RecoveryDatabase";
import { originalProvenance } from "./RecoveryRuntime";
import { ClosePreparation } from "./ClosePreparation";
/** Internal preparation API; it does not send or authorize a recovered close. */
export const closePreparation = new ClosePreparation(dbAdapter);
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
        commercialBindingVersion: capabilities.commercialBindingVersion,
        enabled:
          capabilities.enabled === true && capabilities.contractVersion === 1,
      };
    },
    receive: (records) => apiSyncAdapter.receiveRecoveryOriginals(records),
    commercialStatus: (references) =>
      apiSyncAdapter.getOriginalCommercialStatus(references),
    snapshot: () => apiSyncAdapter.createRecoverySnapshot(),
    page: (id, cursor) => apiSyncAdapter.getRecoveryPage(id, cursor),
  },
);

/** Called only by the background commercial sender, never by checkout persistence. */
export async function prepareCommercialOriginalReference(
  document: any,
  item: unknown,
) {
  if (
    !isSyncFeatureEnabled("pending_operations_recovery") ||
    document?._posRecovery?.snapshotId ||
    !["TICKET", "REFUND"].includes(document?.documentType)
  )
    return null;
  const scope = originalProvenance().key;
  try {
    const capability = await apiSyncAdapter.recoveryCapabilities();
    if (originalProvenance().key !== scope)
      throw new Error("RECOVERY_SCOPE_CHANGED");
    if (!capability.enabled || capability.commercialBindingVersion !== 1)
      return null;
    const id = await captureOriginalTransport(dbAdapter, document, item, scope);
    if (!id) return null;
    const reference =
      await pendingOperationsRecovery.receiveCapturedOriginal(id);
    if (originalProvenance().key !== scope)
      throw new Error("RECOVERY_SCOPE_CHANGED");
    return reference;
  } catch (error) {
    if (error instanceof Error && error.message === "RECOVERY_SCOPE_CHANGED")
      throw error;
    // Preserving an original does not introduce a new blocker for the existing commercial queue.
    // The separate original remains pending; no binding means UNKNOWN, never APPLIED by inference.
    console.warn(
      "Original commercial reference unavailable; preserving the existing unbound send.",
    );
    return null;
  }
}

// Availability is advertised by authenticated ERP; never infer company/store from local defaults.
export const receivedCloseFlow = new ReceivedCloseFlow(dbAdapter, {
  context: async () => {
    const before = originalProvenance();
    if (!isSyncFeatureEnabled("pending_operations_recovery"))
      throw Error("RECOVERY_CLOSE_DISABLED");
    const capability = (await apiSyncAdapter.recoveryCapabilities())
      .receivedClose;
    const after = originalProvenance();
    if (before.key !== after.key) throw Error("RECOVERY_SCOPE_CHANGED");
    if (
      capability?.enabled !== true ||
      capability.version !== 1 ||
      capability.profile !== "erp.received-ticket-dop-cash.v1" ||
      capability.coverage !== "RECEIVED_ONLY" ||
      capability.exactZEligible !== false ||
      capability.closeAuthorization !== "NOT_GRANTED"
    )
      throw Error("RECOVERY_CLOSE_UNAVAILABLE");
    if (!after.terminalIds.includes(capability.scope?.terminalId))
      throw Error("RECOVERY_SCOPE_CHANGED");
    return { key: after.key, scope: capability.scope, enabled: true };
  },
  observe: (body) =>
    apiSyncAdapter.receivedCloseRequest(
      "/close-preparations/observe",
      JSON.stringify(body),
    ),
  submit: (body) =>
    apiSyncAdapter.receivedCloseRequest("/close-preparations", body),
  result: (id) =>
    apiSyncAdapter.receivedCloseRequest(
      `/close-preparations/${encodeURIComponent(id)}/result`,
    ),
});
export const recoveryCloseController = new RecoveryCloseController(
  dbAdapter,
  receivedCloseFlow,
  originalProvenance,
);
