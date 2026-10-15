import type { ArticleFormatLine } from './contract';
import { inventoryQuantity, snapshot } from './domain';

/** Read historical snapshots without consulting flags, capabilities or current master. */
export function articleFormatTicketLabel(item: Pick<ArticleFormatLine,'articleFormat'|'baseQuantity'|'quantity'>): string {
  if (!item.articleFormat) return '';
  const format = snapshot(item.articleFormat);
  return `${format.name} (${format.abbreviation}) · ${format.factor} base · ${inventoryQuantity(item)} unidades base`;
}
export function articleFormatTicketHTML(item: Pick<ArticleFormatLine,'articleFormat'|'baseQuantity'|'quantity'>): string {
  return articleFormatTicketLabel(item).replace(/[&<>"']/g,character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]!));
}
