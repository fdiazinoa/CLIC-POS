import type { Reservation } from '../../types';
import type { DurableDocumentMutation } from '../db/DatabaseAdapter';
import { LargeMasterSyncV3Error } from './LargeMasterSyncV3Types';

type Read = (collection: string, id: string) => Promise<any>;
/** Exact original local demand, never ERP committed quantities or another reserve's remainder. */
export async function planReservationCommitmentRelease(source: Reservation, read: Read, at: string): Promise<DurableDocumentMutation[]> {
  const mutations: DurableDocumentMutation[] = [];
  const quantities = new Map<string, number>();
  for (const line of source.items) quantities.set(line.id,(quantities.get(line.id) || 0)+line.quantity);
  for (const [productId,quantity] of quantities) {
    const id = `${productId}_${source.warehouseId}`;
    const before = await read('inventoryCommitments',id);
    if (!before || before.productId !== productId || before.warehouseId !== source.warehouseId
      || !Number.isFinite(before.qtyCommitted) || before.qtyCommitted < quantity) throw new LargeMasterSyncV3Error('SYNC_V3_RESERVATION_COMMITMENT_CHANGED');
    const remaining = Math.round((before.qtyCommitted-quantity)*1e8)/1e8;
    mutations.push({collectionName:'inventoryCommitments',document:{...before,qtyCommitted:remaining,updatedAt:at},expectedDocument:JSON.stringify(before)});
    const stock = await read('productStocks',id);
    if (stock) {
      const physical = Number(stock.qtyPhysical ?? stock.quantity);
      if (!Number.isFinite(physical) || stock.qtyCommitted !== before.qtyCommitted) throw new LargeMasterSyncV3Error('SYNC_V3_RESERVATION_COMMITMENT_CHANGED');
      mutations.push({collectionName:'productStocks',document:{...stock,qtyCommitted:remaining,qtyAvailable:physical-remaining,updatedAt:at},expectedDocument:JSON.stringify(stock)});
    }
  }
  return mutations;
}
