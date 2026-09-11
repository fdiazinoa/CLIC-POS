type BrowserCryptoSource = {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
};

const formatUuidV4 = (bytes: Uint8Array): string => {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/** UUID v4 compatible with Android WebViews that predate crypto.randomUUID(). */
export const createUuid = (
  source: BrowserCryptoSource | undefined = globalThis.crypto as BrowserCryptoSource | undefined
): string => {
  if (typeof source?.randomUUID === 'function') {
    return source.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof source?.getRandomValues === 'function') {
    source.getRandomValues(bytes);
  } else {
    const timestamp = Date.now();
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256) ^ ((timestamp >>> ((index % 4) * 8)) & 0xff);
    }
  }

  return formatUuidV4(bytes);
};
