/** Authenticated discovery survives offline boots, but never follows another terminal scope. */
const KEY = "clic_pos_recovery_authorization_v1";
let currentScope: () => string = () => "";
export const configureRecoveryAvailability = (scope: () => string) => {
  currentScope = scope;
};
export function hasDiscoveredRecoveryAvailability(
  storage: Pick<Storage, "getItem"> | undefined = typeof localStorage ===
  "undefined"
    ? undefined
    : localStorage,
): boolean {
  try {
    const value = JSON.parse(storage?.getItem(KEY) || "null");
    return Boolean(
      value?.version === 1 &&
      value.enabled === true &&
      value.context &&
      value.context === currentScope(),
    );
  } catch {
    return false;
  }
}
export async function discoverRecoveryAvailability(
  context: () => { key: string; terminalIds: string[] },
  fetchCapabilities: () => Promise<any>,
  storage: Pick<Storage, "setItem" | "removeItem"> = localStorage,
): Promise<boolean> {
  const before = context();
  if (!before.key || !before.terminalIds.length) return false;
  const capability = await fetchCapabilities();
  if (context().key !== before.key) throw Error("RECOVERY_SCOPE_CHANGED");
  const scope = capability.receivedClose?.scope;
  const enabled =
    capability.enabled === true &&
    capability.contractVersion === 1 &&
    capability.exactZEligible === false &&
    capability.closeAuthorization === "NOT_GRANTED" &&
    scope &&
    ["tenantId", "companyId", "storeId", "terminalId"].every(
      (k) => typeof scope[k] === "string" && scope[k],
    ) &&
    before.terminalIds.includes(scope.terminalId);
  if (enabled)
    storage.setItem(
      KEY,
      JSON.stringify({ version: 1, context: before.key, enabled: true, scope }),
    );
  else storage.removeItem(KEY);
  return Boolean(enabled);
}
