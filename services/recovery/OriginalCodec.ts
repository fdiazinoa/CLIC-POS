/** Lossless codec for native operational values. This is not a commercial payload. */
export const ORIGINAL_ENCODING = "pos.original.typed-json.v1" as const;
type Node = [string, ...unknown[]];
const MAX_DEPTH = 64;
const MAX_NODES = 200_000;
export function encodeOriginal(value: unknown): string {
  const ancestors = new Set<object>();
  let count = 0;
  const visit = (v: unknown, depth: number): Node => {
    if (++count > MAX_NODES || depth > MAX_DEPTH)
      throw new Error("ORIGINAL_TOO_COMPLEX");
    if (v === null) return ["null"];
    if (v === undefined) return ["undefined"];
    if (typeof v === "string" || typeof v === "boolean") return [typeof v, v];
    if (typeof v === "number")
      return ["number", Object.is(v, -0) ? "-0" : String(v)];
    if (v instanceof Date)
      return ["date", Number.isNaN(v.getTime()) ? "Invalid" : v.toISOString()];
    if (typeof v !== "object" || ancestors.has(v))
      throw new Error("ORIGINAL_UNSUPPORTED_VALUE");
    if (
      !Array.isArray(v) &&
      Object.getPrototypeOf(v) !== Object.prototype &&
      Object.getPrototypeOf(v) !== null
    )
      throw new Error("ORIGINAL_UNSUPPORTED_PROTOTYPE");
    if (
      Object.getOwnPropertySymbols(v).some(
        (k) => Object.getOwnPropertyDescriptor(v, k)?.enumerable,
      )
    )
      throw new Error("ORIGINAL_SYMBOL_KEY");
    ancestors.add(v);
    const entries = Object.keys(v).map((k) => {
      const descriptor = Object.getOwnPropertyDescriptor(v, k)!;
      if (!("value" in descriptor)) throw new Error("ORIGINAL_ACCESSOR");
      return [k, visit(descriptor.value, depth + 1)];
    });
    ancestors.delete(v);
    return Array.isArray(v)
      ? ["array", v.length, entries]
      : ["object", entries];
  };
  return JSON.stringify(visit(value, 0));
}
export function decodeOriginal(text: string): unknown {
  let count = 0;
  const visit = (n: unknown, depth: number): unknown => {
    if (++count > MAX_NODES || depth > MAX_DEPTH || !Array.isArray(n))
      throw new Error("INVALID_ORIGINAL");
    const [tag, value] = n;
    if ((tag === "null" || tag === "undefined") && n.length === 1)
      return tag === "null" ? null : undefined;
    if (
      n.length === 2 &&
      ((tag === "string" && typeof value === "string") ||
        (tag === "boolean" && typeof value === "boolean"))
    )
      return value;
    if (tag === "number" && n.length === 2 && typeof value === "string") {
      const number = value === "-0" ? -0 : Number(value);
      if (value !== (Object.is(number, -0) ? "-0" : String(number)))
        throw new Error("INVALID_ORIGINAL_NUMBER");
      return number;
    }
    if (tag === "date" && n.length === 2 && typeof value === "string") {
      const date = new Date(value === "Invalid" ? NaN : value);
      if (
        value !== "Invalid" &&
        (!Number.isFinite(date.getTime()) || date.toISOString() !== value)
      )
        throw new Error("INVALID_ORIGINAL_DATE");
      return date;
    }
    const array = tag === "array";
    if ((!array && tag !== "object") || n.length !== (array ? 3 : 2))
      throw new Error("INVALID_ORIGINAL_TAG");
    if (
      array &&
      (!Number.isSafeInteger(value) || value < 0 || value > MAX_NODES)
    )
      throw new Error("INVALID_ORIGINAL_ARRAY");
    const entries = array ? n[2] : value;
    if (!Array.isArray(entries)) throw new Error("INVALID_ORIGINAL_ENTRIES");
    const output: any = array ? new Array(value) : {};
    const keys = new Set<string>();
    for (const entry of entries) {
      if (
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        typeof entry[0] !== "string" ||
        keys.has(entry[0])
      )
        throw new Error("INVALID_ORIGINAL_KEY");
      const key = entry[0];
      if (
        array &&
        (key === "length" ||
          (/^(0|[1-9][0-9]*)$/.test(key) && Number(key) >= value))
      )
        throw new Error("INVALID_ORIGINAL_INDEX");
      keys.add(key);
      Object.defineProperty(output, key, {
        value: visit(entry[1], depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return output;
  };
  return visit(JSON.parse(text), 0);
}
export const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
};
export const decodeBase64 = (value: string): Uint8Array => {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    throw new Error("INVALID_ORIGINAL_BASE64");
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
};
export const originalDigest = async (bytes: Uint8Array): Promise<string> =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as BufferSource),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
