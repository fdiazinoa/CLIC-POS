import type { BusinessConfig, Transaction } from "../../types";
import { trackingFail, type TrackingSelection } from "./TrackingAuthority";
/** Tracking may be used with ordinary invoices too. Scope is taken from the
 * pinned registered terminal configuration, independently of fiscal provider. */
export function captureTrackingSourceMetadata(
  tx: Transaction,
  config: BusinessConfig,
): Record<string, string> {
  const selections = tx.items.flatMap(
    (line) => line.trackingData || [],
  ) as TrackingSelection[];
  if (!selections.length) return {};
  let binding: unknown;
  try {
    binding = JSON.parse(tx.v3Binding || "");
  } catch {
    trackingFail("TRACKING_SOURCE_BINDING_REQUIRED");
  }
  if (!Array.isArray(binding) || binding.length !== 5)
    return trackingFail("TRACKING_SOURCE_BINDING_REQUIRED");
  const [tenantId, terminalId, deviceId] = binding;
  const matches = config.terminals.filter(
    (terminal) =>
      (terminal.config.erpTerminalId || terminal.id) === terminalId &&
      terminal.config.currentDeviceId === deviceId,
  );
  if (
    matches.length !== 1 ||
    tx.terminalId !== terminalId ||
    !tx.trackingCheckoutId ||
    !tx.trackingEffectAt ||
    !Number.isFinite(Date.parse(tx.trackingEffectAt))
  )
    trackingFail("TRACKING_SOURCE_SCOPE_REQUIRED");
  const erp = matches[0].config.erpBinding;
  if (
    !erp?.companyId ||
    !erp.storeId ||
    erp.tenantId !== tenantId ||
    selections.some(
      (s) =>
        s.authority.tenantId !== tenantId ||
        s.authority.companyId !== erp.companyId ||
        s.authority.storeId !== erp.storeId ||
        s.authority.terminalId !== terminalId ||
        s.authority.deviceId !== deviceId ||
        s.authority.warehouseId !== tx.v3WarehouseId,
    )
  )
    trackingFail("TRACKING_SOURCE_SCOPE_REQUIRED");
  return {
    pos_tracking_contract_version: "1",
    tenant_id: tenantId,
    company_id: erp.companyId,
    store_id: erp.storeId,
    terminal_id: terminalId,
    device_id: deviceId,
  };
}
