import { MediaAsset, MediaType } from '../types';

const VIDEO_EXTENSION_RE = /\.(mp4|webm|ogg|mov|m4v)(?:$|[?#])/i;

export const inferMediaType = (url: string, explicitType?: string): MediaType => {
  if (String(explicitType || '').toUpperCase() === 'VIDEO') return 'VIDEO';
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
