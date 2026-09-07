import type { BusinessConfig } from "../../types";
import { encodeOriginal, decodeOriginal } from "./OriginalCodec";

type Project = (value: any) => any;
const invalid = (): never => {
  throw new Error("NATIVE_Z_CONFIGURATION_UNSUPPORTED");
};
const scalar: Project = (value) =>
  value === null ||
  ["undefined", "string", "number", "boolean"].includes(typeof value)
    ? value
    : invalid();
const put = (o: any, key: string, value: any) =>
  Object.defineProperty(o, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
const object =
  (fields: Record<string, Project>): Project =>
  (value) => {
    if (value === null || value === undefined) return value;
    if (typeof value !== "object" || Array.isArray(value)) return invalid();
    const out: Record<string, unknown> = {};
    for (const [key, project] of Object.entries(fields))
      if (Object.hasOwn(value, key)) put(out, key, project(value[key]));
    return out;
  };
const array =
  (project: Project): Project =>
  (value) => {
    if (value === null || value === undefined) return value;
    if (!Array.isArray(value)) return invalid();
    return value.map(project); // Preserve order and holes, not unrelated array extensions.
  };
const users: Project = (value) => {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object" || Array.isArray(value)) return invalid();
  const out = {};
  for (const key of Object.keys(value))
    put(out, key, object({ Z: array(scalar) })(value[key]));
  return out;
};
const terminalConfig = object({
  erpTerminalId: scalar,
  erpBinding: object({ terminalId: scalar }),
  operational: object({ defaultTaxIds: array(scalar) }),
  workflow: object({ session: object({ closeReportOptionsByUser: users }) }),
});
const project = object({
  currencies: array(
    object({
      code: scalar,
      symbol: scalar,
      isBase: scalar,
      exchangeRate: scalar,
    }),
  ),
  paymentMethods: array(
    object({ id: scalar, name: scalar, type: scalar, isEnabled: scalar }),
  ),
  taxes: array(
    object({
      id: scalar,
      code: scalar,
      name: scalar,
      rate: scalar,
      type: scalar,
    }),
  ),
  taxRate: scalar,
  terminals: array(object({ id: scalar, config: terminalConfig })),
});
/** Configuration read by the shared native Z producer, not an operational config restore.
 * Whitelist excludes integration credentials/hardware. A per-preparation output comparison
 * must still reject any dependency this projection cannot reproduce.
 */
export function projectNativeZConfiguration(
  config: BusinessConfig,
): BusinessConfig {
  return decodeOriginal(encodeOriginal(project(config))) as BusinessConfig;
}
