import { ArticleFormatError } from './domain';

export interface ArticleFormatReadiness {
  authenticatedScope: boolean;
  paginatedMasterTransport: boolean;
  versionedSaleEvent: boolean;
  versionedRefundEvent: boolean;
  atomicLocalPosting: boolean;
  negotiated: boolean;
}

// The referenced ERP serializer has no producer and the legacy ingress rejects snapshots.
// Change this only with implemented adapters and independent real ERP/offline gate evidence.
export const ARTICLE_FORMATS_READINESS: Readonly<ArticleFormatReadiness> = Object.freeze({
  authenticatedScope: false, paginatedMasterTransport: false, versionedSaleEvent: false,
  versionedRefundEvent: false, atomicLocalPosting: false, negotiated: false
});

export function formatsNegotiated(config: { featureFlags?: { ARTICLE_FORMATS?: boolean } },
  terminal: { capabilities?: { article_formats?: number } } | undefined, readiness: ArticleFormatReadiness): boolean {
  return config.featureFlags?.ARTICLE_FORMATS === true && terminal?.capabilities?.article_formats === 1
    && readiness.authenticatedScope === true && readiness.paginatedMasterTransport === true
    && readiness.versionedSaleEvent === true && readiness.versionedRefundEvent === true
    && readiness.atomicLocalPosting === true && readiness.negotiated === true;
}

export function formatsEnabled(config: { featureFlags?: { ARTICLE_FORMATS?: boolean } },
  terminal: { capabilities?: { article_formats?: number } } | undefined): boolean {
  return formatsNegotiated(config, terminal, ARTICLE_FORMATS_READINESS);
}

/** Guard before any LAN/ERP side effect, even if old pending documents are imported. */
export function assertLegacyFormatPayload(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const container = value as Record<string, unknown>;
  for (const key of ['items', 'lines']) {
    const lines = container[key];
    if (Array.isArray(lines) && lines.some(line => line && typeof line === 'object' &&
      ('articleFormat' in line || 'article_format' in line || line.metadata?.article_format || line.workflow?.article_format))) {
      throw new ArticleFormatError('POS_ARTICLE_FORMATS_UNSUPPORTED');
    }
  }
  for (const key of ['transaction', 'sale', 'document', 'invoice']) assertLegacyFormatPayload(container[key]);
}

export function assertFormatsPostingClosed(lines: { articleFormat?: unknown }[]): void {
  if (lines.some(line => line.articleFormat !== undefined)) throw new ArticleFormatError('POS_ARTICLE_FORMATS_NOT_NEGOTIATED');
}
