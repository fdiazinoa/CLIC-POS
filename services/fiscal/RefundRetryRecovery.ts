import type {Transaction} from '../../types';
import type {DatabaseAdapter} from '../db/DatabaseAdapter';
import {financialIdentity} from '../db/LargeMasterSyncV3FinancialRetention';

/** A committed-but-unacknowledged partial return must be recovered before the original's new
 * refund frontier can authorize another operation. This function never posts money or inventory. */
export async function recoverCommittedRefundRetry(store:DatabaseAdapter,scopeKey:string,originalId:string):Promise<Transaction|null>{
 if(!store.executeSQL) throw Error('REFUND_DURABLE_NUMBERING_REQUIRED');
 const result=await store.executeSQL(`SELECT d.data FROM documents d
 WHERE d.collection_name='refundRetryDocuments' AND json_extract(d.data,'$.scopeKey')=?
 AND json_extract(d.data,'$.transaction.originalTransactionId')=?
 AND NOT EXISTS(SELECT 1 FROM documents a WHERE a.collection_name='refundRetryAcknowledgements' AND a.doc_id=d.doc_id)
 LIMIT 2`,[scopeKey,originalId]);
 const pending=(result || []).flatMap((row:any)=>row.values || []).map((row:any)=>JSON.parse(String(row[0])));
 if(pending.length>1) throw Error('Hay varias devoluciones pendientes de conciliación para esta factura. No se emitió otra nota de crédito.');
 const draft=pending[0];if(!draft)return null;
 const active=await store.getDocument<Transaction>('transactions',draft.transaction.id);
 const history=await store.getDocument<Transaction>('transactionHistory',draft.transaction.id);
 if(!active&&!history)return null;
 if(!history?.v3CommitFingerprint || active && active.v3CommitFingerprint!==history.v3CommitFingerprint
   || financialIdentity(history)!==financialIdentity(draft.transaction)
   || active && financialIdentity(active)!==financialIdentity(history)) throw Error('No se pudo comprobar la devolución pendiente. Requiere conciliación antes de emitir otra nota de crédito.');
 await store.saveDocument('refundRetryAcknowledgements',{id:draft.id,transactionId:history.id});
 return active || history;
}
