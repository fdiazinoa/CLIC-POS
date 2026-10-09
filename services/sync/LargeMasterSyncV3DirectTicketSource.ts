import { isV3RetainedTicketClosed } from './LargeMasterSyncV3RetainedCheckout';
import type { ParkedTicket } from '../../types';
import { db } from '../../utils/db';
import { dbAdapter } from '../db';
import { getLargeMasterSyncV3OperationalSession, v3InventoryBaselineKey } from './LargeMasterSyncV3OperationalSession';
import { LargeMasterSyncV3Error } from './LargeMasterSyncV3Types';

export type V3DirectTicketClaim = ParkedTicket & { state: 'PENDING' | 'PARKED' | 'SETTLED' | 'CANCELLED';
  v3Binding: string; v3WarehouseId: string; v3InventoryBaseline: string; restaurantOrderId: string };

/** Stable claim, established by native CAS before destructive direct-ticket restore. */
export const claimV3DirectTicket = async (id: string): Promise<ParkedTicket | null> => {
  const session = await getLargeMasterSyncV3OperationalSession(); await session.assertCurrent();
  const existing = await db.getDocument('v3RestoredTicketSources' as any, id) as V3DirectTicketClaim | null;
  if (await isV3RetainedTicketClosed(id)) throw new LargeMasterSyncV3Error('SYNC_V3_RETAINED_TICKET_CHANGED');
  const ticket = existing || await db.getDocument('parkedTickets', id) as ParkedTicket | null;
  if (!ticket || !ticket.items.length) throw new LargeMasterSyncV3Error('SYNC_V3_RETAINED_SOURCE_REQUIRED');
  if (existing && !['PENDING', 'PARKED'].includes(existing.state)) throw new LargeMasterSyncV3Error('SYNC_V3_RETAINED_TICKET_CHANGED');
  const retained = ticket.items.some(line => line.v3SaleAuthority?.syncId !== session.ready.runtime.version.syncId
    || line.v3SaleAuthority?.syncVersion !== session.ready.runtime.version.syncVersion);
  if (!retained && !existing) return null; // Ordinary current-catalog restore retains its established behavior.
  const stamp = ticket.items[0].v3SaleAuthority;
  if (!stamp?.warehouseId || stamp.binding !== session.binding) throw new LargeMasterSyncV3Error('SYNC_V3_RETAINED_OWNER_REQUIRED');
  const config = await db.get('config');
  await session.validate(await session.projectConfig(config as any), ticket.items, stamp.tariffId, stamp.warehouseId,
    'SALE', undefined, { ticketId: id, claimId: existing ? id : undefined });
  const claim: V3DirectTicketClaim = { ...ticket, id, state: 'PENDING', v3Binding: session.binding,
    v3WarehouseId: stamp.warehouseId, v3InventoryBaseline: v3InventoryBaselineKey(session.binding, stamp), restaurantOrderId: id };
  if (!dbAdapter.saveDocumentsAtomically) throw new LargeMasterSyncV3Error('SYNC_V3_ATOMIC_COMMIT_REQUIRED');
  await dbAdapter.saveDocumentsAtomically([{ collectionName: 'v3RestoredTicketSources', document: claim,
    ...(existing ? { expectedDocument: JSON.stringify(existing) } : { requireAbsent: true }),
    v3CurrentCatalog: { ...session.ready.runtime.version, binding: session.binding },
    v3ExpectedRetainedDocument: { collection: existing ? 'v3RestoredTicketSources' : 'parkedTickets', id, expected: JSON.stringify(ticket) } }]);
  await session.assertCurrent();
  return claim;
};

/** Existing waiting list is the recovery surface; claims remain visible once after crashes. */
export const mergeV3DirectWaitingTickets = (parked: ParkedTicket[], claims: V3DirectTicketClaim[], settledIds: Set<string>, binding: string): ParkedTicket[] => {
  const rows = new Map(parked.filter(ticket => !settledIds.has(ticket.id)).map(ticket => [ticket.id, ticket]));
  for (const claim of claims) {
    if (claim.v3Binding !== binding) continue;
    if (settledIds.has(claim.id) || ['SETTLED', 'CANCELLED'].includes(claim.state)) rows.delete(claim.id);
    else if (['PENDING', 'PARKED'].includes(claim.state)) rows.set(claim.id, claim);
  }
  return [...rows.values()];
};

export const readV3DirectWaitingTickets = async (parked: ParkedTicket[]): Promise<ParkedTicket[]> => {
  const session = await getLargeMasterSyncV3OperationalSession(); await session.assertCurrent();
  const claims = await db.get('v3RestoredTicketSources' as any) as V3DirectTicketClaim[] || [];
  const settled = await db.get('v3TicketSettlements' as any) as Array<{ id: string }> || [];
  const closed = new Set(settled.map(row=>row.id));
  for(const id of new Set([...parked,...claims].map(row=>row.id))) if(await isV3RetainedTicketClosed(id)) closed.add(id);
  await session.assertCurrent();
  return mergeV3DirectWaitingTickets(parked, claims, closed, session.binding);
};

/** Repark/cancel preserves one durable source identity and rejects concurrent settlement. */
export const updateV3DirectTicket = async (id: string, ticket?: ParkedTicket): Promise<void> => {
  const session = await getLargeMasterSyncV3OperationalSession(); await session.assertCurrent();
  const existing = await db.getDocument('v3RestoredTicketSources' as any, id) as V3DirectTicketClaim | null;
  if (!existing || existing.state !== 'PENDING') return;
  if (existing.v3Binding !== session.binding) throw new LargeMasterSyncV3Error('SYNC_V3_RETAINED_OWNER_REQUIRED');
  if (await isV3RetainedTicketClosed(id)) return;
  if (ticket) {
    if (ticket.id !== id) throw new LargeMasterSyncV3Error('SYNC_V3_RETAINED_TICKET_CHANGED');
    const stamp = existing.items[0].v3SaleAuthority!;
    await session.validate(await session.projectConfig(await db.get('config') as any), ticket.items,
      stamp.tariffId, stamp.warehouseId, 'SALE', undefined, {ticketId:id,claimId:id});
  }
  if (!dbAdapter.saveDocumentsAtomically) throw new LargeMasterSyncV3Error('SYNC_V3_ATOMIC_COMMIT_REQUIRED');
  const next = {...existing,...ticket,id,state:ticket?'PARKED':'CANCELLED'};
  await dbAdapter.saveDocumentsAtomically([{collectionName:'v3RestoredTicketSources',document:next,
    expectedDocument:JSON.stringify(existing),v3CurrentCatalog:{...session.ready.runtime.version,binding:session.binding},
    v3ExpectedRetainedDocument:{collection:'v3RestoredTicketSources',id,expected:JSON.stringify(existing)}}]);
  await session.assertCurrent();
};
