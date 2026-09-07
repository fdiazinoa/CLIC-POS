import { loadSyncProfile, resolveSyncTarget } from "../sync/SyncProfile";
import { readTerminalCredentialsSync } from "../sync/TerminalCredentialStore";

export function originalProvenance(): {
  key: string;
  terminalId?: string;
  terminalIds: string[];
} {
  const profile = loadSyncProfile();
  const target = resolveSyncTarget();
  const credentials = readTerminalCredentialsSync();
  const canonicalTerminal = target.useLocalTarget
    ? target.terminalId
    : credentials.erpTerminalId || credentials.terminalId || target.terminalId;
  const tenant =
    credentials.erpTenantId ||
    credentials.tenantId ||
    profile.erpTenantId ||
    profile.cloudTenantId ||
    profile.localTenantId ||
    "";
  return {
    key: JSON.stringify([
      target.baseUrl || "",
      tenant,
      canonicalTerminal || "",
    ]),
    terminalId: profile.localTerminalId || canonicalTerminal,
    terminalIds: [profile.localTerminalId, canonicalTerminal].filter(
      (x): x is string => Boolean(x),
    ),
  };
}
