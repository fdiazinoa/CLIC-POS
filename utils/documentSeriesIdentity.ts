import { DocumentSeries, DocumentType } from '../types';

const normalizeString = (value?: string | null): string =>
  typeof value === 'string' ? value.trim().toUpperCase() : '';

const normalizeDocumentTypeKey = (value?: string | null): string =>
  normalizeString(value).replace(/[\s-]+/g, '_');

const SYSTEM_SERIES_KEYS: Array<{ documentType: DocumentType; prefix: string; canonicalId: string }> = [
  { documentType: 'TICKET', prefix: 'TCK', canonicalId: 'TICKET' },
  { documentType: 'REFUND', prefix: 'NC', canonicalId: 'REFUND' },
  { documentType: 'TRANSFER', prefix: 'TR', canonicalId: 'TRANSFER' },
];

export const getDocumentSeriesSemanticKey = (series: Partial<DocumentSeries> | null | undefined): string => {
  if (!series) return '';
  const documentType = normalizeDocumentTypeKey(series.documentType);
  const prefix = normalizeString(series.prefix);
  if (documentType && prefix) return `${documentType}::${prefix}`;

  const id = normalizeDocumentTypeKey(series.id);
  return id || '';
};

export const getCanonicalSystemSeriesId = (
  documentType?: string | null,
  prefix?: string | null
): string | null => {
  const normalizedType = normalizeDocumentTypeKey(documentType);
  const normalizedPrefix = normalizeString(prefix);

  const match = SYSTEM_SERIES_KEYS.find(
    (item) => item.documentType === normalizedType && item.prefix === normalizedPrefix
  );

  return match?.canonicalId || null;
};

export const canonicalizeDocumentSeries = (series: DocumentSeries): DocumentSeries => {
  const canonicalId = getCanonicalSystemSeriesId(series.documentType, series.prefix);
  return {
    ...series,
    id: canonicalId || series.id,
    documentType: (normalizeDocumentTypeKey(series.documentType) || series.documentType) as DocumentType,
    prefix: normalizeString(series.prefix) || series.prefix,
  };
};

export const mergeDocumentSeriesCollection = (rows: DocumentSeries[] = []): DocumentSeries[] => {
  const merged = new Map<string, DocumentSeries>();

  for (const row of rows) {
    if (!row) continue;
    const normalized = canonicalizeDocumentSeries(row);
    const semanticKey = getDocumentSeriesSemanticKey(normalized);
    const mapKey = semanticKey || normalizeDocumentTypeKey(normalized.id);
    if (!mapKey) continue;

    const existing = merged.get(mapKey);
    if (!existing) {
      merged.set(mapKey, {
        ...normalized,
        nextNumber: Math.max(1, Number(normalized.nextNumber) || 1),
        padding: Math.max(1, Number(normalized.padding) || 6),
      });
      continue;
    }

    const canonicalId = getCanonicalSystemSeriesId(normalized.documentType, normalized.prefix);
    merged.set(mapKey, {
      ...existing,
      ...normalized,
      id: canonicalId || existing.id || normalized.id,
      nextNumber: Math.max(Number(existing.nextNumber) || 1, Number(normalized.nextNumber) || 1),
      padding: Math.max(Number(existing.padding) || 6, Number(normalized.padding) || 6),
    });
  }

  return Array.from(merged.values());
};

/**
 * When the terminal has an explicit assignment for a document type, resolve it to a
 * concrete DocumentSeries.id present in `availableSeries` (by id or unique prefix match).
 * Returns undefined if the assignment cannot be matched — caller may still fall back to
 * the raw assignment string for offline/sync edge cases.
 */
export const resolveEffectiveSeriesIdForDocumentType = (
  documentType: string,
  availableSeries: DocumentSeries[],
  terminalAssignmentId?: string | null
): string | undefined => {
  const key = normalizeDocumentTypeKey(terminalAssignmentId);
  if (!key) return undefined;

  const byId = availableSeries.find((series) => normalizeDocumentTypeKey(series.id) === key);
  if (byId?.id) return byId.id;

  const typeNorm = normalizeDocumentTypeKey(documentType);
  const sameType = availableSeries.filter(
    (series) => normalizeDocumentTypeKey(series.documentType) === typeNorm
  );
  const byPrefix = sameType.filter((series) => normalizeString(series.prefix) === key);
  if (byPrefix.length === 1) return byPrefix[0].id;

  return undefined;
};

export const resolveDocumentAssignmentId = (
  documentType: string,
  availableSeries: DocumentSeries[],
  requestedId?: string | null
): string | undefined => {
  const normalizedType = normalizeDocumentTypeKey(documentType);
  const normalizedRequestedId = normalizeDocumentTypeKey(requestedId);

  const exactMatch = normalizedRequestedId
    ? availableSeries.find((series) => normalizeDocumentTypeKey(series.id) === normalizedRequestedId)
    : null;
  if (exactMatch?.id) return exactMatch.id;

  const candidates = availableSeries
    .filter((series) => normalizeDocumentTypeKey(series.documentType) === normalizedType)
    .sort((left, right) => {
      const leftCanonical = getCanonicalSystemSeriesId(left.documentType, left.prefix) === left.id ? 1 : 0;
      const rightCanonical = getCanonicalSystemSeriesId(right.documentType, right.prefix) === right.id ? 1 : 0;
      if (leftCanonical !== rightCanonical) return rightCanonical - leftCanonical;
      return (Number(right.nextNumber) || 0) - (Number(left.nextNumber) || 0);
    });

  return candidates[0]?.id;
};
