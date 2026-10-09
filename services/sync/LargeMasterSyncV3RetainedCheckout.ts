import { v3RetainedLineFingerprint } from './LargeMasterSyncV3StockAuthority';
import type { CartItem, ParkedTicket, Transaction } from '../../types';
import { db } from '../../utils/db';
import { dbAdapter } from '../db';

export const isV3RetainedTicketClosed = async (id:string): Promise<boolean> => {
  if (!dbAdapter.isV3TicketClosed) throw new LargeMasterSyncV3Error('SYNC_V3_ATOMIC_COMMIT_REQUIRED');
  return dbAdapter.isV3TicketClosed(id);
};
import { LargeMasterSyncV3Error } from './LargeMasterSyncV3Types';

export type V3RetainedReference = { ticketId?: string; claimId?: string; tableId?: string; originalTransactionId?: string };
export type V3RetainedContext = { collection: 'parkedTickets' | 'transactions' | 'v3RestoredTicketSources'; id: string;
  expected: string; items: CartItem[] };
const verified = new WeakSet<object>();
export const isVerifiedV3RetainedContext = (context: V3RetainedContext | undefined): boolean => Boolean(context && verified.has(context));

/** A caller supplies an account ID, never authority. Read actual durable source on every validation. */
export const readV3RetainedCheckout = async (reference: V3RetainedReference | undefined,
  refund = false): Promise<V3RetainedContext | undefined> => {
  const id = refund ? reference?.originalTransactionId : reference?.ticketId;
  if (!id) return undefined;
  const collection = refund ? 'transactions' : reference?.claimId ? 'v3RestoredTicketSources' : 'parkedTickets';
  const stored = await db.getDocument(collection as any, id) as ParkedTicket | Transaction | null;
  if (!stored || !Array.isArray(stored.items) || !stored.items.length) throw new LargeMasterSyncV3Error('SYNC_V3_RETAINED_SOURCE_REQUIRED');
  if (!refund) {
    const ticket = stored as ParkedTicket;
    if (collection === 'v3RestoredTicketSources' && !['PENDING','PARKED'].includes((stored as any).state)) {
      throw new LargeMasterSyncV3Error('SYNC_V3_RETAINED_TICKET_CHANGED');
    }
    if (await isV3RetainedTicketClosed(id)
      || reference?.tableId && ![ticket.tableId, ticket.primaryTableId, ...(ticket.joinedTableIds || [])].map(String).includes(reference.tableId)) {
      throw new LargeMasterSyncV3Error('SYNC_V3_RETAINED_TICKET_CHANGED');
    }
  }
  const context: V3RetainedContext = { collection, id, expected: JSON.stringify(stored), items: stored.items };
  verified.add(context);
  return context;
};

export const assertV3RetainedLine = (line: CartItem, context: V3RetainedContext | undefined): void => {
  const matches = context?.items.filter(source => source.cartId === line.cartId && source.id === line.id) || [];
  if (matches.length !== 1 || v3RetainedLineFingerprint(matches[0]) !== v3RetainedLineFingerprint(line)) {
    throw new LargeMasterSyncV3Error('SYNC_V3_RETAINED_LINE_CHANGED');
  }
};
