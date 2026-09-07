/** Secure UUID v4 for Android WebViews predating crypto.randomUUID. */
export function recoveryUuid(
  source: Pick<Crypto, "getRandomValues"> & {
    randomUUID?: () => string;
  } = globalThis.crypto,
): string {
  if (typeof source?.randomUUID === "function") return source.randomUUID();
  if (typeof source?.getRandomValues !== "function")
    throw Error("RECOVERY_SECURE_RANDOM_UNAVAILABLE");
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const h = Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
