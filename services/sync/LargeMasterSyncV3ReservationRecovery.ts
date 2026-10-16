import {planReservationCommitmentRelease} from './LargeMasterSyncV3ReservationCommitments';
import {readV3CompletedReservation} from './LargeMasterSyncV3FinancialCommit';
import { createUuid } from '../../utils/uuid';
import type { Customer, Product, Reservation } from '../../types';
import { db } from '../../utils/db';
import { dbAdapter } from '../db';
import { getLargeMasterSyncV3OperationalSession, v3InventoryBaselineKey } from './LargeMasterSyncV3OperationalSession';
import { assertV3ReservationSource, reservationClaimId, validateV3ReservationPricing } from './LargeMasterSyncV3ReservationAuthority';
import { LargeMasterSyncV3Error } from './LargeMasterSyncV3Types';

/** Claim and hydrate by durable reservation ID. Never trust a list row or replace its commercial snapshots. */
export async function claimV3Reservation(id: string, warehouseId: string) {
  const session = await getLargeMasterSyncV3OperationalSession(); await session.assertCurrent();
  const source = await db.getDocument('reservations',id) as Reservation | null;
  if (!source) throw new LargeMasterSyncV3Error('SYNC_V3_RESERVATION_SOURCE_REQUIRED');
  assertV3ReservationSource(source,session.binding,warehouseId);
  const claimId = reservationClaimId(id);
  const existing = await db.getDocument('v3RestoredTicketSources' as any,claimId) as any;
  const projected = await session.projectConfig(await db.get('config') as any);
  const pricing = validateV3ReservationPricing(source,projected);
  const stamp = source.items[0].v3SaleAuthority!;
  await session.validate(projected,source.items,stamp.tariffId,warehouseId,'SALE',undefined,
    {reservationId:id,reservationClaimId:existing ? claimId : undefined});
  const catalog = await session.catalog(stamp.tariffId,warehouseId);
  const products: Product[] = [];
  for (const productId of new Set(source.items.map(line=>line.id))) {
    const current = await catalog.get(productId);
    if (!current) throw new LargeMasterSyncV3Error('SYNC_V3_ARTICLE_UNAVAILABLE');
    products.push(await session.withStock(current.product,warehouseId));
  }
  const persistedCustomer = await db.getDocument('customers',source.customerId) as Customer | null;
  if (persistedCustomer && persistedCustomer.id !== source.customerId) throw new LargeMasterSyncV3Error('SYNC_V3_RESERVATION_CUSTOMER_CHANGED');
  const customer = {...(persistedCustomer || {}),...pricing.customerSnapshot,id:source.customerId,name:source.customerName} as Customer;
  if (!dbAdapter.saveDocumentsAtomically) throw new LargeMasterSyncV3Error('SYNC_V3_ATOMIC_COMMIT_REQUIRED');
  const claim = existing || {id:claimId,state:'PENDING',sourceCollection:'reservations',sourceId:id,sourceExpected:JSON.stringify(source),
    invoiceDate:new Date().toISOString(),saleEventId:createUuid(),paymentEventId:createUuid(),items:source.items,v3Binding:session.binding,v3WarehouseId:warehouseId,v3InventoryBaseline:v3InventoryBaselineKey(session.binding,stamp)};
  if (!existing) await dbAdapter.saveDocumentsAtomically([{collectionName:'v3RestoredTicketSources',document:claim,requireAbsent:true,
    v3CurrentCatalog:{...session.ready.runtime.version,binding:session.binding},
    v3ExpectedRetainedDocument:{collection:'reservations',id,expected:JSON.stringify(source)}}]);
  await session.assertCurrent();
  // Read again after native claim (including retries/concurrent cancellation), before publishing any UI state.
  await session.validate(projected,source.items,stamp.tariffId,warehouseId,'SALE',undefined,{reservationId:id,reservationClaimId:claimId});
  return {reservation:source,claimId,pricing,customer,products,invoiceDate:claim.invoiceDate as string};
}

export type V3RecoveredReservation = Awaited<ReturnType<typeof claimV3Reservation>>;

/** Reattach an existing cart after navigation, including verified receipt-only completion.
 * ACTIVE claiming remains separate: a settled reference can never authorize another sale. */
export async function restoreV3ReservationReference(id: string, warehouseId: string): Promise<V3RecoveredReservation> {
  const claimId = reservationClaimId(id);
  const claim = await db.getDocument('v3RestoredTicketSources' as any,claimId) as any;
  if (claim?.state !== 'SETTLED') return claimV3Reservation(id,warehouseId);
  let source: Reservation;
  try { source = JSON.parse(claim.sourceExpected); }
  catch { throw new LargeMasterSyncV3Error('SYNC_V3_RESERVATION_COMPLETION_CONFLICT'); }
  const completed = await readV3CompletedReservation({reservationId:id,claimId,expectedSource:source});
  if (!completed || source.warehouseId !== warehouseId) throw new LargeMasterSyncV3Error('SYNC_V3_RESERVATION_COMPLETION_CONFLICT');
  const pricing: NonNullable<Reservation['v3Snapshot']> = {
    binding:completed.v3Binding!,total:completed.total,netAmount:completed.netAmount!,taxAmount:completed.taxAmount!,
    discountAmount:completed.discountAmount || 0,discountType:completed.discountType || 'FIXED',discountValue:completed.discountValue || 0,
    isTaxIncluded:completed.isTaxIncluded ?? source.items[0].v3SaleAuthority!.taxIncluded,
    serviceChargeAmount:completed.serviceChargeAmount || 0,serviceType:completed.serviceType || 'DINE_IN',customerSnapshot:completed.customerSnapshot,
  };
  const customer = {...completed.customerSnapshot,id:source.customerId,name:source.customerName} as Customer;
  return {reservation:source,claimId,pricing,customer,products:source.items,invoiceDate:completed.date};
}


/** Expiry uses the same durable source CAS and native queue as invoice settlement. */
export async function expireV3Reservation(id: string): Promise<boolean> {
  const session = await getLargeMasterSyncV3OperationalSession(); await session.assertCurrent();
  const source = await db.getDocument('reservations',id) as Reservation | null;
  if (!source || source.status !== 'ACTIVE' || source.invoicedTransactionId || Date.parse(source.expiryDate) > Date.now()) return false;
  assertV3ReservationSource(source,session.binding,undefined,true);
  const claimId = reservationClaimId(id);
  const existing = await db.getDocument('v3RestoredTicketSources' as any,claimId) as any;
  if (existing && (existing.state !== 'PENDING' || existing.sourceCollection !== 'reservations' || existing.sourceId !== id
    || existing.sourceExpected !== JSON.stringify(source))) throw new LargeMasterSyncV3Error('SYNC_V3_RESERVATION_SOURCE_CHANGED');
  const at = new Date().toISOString();
  const stamp = source.items[0].v3SaleAuthority!;
  const scope = {v3Binding:session.binding,v3WarehouseId:source.warehouseId,v3InventoryBaseline:v3InventoryBaselineKey(session.binding,stamp)};
  const current = {...session.ready.runtime.version,binding:session.binding};
  const claim = existing || {id:claimId,sourceCollection:'reservations',sourceId:id,sourceExpected:JSON.stringify(source),items:source.items};
  const expected = {collection:'reservations',id,expected:JSON.stringify(source)};
  const documents = [
    {collectionName:'reservations',document:{...source,...scope,reservationId:id,status:'EXPIRED',expiredAt:at,updatedAt:at},v3CurrentCatalog:current,expectedDocument:JSON.stringify(source),v3ReservationExpiration:true as const,v3ExpectedRetainedDocument:expected},
    {collectionName:'v3RestoredTicketSources',document:{...claim,...scope,state:'CANCELLED',cancelReason:'EXPIRED'},v3CurrentCatalog:current,
      ...(existing ? {expectedDocument:JSON.stringify(existing)} : {requireAbsent:true}),v3ReservationExpiration:true as const,v3ExpectedRetainedDocument:expected},
    ...await planReservationCommitmentRelease(source,(collection,id)=>db.getDocument(collection as any,id),at),
  ];
  if (!dbAdapter.saveDocumentsAtomically) throw new LargeMasterSyncV3Error('SYNC_V3_ATOMIC_COMMIT_REQUIRED');
  await session.assertCurrent();
  await dbAdapter.saveDocumentsAtomically(documents);
  return true;
}
