import { MediaAsset, MediaType } from '../types';

const VIDEO_EXTENSION_RE = /\.(mp4|webm|ogg|mov|m4v)(?:$|[?#])/i;

export const inferMediaType = (url: string, explicitType?: string): MediaType => {
  const type = String(explicitType || '').toUpperCase();
  if (type === 'VIDEO' || type === 'IMAGE') return type;
  return VIDEO_EXTENSION_RE.test(String(url || '').trim()) ? 'VIDEO' : 'IMAGE';
};

export const isValidRemoteMediaUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
};

export const normalizeMediaAsset = (raw: Partial<MediaAsset>, index = 0): MediaAsset | null => {
  const url = String(raw?.url || '').trim();
  if (!url) return null;
  return {
    id: String(raw.id || `media-${index}-${url}`),
    type: inferMediaType(url, raw.type),
    url,
    posterUrl: raw.posterUrl ? String(raw.posterUrl).trim() : undefined,
    mimeType: raw.mimeType,
    storagePath: raw.storagePath,
    version: raw.version,
    sortOrder: Number.isFinite(Number(raw.sortOrder)) ? Number(raw.sortOrder) : index,
    active: raw.active !== false,
  };
};

/** Explicit URL editor path; no upload/provider API implied. */
export const createRemoteAd = (url: string, type: MediaType, posterUrl?: string, id = `ad_${Date.now()}`): MediaAsset & { active: boolean } => {
  const trimmed = url.trim();
  const poster = posterUrl?.trim() || undefined;
  if (!isValidRemoteMediaUrl(trimmed) || (poster && !isValidRemoteMediaUrl(poster))) throw new Error('Introduce una URL HTTP/HTTPS válida.');
  return { id, type: inferMediaType(trimmed, type), url: trimmed, posterUrl: type === 'VIDEO' ? poster : undefined, active: true };
};
