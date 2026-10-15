import type { ArticleFormatMasterPage } from './contract';
import { ArticleFormatError } from './domain';
import type { ArticleFormatStore, FormatLocalEvent } from './store';

/** Port for a future authenticated paginated producer. No endpoint is assumed. */
export interface ArticleFormatMasterTransport {
  nextPage(cursor: string | null): Promise<ArticleFormatMasterPage | null>;
  acknowledge(page: { page_id: string; revision: number; next_cursor: string | null }): Promise<void>;
}

export async function consumeArticleFormatPages(store: ArticleFormatStore, transport: ArticleFormatMasterTransport,
  cursor: string | null = null): Promise<void> {
  const receipts = await store.pendingMasterACKs();
  for (const page of receipts) { await transport.acknowledge(page); await store.ackMasterPage(page.page_id); }
  const seen = new Set<string>();
  while (true) {
    const page = await transport.nextPage(cursor);
    if (!page) return;
    if (seen.has(page.pageId) || (page.nextCursor !== null && page.nextCursor === cursor)) throw new ArticleFormatError('ARTICLE_FORMAT_CURSOR_CYCLE');
    seen.add(page.pageId);
    await store.applyMasterPage(page);
    await transport.acknowledge({page_id:page.pageId,revision:page.revision,next_cursor:page.nextCursor});
    await store.ackMasterPage(page.pageId);
    if (page.nextCursor === null) return;
    cursor = page.nextCursor;
  }
}

/** ERP implementation must durably deduplicate eventId+content before returning applied=true. */
export interface ArticleFormatEventTransport {
  send(event: FormatLocalEvent): Promise<{ eventId: string; applied: boolean }>;
}
const drains = new WeakMap<ArticleFormatStore,Promise<void>>();
export function drainArticleFormatEvents(store: ArticleFormatStore, transport: ArticleFormatEventTransport): Promise<void> {
  const running = drains.get(store);
  if (running) return running;
  const work = (async () => {
    for (const event of await store.pendingEvents()) {
      const ack = await transport.send(event);
      if (ack.eventId !== event.eventId || ack.applied !== true) throw new ArticleFormatError('ARTICLE_FORMAT_ACK_CONFLICT');
      await store.ackEvent(event);
    }
  })().finally(() => drains.delete(store));
  drains.set(store,work);
  return work;
}
