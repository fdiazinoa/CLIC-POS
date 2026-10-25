import React from 'react';
import type { V3ArticleDiagnostic } from '../services/sync/LargeMasterSyncV3OperationalCatalog';

/** A bounded row inside the catalog flex column, below its header and above its scrollable articles. */
export default function V3CatalogArticleWarning({ diagnostics }: { diagnostics: readonly V3ArticleDiagnostic[] }) {
  if (!diagnostics.length) return null;
  return <aside role="status" aria-label="Artículos no disponibles"
    className="shrink-0 max-h-24 overflow-y-auto p-2 text-sm text-amber-900 bg-amber-50 border-b border-amber-200">
    {diagnostics.length === 1 ? 'Artículo no disponible' : `Artículos no disponibles (${diagnostics.length})`}: {diagnostics.slice(0, 10).map(row =>
      `${row.sku ? `SKU ${row.sku}` : row.articleId} (${row.code}): ${row.reason}`).join(' · ')}
  </aside>;
}
