/** ERP canonicalOriginalJson: UTF-16 key ordering with explicit pair emission. */
export function recoveryCanonicalJson(value: unknown, depth = 0): string {
  if (depth > 64) throw Error("RECOVERY_JSON_DEPTH");
  if (value === null) return "null";
  if (typeof value === "string") {
    if (new TextDecoder().decode(new TextEncoder().encode(value)) !== value)
      throw Error("RECOVERY_JSON_UNICODE");
    return JSON.stringify(value);
  }
  if (
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean"
  )
    return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (
      Object.keys(value).length !== value.length ||
      Array.from({ length: value.length }, (_, i) => i).some(
        (i) => !Object.hasOwn(value, i),
      )
    )
      throw Error("RECOVERY_JSON_ARRAY");
    return (
      "[" +
      value.map((v) => recoveryCanonicalJson(v, depth + 1)).join(",") +
      "]"
    );
  }
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw Error("RECOVERY_JSON_VALUE");
  return (
    "{" +
    Object.keys(value)
      .sort()
      .map(
        (k) =>
          recoveryCanonicalJson(k, depth + 1) +
          ":" +
          recoveryCanonicalJson((value as any)[k], depth + 1),
      )
      .join(",") +
    "}"
  );
}
