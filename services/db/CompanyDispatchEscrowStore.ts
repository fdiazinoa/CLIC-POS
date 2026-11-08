import {V3_FINANCIAL_MUTABLE_FIELDS,V3_FINANCIAL_CAS_PROTECTED_FIELDS} from './LargeMasterSyncV3FinancialRetention';
/** Internal SQLite writer kernel. All callers must hold the native adapter's
 * BEGIN IMMEDIATE transaction; installation requires the verified delivery path.
 * Web/LAN adapters must not emulate these operations with independent requests. */
export type DispatchSQL = {
 query(sql:string,params?:unknown[]):Promise<{values?:Record<string,unknown>[]}>
 run(sql:string,params?:unknown[],transaction?:boolean):Promise<unknown>
};
export const COMPANY_DISPATCH_ESCROW_SCHEMA=`
CREATE TABLE IF NOT EXISTS pos_dispatch_pool_v1(pool_id TEXT PRIMARY KEY,binding_id TEXT NOT NULL,generation TEXT NOT NULL,policy_revision INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN('IMMEDIATE','FROZEN','WAREHOUSE_DISPATCH')),barrier_id TEXT,barrier_digest TEXT);
CREATE TABLE IF NOT EXISTS pos_dispatch_active_pool_v1(singleton INTEGER PRIMARY KEY CHECK(singleton=1),pool_id TEXT NOT NULL REFERENCES pos_dispatch_pool_v1(pool_id),native_binding TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pos_dispatch_capture_cursor_v1(pool_id TEXT PRIMARY KEY REFERENCES pos_dispatch_pool_v1(pool_id),last_sequence INTEGER NOT NULL CHECK(last_sequence>=0));
CREATE TRIGGER IF NOT EXISTS dispatch_capture_cursor_monotonic BEFORE UPDATE ON pos_dispatch_capture_cursor_v1 WHEN NEW.pool_id IS NOT OLD.pool_id OR NEW.last_sequence<>OLD.last_sequence+1 BEGIN SELECT RAISE(ABORT,'DISPATCH_CAPTURE_CURSOR_CONFLICT');END;
CREATE TRIGGER IF NOT EXISTS dispatch_capture_cursor_durable BEFORE DELETE ON pos_dispatch_capture_cursor_v1 BEGIN SELECT RAISE(ABORT,'DISPATCH_CAPTURE_CURSOR_DURABLE');END;
CREATE TABLE IF NOT EXISTS pos_dispatch_native_capture_v1(checkout_id TEXT PRIMARY KEY,pool_id TEXT NOT NULL REFERENCES pos_dispatch_pool_v1(pool_id),transaction_id TEXT NOT NULL UNIQUE,event_id TEXT NOT NULL UNIQUE,sequence INTEGER NOT NULL CHECK(sequence>0),source_snapshot_json TEXT NOT NULL,financial_intent_digest TEXT,UNIQUE(pool_id,sequence),FOREIGN KEY(checkout_id,pool_id,transaction_id,event_id) REFERENCES pos_dispatch_precharge_v1(checkout_id,pool_id,transaction_id,event_id));
CREATE TRIGGER IF NOT EXISTS dispatch_capture_immutable BEFORE UPDATE ON pos_dispatch_native_capture_v1 BEGIN SELECT RAISE(ABORT,'DISPATCH_CAPTURE_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS dispatch_capture_durable BEFORE DELETE ON pos_dispatch_native_capture_v1 BEGIN SELECT RAISE(ABORT,'DISPATCH_CAPTURE_DURABLE');END;
CREATE TABLE IF NOT EXISTS pos_dispatch_quota_v1(id TEXT PRIMARY KEY,pool_id TEXT NOT NULL REFERENCES pos_dispatch_pool_v1(pool_id),authority_json TEXT NOT NULL,authority_hash TEXT NOT NULL,granted_minor INTEGER NOT NULL CHECK(granted_minor>0),consumed_minor INTEGER NOT NULL DEFAULT 0 CHECK(consumed_minor>=0 AND consumed_minor<=granted_minor),returned_minor INTEGER NOT NULL DEFAULT 0 CHECK(returned_minor>=0 AND consumed_minor+returned_minor<=granted_minor),state TEXT NOT NULL CHECK(state IN('ACTIVE','RETURN_PENDING','RETURNED')));
CREATE TABLE IF NOT EXISTS pos_dispatch_quota_delivery_v1(quota_id TEXT PRIMARY KEY REFERENCES pos_dispatch_quota_v1(id),witness_hash TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS dispatch_quota_delivery_immutable_v1 BEFORE UPDATE ON pos_dispatch_quota_delivery_v1 BEGIN SELECT RAISE(ABORT,'DISPATCH_DELIVERY_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS dispatch_quota_delivery_durable_v1 BEFORE DELETE ON pos_dispatch_quota_delivery_v1 BEGIN SELECT RAISE(ABORT,'DISPATCH_DELIVERY_DURABLE');END;
CREATE TABLE IF NOT EXISTS pos_dispatch_precharge_v1(checkout_id TEXT PRIMARY KEY,pool_id TEXT NOT NULL REFERENCES pos_dispatch_pool_v1(pool_id),transaction_id TEXT NOT NULL UNIQUE,demand_digest TEXT NOT NULL,source_json TEXT NOT NULL,phase TEXT NOT NULL CHECK(phase IN('PREPARED','EFFECT_POSSIBLE','COMMITTED','ABANDONED')),effect_digest TEXT,effects_json TEXT,event_id TEXT UNIQUE);
CREATE UNIQUE INDEX IF NOT EXISTS dispatch_precharge_capture_identity ON pos_dispatch_precharge_v1(checkout_id,pool_id,transaction_id,event_id);
CREATE TABLE IF NOT EXISTS pos_dispatch_precharge_lines_v1(checkout_id TEXT NOT NULL REFERENCES pos_dispatch_precharge_v1(checkout_id),quota_id TEXT NOT NULL REFERENCES pos_dispatch_quota_v1(id),quantity_minor INTEGER NOT NULL CHECK(quantity_minor>0 AND quantity_minor%100=0),PRIMARY KEY(checkout_id,quota_id));
CREATE TRIGGER IF NOT EXISTS dispatch_quota_immutable_v1 BEFORE UPDATE ON pos_dispatch_quota_v1 WHEN OLD.id IS NOT NEW.id OR OLD.pool_id IS NOT NEW.pool_id OR OLD.authority_json IS NOT NEW.authority_json OR OLD.authority_hash IS NOT NEW.authority_hash OR OLD.granted_minor IS NOT NEW.granted_minor OR NEW.consumed_minor<OLD.consumed_minor OR NEW.returned_minor<OLD.returned_minor OR OLD.state='RETURNED' AND NEW.state<>'RETURNED' BEGIN SELECT RAISE(ABORT,'DISPATCH_QUOTA_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS dispatch_precharge_immutable_v1 BEFORE UPDATE ON pos_dispatch_precharge_v1 WHEN OLD.checkout_id IS NOT NEW.checkout_id OR OLD.pool_id IS NOT NEW.pool_id OR OLD.transaction_id IS NOT NEW.transaction_id OR OLD.demand_digest IS NOT NEW.demand_digest OR OLD.source_json IS NOT NEW.source_json OR OLD.effects_json IS NOT NULL AND OLD.effects_json IS NOT NEW.effects_json OR OLD.effect_digest IS NOT NULL AND OLD.effect_digest IS NOT NEW.effect_digest OR OLD.event_id IS NOT NULL AND OLD.event_id IS NOT NEW.event_id OR OLD.phase IN('COMMITTED','ABANDONED') AND OLD.phase IS NOT NEW.phase OR OLD.phase='EFFECT_POSSIBLE' AND NEW.phase NOT IN('EFFECT_POSSIBLE','COMMITTED') BEGIN SELECT RAISE(ABORT,'DISPATCH_PRECHARGE_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS dispatch_precharge_lines_immutable_v1 BEFORE UPDATE ON pos_dispatch_precharge_lines_v1 BEGIN SELECT RAISE(ABORT,'DISPATCH_DEMAND_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS dispatch_quota_durable_v1 BEFORE DELETE ON pos_dispatch_quota_v1 BEGIN SELECT RAISE(ABORT,'DISPATCH_QUOTA_DURABLE');END;
CREATE TRIGGER IF NOT EXISTS dispatch_precharge_durable_v1 BEFORE DELETE ON pos_dispatch_precharge_v1 BEGIN SELECT RAISE(ABORT,'DISPATCH_PRECHARGE_DURABLE');END;
CREATE TRIGGER IF NOT EXISTS dispatch_precharge_lines_durable_v1 BEFORE DELETE ON pos_dispatch_precharge_lines_v1 BEGIN SELECT RAISE(ABORT,'DISPATCH_DEMAND_DURABLE');END;
`;
const mutablePaths=[...V3_FINANCIAL_MUTABLE_FIELDS,...V3_FINANCIAL_CAS_PROTECTED_FIELDS,'relatedTransactions'].map(k=>`'$.${k}'`).join(',');
const financialTree=(row:string)=>`json_tree(json_remove(${row}.data,${mutablePaths}))`;
const differentFinancialSource=(a:string,b:string)=>`EXISTS(SELECT fullkey,type,atom FROM ${financialTree(a)} EXCEPT SELECT fullkey,type,atom FROM ${financialTree(b)}) OR EXISTS(SELECT fullkey,type,atom FROM ${financialTree(b)} EXCEPT SELECT fullkey,type,atom FROM ${financialTree(a)})`;
/** Additive guards for the new source only. Ordinary V3/IMMEDIATE rows keep their
 * existing retention/CAS contracts. The native writer seals bytes before INSERT. */
export const DISPATCH_FINANCIAL_SOURCE_GUARDS=`
CREATE TRIGGER IF NOT EXISTS dispatch_financial_source_insert BEFORE INSERT ON documents WHEN NEW.collection_name IN('transactions','transactionHistory') AND json_extract(NEW.data,'$.inventoryEffectsContract')='WAREHOUSE_RESERVATION_V1' AND NOT EXISTS(SELECT 1 FROM documents d WHERE d.collection_name=NEW.collection_name AND d.doc_id=NEW.doc_id)
BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM pos_dispatch_native_capture_v1 c JOIN pos_dispatch_precharge_v1 p ON p.checkout_id=c.checkout_id WHERE c.transaction_id=NEW.doc_id AND c.source_snapshot_json=NEW.data AND p.phase='COMMITTED' AND p.event_id=c.event_id) THEN RAISE(ABORT,'DISPATCH_FINANCIAL_CAPTURE_REQUIRED') END;END;
CREATE TRIGGER IF NOT EXISTS dispatch_financial_source_update BEFORE UPDATE ON documents WHEN (OLD.collection_name IN('transactions','transactionHistory') OR NEW.collection_name IN('transactions','transactionHistory')) AND (json_extract(OLD.data,'$.inventoryEffectsContract')='WAREHOUSE_RESERVATION_V1' OR json_extract(NEW.data,'$.inventoryEffectsContract')='WAREHOUSE_RESERVATION_V1') AND (OLD.collection_name IS NOT NEW.collection_name OR OLD.doc_id IS NOT NEW.doc_id OR ${differentFinancialSource('OLD','NEW')})
BEGIN SELECT RAISE(ABORT,'DISPATCH_FINANCIAL_SOURCE_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS dispatch_financial_source_delete BEFORE DELETE ON documents WHEN OLD.collection_name IN('transactions','transactionHistory') AND json_extract(OLD.data,'$.inventoryEffectsContract')='WAREHOUSE_RESERVATION_V1'
BEGIN SELECT CASE WHEN OLD.collection_name='transactionHistory' OR NOT EXISTS(SELECT 1 FROM documents h JOIN pos_dispatch_native_capture_v1 c ON c.transaction_id=h.doc_id WHERE h.collection_name='transactionHistory' AND h.doc_id=OLD.doc_id AND NOT(${differentFinancialSource('OLD','h')})) THEN RAISE(ABORT,'DISPATCH_RETAINED_SOURCE_REQUIRED') END;END;
`;
export function canonicalDispatchJSON(value:unknown):string{
 // Native constructors may retain Date objects until SQLite JSON serialization.
 // Canonical comparison must use the same ISO bytes as that durable JSON.
 if(value instanceof Date){if(!Number.isFinite(value.getTime()))throw Error('DISPATCH_FINANCIAL_PLAN_DATE');return JSON.stringify(value.toISOString());}
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonicalDispatchJSON).join(',')+']';
 return '{'+Object.keys(value).sort().filter(k=>(value as Record<string,unknown>)[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonicalDispatchJSON((value as Record<string,unknown>)[k])).join(',')+'}';
}
export function dispatchPaymentIntents(payments:unknown):string{
 if(!Array.isArray(payments)||!payments.length)throw Error('DISPATCH_PAYMENT_INTENTS_REQUIRED');
 const intents=payments.map(payment=>{
  if(!payment||typeof payment!=='object')throw Error('DISPATCH_PAYMENT_INTENT_INVALID');
  const p=payment as Record<string,unknown>;
  if(typeof p.id!=='string'||!p.id||typeof p.amount!=='number'||!Number.isFinite(p.amount)||p.amount<0)throw Error('DISPATCH_PAYMENT_INTENT_INVALID');
  return Object.fromEntries(['id','method','methodId','amount','currencyCode','amountOriginal','exchangeRate','gatewayProvider','gatewayIntegrationId','gatewayIdempotencyKey','gatewayTransactionType','creditOverrideApproved'].map(k=>[k,p[k]]));
 }).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
 if(new Set(intents.map(p=>p.id)).size!==intents.length)throw Error('DISPATCH_PAYMENT_INTENT_DUPLICATE');
 return canonicalDispatchJSON(intents);
}
export function dispatchCommercialSource(source:Record<string,unknown>):string{
 const descriptor=source.companyDispatchSource&&typeof source.companyDispatchSource==='object'?{...(source.companyDispatchSource as Record<string,unknown>)}:source.companyDispatchSource;
 if(descriptor&&typeof descriptor==='object')delete (descriptor as Record<string,unknown>).sequence;
 const semantic={...source,companyDispatchSource:descriptor};
 return canonicalDispatchJSON(Object.fromEntries(['companyDispatchSource','items','customerId','customer','customerSnapshot','userId','currency','settlementCurrencyCode','baseCurrencyCode','total','netAmount','tax','taxAmount','taxBreakdown','isTaxIncluded','discount','discountAmount','discountType','discountValue','subtotal','serviceChargeAmount','voluntaryTip','settlementPayableBase','couponCode','couponDiscountAmount','v3Binding','v3WarehouseId'].map(k=>[k,semantic[k as keyof typeof semantic]])));
}
export type DispatchDemand={quotaId:string;quantityMinor:number};
const fail=(code:string):never=>{throw new Error(code);};
const safe=(n:number)=>Number.isSafeInteger(n)&&n>0&&n%100===0;
export async function prepareDispatchPrecharge(sql:DispatchSQL,input:{checkoutId:string;transactionId:string;poolId:string;demandDigest:string;source:Record<string,unknown>;demands:DispatchDemand[]}):Promise<void>{
 const {checkoutId,transactionId,poolId,demandDigest}=input;
 const sourceJSON=dispatchCommercialSource(input.source);
 if(!checkoutId||!transactionId||!poolId||!/^[a-f0-9]{64}$/.test(demandDigest)||input.demands.length>200)fail('DISPATCH_PRECHARGE_INVALID');
 const demands=[...input.demands].sort((a,b)=>a.quotaId.localeCompare(b.quotaId));
 if(new Set(demands.map(x=>x.quotaId)).size!==demands.length||demands.some(x=>!safe(x.quantityMinor)))fail('DISPATCH_DEMAND_INVALID');
 const old=(await sql.query('SELECT * FROM pos_dispatch_precharge_v1 WHERE checkout_id=?',[checkoutId])).values?.[0];
 if(old){const prior=(await sql.query('SELECT quota_id,quantity_minor FROM pos_dispatch_precharge_lines_v1 WHERE checkout_id=? ORDER BY quota_id',[checkoutId])).values||[];
 if(old.pool_id!==poolId||old.transaction_id!==transactionId||old.demand_digest!==demandDigest||old.source_json!==sourceJSON||JSON.stringify(prior.map(x=>({quotaId:x.quota_id,quantityMinor:Number(x.quantity_minor)})))!==JSON.stringify(demands))fail('DISPATCH_PRECHARGE_PAYLOAD_CONFLICT');
 if(old.phase==='ABANDONED')fail('DISPATCH_PRECHARGE_ABANDONED');if(old.phase==='PREPARED')await assertDispatchTrackingClocks(sql,demands.map(d=>d.quotaId));return;}
 const pool=(await sql.query('SELECT state FROM pos_dispatch_pool_v1 WHERE pool_id=?',[poolId])).values?.[0];
 if(pool?.state!=='WAREHOUSE_DISPATCH')fail('DISPATCH_POOL_FROZEN_OR_UNAVAILABLE');
 for(const d of demands){const quota=(await sql.query("SELECT q.*,COALESCE((SELECT SUM(l.quantity_minor) FROM pos_dispatch_precharge_lines_v1 l JOIN pos_dispatch_precharge_v1 p ON p.checkout_id=l.checkout_id WHERE l.quota_id=q.id AND p.phase IN('PREPARED','EFFECT_POSSIBLE')),0) prepared FROM pos_dispatch_quota_v1 q WHERE q.id=? AND q.pool_id=?",[d.quotaId,poolId])).values?.[0];
 if(!quota||quota.state!=='ACTIVE'||Number(quota.granted_minor)-Number(quota.consumed_minor)-Number(quota.returned_minor)-Number(quota.prepared)<d.quantityMinor)fail('DISPATCH_LOCAL_QUOTA_EXHAUSTED');}
 await assertDispatchTrackingClocks(sql,demands.map(d=>d.quotaId));
 await sql.run("INSERT INTO pos_dispatch_precharge_v1(checkout_id,pool_id,transaction_id,demand_digest,source_json,phase) VALUES(?,?,?,?,?,'PREPARED')",[checkoutId,poolId,transactionId,demandDigest,sourceJSON],false);
 for(const d of demands)await sql.run('INSERT INTO pos_dispatch_precharge_lines_v1(checkout_id,quota_id,quantity_minor) VALUES(?,?,?)',[checkoutId,d.quotaId,d.quantityMinor],false);
}
export async function markDispatchEffectPossible(sql:DispatchSQL,checkoutId:string,effectDigest:string,payments:unknown[]):Promise<void>{
 if(!Array.isArray(payments)||!payments.length||!/^[a-f0-9]{64}$/.test(effectDigest))fail('DISPATCH_EFFECT_DIGEST_REQUIRED');
 const p=(await sql.query('SELECT * FROM pos_dispatch_precharge_v1 WHERE checkout_id=?',[checkoutId])).values?.[0];
 if(!p||p.phase==='ABANDONED'||p.phase==='COMMITTED'||p.effect_digest&&p.effect_digest!==effectDigest||p.effects_json&&p.effects_json!==dispatchPaymentIntents(payments))fail('DISPATCH_PRECHARGE_EFFECT_CONFLICT');
 if(p.phase==='EFFECT_POSSIBLE')return; // exact paid/uncertain replay retains its original time, including expiry/cutover
 const pool=(await sql.query('SELECT state FROM pos_dispatch_pool_v1 WHERE pool_id=?',[p.pool_id])).values?.[0];
 if(pool?.state!=='WAREHOUSE_DISPATCH')fail('DISPATCH_POOL_FROZEN_OR_UNAVAILABLE');
 const quotaIds=((await sql.query('SELECT quota_id FROM pos_dispatch_precharge_lines_v1 WHERE checkout_id=?',[checkoutId])).values||[]).map(row=>String(row.quota_id));
 const times=await assertDispatchTrackingClocks(sql,quotaIds);if(times.length)await sql.run('INSERT INTO pos_dispatch_effect_clock_v2 VALUES(?,?)',[checkoutId,canonicalDispatchJSON({schemaVersion:1,source:'DISPATCH_EFFECT_CLOCK_V1',checkoutId,transactionId:p.transaction_id,times})],false);
 await sql.run("UPDATE pos_dispatch_precharge_v1 SET phase='EFFECT_POSSIBLE',effect_digest=?,effects_json=? WHERE checkout_id=?",[effectDigest,dispatchPaymentIntents(payments),checkoutId],false);
}
/** Must share the transaction with the durable document and outbox INSERTs.
 * Never call as an independent post-payment/ACK follow-up transaction. */
export async function commitDispatchPrecharge(sql:DispatchSQL,checkoutId:string,transactionId:string,eventId:string,source:Record<string,unknown>):Promise<void>{
 const p=(await sql.query('SELECT * FROM pos_dispatch_precharge_v1 WHERE checkout_id=?',[checkoutId])).values?.[0];
 if(!p||p.transaction_id!==transactionId||!eventId||p.phase==='ABANDONED')fail('DISPATCH_PRECHARGE_COMMIT_CONFLICT');
 if(p.source_json!==dispatchCommercialSource(source)||p.effects_json!==dispatchPaymentIntents(source.payments))fail('DISPATCH_PRECHARGE_SOURCE_CHANGED');
 if(p.phase==='COMMITTED'){if(p.event_id!==eventId)fail('DISPATCH_PRECHARGE_EVENT_CONFLICT');return;}
 if(p.phase!=='EFFECT_POSSIBLE')fail('DISPATCH_EFFECT_POSSIBLE_REQUIRED');
 const lines=(await sql.query('SELECT * FROM pos_dispatch_precharge_lines_v1 WHERE checkout_id=? ORDER BY quota_id',[checkoutId])).values||[];
 for(const l of lines)await sql.run('UPDATE pos_dispatch_quota_v1 SET consumed_minor=consumed_minor+? WHERE id=?',[l.quantity_minor,l.quota_id],false);
 await sql.run("UPDATE pos_dispatch_precharge_v1 SET phase='COMMITTED',event_id=? WHERE checkout_id=?",[eventId,checkoutId],false);
}
export async function abandonDispatchPrecharge(sql:DispatchSQL,checkoutId:string):Promise<void>{
 const p=(await sql.query('SELECT phase FROM pos_dispatch_precharge_v1 WHERE checkout_id=?',[checkoutId])).values?.[0];
 if(!p||p.phase==='ABANDONED')return;
 if(p.phase!=='PREPARED')fail('DISPATCH_EFFECT_POSSIBLE_CANNOT_RELEASE');
 await sql.run("UPDATE pos_dispatch_precharge_v1 SET phase='ABANDONED' WHERE checkout_id=?",[checkoutId],false);
}
/** Installation is non-renewing. The authenticated delivery layer first persists
 * ownership outside SQLite; restoring a blank DB must never mint this quota again. */
export async function installDispatchQuota(sql:DispatchSQL,delivery:import('../dispatch/DispatchAuthority').DispatchQuotaDelivery,poolId:string,previouslySeen:boolean,witnessHash:string):Promise<void>{
 if(!/^[a-f0-9]{64}$/.test(witnessHash))fail('DISPATCH_DELIVERY_WITNESS_REQUIRED');
 const old=(await sql.query('SELECT * FROM pos_dispatch_quota_v1 WHERE id=?',[delivery.id])).values?.[0];
 if(old){const witness=(await sql.query('SELECT witness_hash FROM pos_dispatch_quota_delivery_v1 WHERE quota_id=?',[delivery.id])).values?.[0];if(witness?.witness_hash!==witnessHash)fail('DISPATCH_DELIVERY_WITNESS_MISMATCH');if(old.pool_id!==poolId||old.authority_hash!==delivery.authorityHash||old.authority_json!==delivery.authorityCanonical||Number(old.granted_minor)!==delivery.grantedMinor)fail('DISPATCH_DELIVERY_REPLAY_CONFLICT');return;}
 if(previouslySeen)fail('DISPATCH_LOCAL_OWNERSHIP_MISSING');
 const pool=(await sql.query('SELECT * FROM pos_dispatch_pool_v1 WHERE pool_id=?',[poolId])).values?.[0];
 if(!pool||pool.state!=='WAREHOUSE_DISPATCH'||pool.binding_id!==delivery.scope.bindingId||pool.generation!==delivery.scope.generation||Number(pool.policy_revision)!==delivery.policyRevision)fail('DISPATCH_DELIVERY_POOL_NOT_INSTALLED');
 await sql.run("INSERT INTO pos_dispatch_quota_v1(id,pool_id,authority_json,authority_hash,granted_minor,state) VALUES(?,?,?,?,?,'ACTIVE')",[delivery.id,poolId,delivery.authorityCanonical,delivery.authorityHash,delivery.grantedMinor],false);
 await sql.run('INSERT INTO pos_dispatch_quota_delivery_v1(quota_id,witness_hash) VALUES(?,?)',[delivery.id,witnessHash],false);
}

/** The financial writer seals the final receipt and assigns its sequence only at
 * commit. An abandoned PREPARED checkout therefore never creates a cursor gap. */
export async function sealDispatchNativeCapture(sql:DispatchSQL,checkoutId:string,transactionId:string,eventId:string,source:Record<string,unknown>,financialIntentDigest:string):Promise<Record<string,unknown>>{
 if(!/^[a-f0-9]{64}$/.test(financialIntentDigest))fail('DISPATCH_FINANCIAL_INTENT_REQUIRED');
 const charge=(await sql.query("SELECT * FROM pos_dispatch_precharge_v1 WHERE checkout_id=? AND transaction_id=? AND event_id=? AND phase='COMMITTED'",[checkoutId,transactionId,eventId])).values?.[0];
 if(!charge||source.inventoryEffectsContract!=='WAREHOUSE_RESERVATION_V1')fail('DISPATCH_CAPTURE_COMMIT_REQUIRED');
 const descriptor=source.companyDispatchSource as Record<string,unknown>|undefined;
 if(descriptor?.checkoutId!==checkoutId||source.id!==transactionId)fail('DISPATCH_CAPTURE_SOURCE_IDENTITY');
 const prior=(await sql.query('SELECT * FROM pos_dispatch_native_capture_v1 WHERE checkout_id=?',[checkoutId])).values?.[0];
 if(prior){if(!/^[a-f0-9]{64}$/.test(String(prior.financial_intent_digest||'')))fail('DISPATCH_CAPTURE_RECONCILIATION_REQUIRED');const retained=JSON.parse(String(prior.source_snapshot_json));const candidate={...source,companyDispatchSource:{...descriptor,sequence:Number(prior.sequence)}};
  if(prior.transaction_id!==transactionId||prior.event_id!==eventId||prior.financial_intent_digest!==financialIntentDigest||canonicalDispatchJSON(retained)!==canonicalDispatchJSON(candidate))fail('DISPATCH_CAPTURE_REPLAY_CONFLICT');return retained;
 }
 const cursor=(await sql.query('SELECT last_sequence FROM pos_dispatch_capture_cursor_v1 WHERE pool_id=?',[charge.pool_id])).values?.[0];
 const sequence=Number(cursor?.last_sequence)+1;if(!cursor||!Number.isSafeInteger(sequence)||sequence<1)fail('DISPATCH_NATIVE_CURSOR_REQUIRED');
 const captured={...source,companyDispatchSource:{...descriptor,sequence}};
 await sql.run('UPDATE pos_dispatch_capture_cursor_v1 SET last_sequence=? WHERE pool_id=? AND last_sequence=?',[sequence,charge.pool_id,sequence-1],false);
 if(Number((await sql.query('SELECT changes() n')).values?.[0]?.n)!==1)fail('DISPATCH_CAPTURE_CURSOR_CONFLICT');
 await sql.run('INSERT INTO pos_dispatch_native_capture_v1(checkout_id,pool_id,transaction_id,event_id,sequence,source_snapshot_json,financial_intent_digest)VALUES(?,?,?,?,?,?,?)',[checkoutId,charge.pool_id,transactionId,eventId,sequence,JSON.stringify(captured),financialIntentDigest],false);
 return captured;
}

/** Snapshot the whole original financial plan, not just the receipt. Reusing an
 * event cannot smuggle a second wallet/customer/ledger mutation into a replay. */
export async function dispatchFinancialIntentDigest(input:{documents:Array<{collectionName:string;document:Record<string,unknown>}>;outboxEvent:{payload:Record<string,unknown>};additionalOutboxEvents?:Array<{payload:Record<string,unknown>}>;dispatchCommit?:{transactionId:string}}):Promise<string>{
 const plan=JSON.parse(JSON.stringify(input));
 const normalize=(document:Record<string,unknown>)=>{if(document?.id===input.dispatchCommit?.transactionId&&document.companyDispatchSource&&typeof document.companyDispatchSource==='object')delete (document.companyDispatchSource as Record<string,unknown>).sequence;};
 for(const mutation of plan.documents)if(['transactions','transactionHistory'].includes(mutation.collectionName))normalize(mutation.document);
 for(const event of [plan.outboxEvent,...(plan.additionalOutboxEvents||[])])if(event.payload?.transaction)normalize(event.payload.transaction);
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalDispatchJSON(plan)))),value=>value.toString(16).padStart(2,'0')).join('');
}

/** WebViews without structuredClone must still take an owned snapshot before
 * waiting on the writer queue. Financial plans contain data, never callbacks. */
export function snapshotDispatchFinancialPlan<T>(value:T):T{
 const seen=new WeakMap<object,unknown>();
 const copy=(entry:unknown):unknown=>{
  if(entry===null||typeof entry!=='object'){if(typeof entry==='function'||typeof entry==='symbol'||typeof entry==='bigint')fail('DISPATCH_FINANCIAL_PLAN_NOT_SERIALIZABLE');return entry;}
  if(seen.has(entry))fail('DISPATCH_FINANCIAL_PLAN_CYCLE');
  if(entry instanceof Date){if(!Number.isFinite(entry.getTime()))fail('DISPATCH_FINANCIAL_PLAN_DATE');return new Date(entry.getTime());}
  if(entry instanceof ArrayBuffer)return entry.slice(0);
  if(ArrayBuffer.isView(entry)){const bytes=entry.buffer.slice(entry.byteOffset,entry.byteOffset+entry.byteLength);return entry instanceof DataView?new DataView(bytes):new (entry.constructor as new(buffer:ArrayBufferLike)=>unknown)(bytes);}
  if(!Array.isArray(entry)&&Object.getPrototypeOf(entry)!==Object.prototype&&Object.getPrototypeOf(entry)!==null)fail('DISPATCH_FINANCIAL_PLAN_NOT_SERIALIZABLE');
  seen.set(entry,true);const result=Array.isArray(entry)?entry.map(copy):Object.fromEntries(Object.entries(entry).map(([key,item])=>[key,copy(item)]));seen.delete(entry);return result;
 };
 return copy(value) as T;
}

// Auxiliary to V1 financial tables: never changes retained authority/source bytes.
export type DispatchDeliveryClock={serverDeliveredMs:number;localRequestStartedMs:number;localReceivedMs:number};
/** Physical access paths only: excluded from the retained V1 logical schema
 * digest. Reinstalling these indexes never changes ownership/source bytes. */
export const DISPATCH_QUERY_INDEX_SCHEMA=`
CREATE INDEX IF NOT EXISTS dispatch_precharge_quota_checkout_v1 ON pos_dispatch_precharge_lines_v1(quota_id,checkout_id);
CREATE INDEX IF NOT EXISTS dispatch_quota_pool_state_id_v1 ON pos_dispatch_quota_v1(pool_id,state,id);
`;
export const DISPATCH_TRACKING_CLOCK_SCHEMA_V2=`
CREATE TABLE IF NOT EXISTS pos_dispatch_delivery_clock_v2(quota_id TEXT PRIMARY KEY REFERENCES pos_dispatch_quota_v1(id),witness_hash TEXT NOT NULL,server_delivered_ms INTEGER NOT NULL,local_request_started_ms INTEGER NOT NULL,local_received_ms INTEGER NOT NULL,max_local_ms INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS dispatch_clock_immutable_v2 BEFORE UPDATE ON pos_dispatch_delivery_clock_v2 WHEN OLD.quota_id IS NOT NEW.quota_id OR OLD.witness_hash IS NOT NEW.witness_hash OR OLD.server_delivered_ms IS NOT NEW.server_delivered_ms OR OLD.local_request_started_ms IS NOT NEW.local_request_started_ms OR OLD.local_received_ms IS NOT NEW.local_received_ms OR NEW.max_local_ms<OLD.max_local_ms BEGIN SELECT RAISE(ABORT,'DISPATCH_CLOCK_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS dispatch_clock_durable_v2 BEFORE DELETE ON pos_dispatch_delivery_clock_v2 BEGIN SELECT RAISE(ABORT,'DISPATCH_CLOCK_DURABLE');END;
CREATE TABLE IF NOT EXISTS pos_dispatch_effect_clock_v2(checkout_id TEXT PRIMARY KEY REFERENCES pos_dispatch_precharge_v1(checkout_id),proof_json TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS dispatch_effect_clock_immutable_v2 BEFORE UPDATE ON pos_dispatch_effect_clock_v2 BEGIN SELECT RAISE(ABORT,'DISPATCH_EFFECT_CLOCK_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS dispatch_effect_clock_durable_v2 BEFORE DELETE ON pos_dispatch_effect_clock_v2 BEGIN SELECT RAISE(ABORT,'DISPATCH_EFFECT_CLOCK_DURABLE');END;
`;
function dispatchTrackingLogicalTime(authority:Record<string,any>,anchor:Record<string,any>|undefined,localNow:number):number{
 const source=authority.trackingClockSource;
 if(source?.schemaVersion!==1||source.expiresOn!==(authority.dimensions?.expiresOn||null)||source.source!=='DISPATCH_TRACKING_CLOCK_SOURCE_V1'||!anchor||!Number.isSafeInteger(localNow)||localNow<Number(anchor.max_local_ms)||localNow<Number(anchor.local_received_ms))fail('DISPATCH_TRACKING_CLOCK_REQUIRED');
 const logical=Number(anchor.server_delivered_ms)+(localNow-Number(anchor.local_request_started_ms));
 if(!Number.isSafeInteger(logical)||logical>8640000000000000||!Number.isFinite(Date.parse(source.issuedAt))||!Number.isFinite(Date.parse(source.receivedAt))||logical<Date.parse(source.issuedAt)||logical<Date.parse(source.receivedAt))fail('DISPATCH_TRACKING_CLOCK_REVERSED');
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:source.businessTimezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(logical));
 if(source.expiresOn&&date>source.expiresOn)fail('TRACKING_LOT_EXPIRED');
 return logical;
}
export async function installDispatchDeliveryClock(sql:DispatchSQL,delivery:Record<string,any>,witnessHash:string,previouslySeen:boolean,clock?:DispatchDeliveryClock):Promise<void>{
 if(!delivery.trackingClockSource)return;
 const prior=(await sql.query('SELECT * FROM pos_dispatch_delivery_clock_v2 WHERE quota_id=?',[delivery.id])).values?.[0];
 if(prior){if(prior.witness_hash!==witnessHash)fail('DISPATCH_TRACKING_CLOCK_REQUIRED');return;}
 if(previouslySeen||!clock||![clock.serverDeliveredMs,clock.localRequestStartedMs,clock.localReceivedMs].every(Number.isSafeInteger)||clock.localReceivedMs<clock.localRequestStartedMs||clock.serverDeliveredMs<Date.parse(delivery.trackingClockSource.issuedAt))fail('DISPATCH_TRACKING_CLOCK_REQUIRED');
 const anchor={server_delivered_ms:clock.serverDeliveredMs,local_request_started_ms:clock.localRequestStartedMs,local_received_ms:clock.localReceivedMs,max_local_ms:clock.localReceivedMs};dispatchTrackingLogicalTime(delivery,anchor,clock.localReceivedMs);
 await sql.run('INSERT INTO pos_dispatch_delivery_clock_v2 VALUES(?,?,?,?,?,?)',[delivery.id,witnessHash,clock.serverDeliveredMs,clock.localRequestStartedMs,clock.localReceivedMs,clock.localReceivedMs],false);
}
export async function assertDispatchTrackingClocks(sql:DispatchSQL,quotaIds:string[],localNow=Date.now()):Promise<Array<{quotaId:string;effectAt:string}>>{
 const times:Array<{quotaId:string;effectAt:string}>=[];
 for(const id of [...quotaIds].sort()){const row=(await sql.query('SELECT q.authority_json,d.witness_hash FROM pos_dispatch_quota_v1 q LEFT JOIN pos_dispatch_quota_delivery_v1 d ON d.quota_id=q.id WHERE q.id=?',[id])).values?.[0];if(!row)fail('DISPATCH_QUOTA_REQUIRED');const authority=JSON.parse(String(row.authority_json));if(authority.catalogSource?.stockSelectionProfile==='DISPATCH_QUOTA_GRAIN_V2'&&authority.dimensions?.trackingUnitId&&!authority.trackingClockSource)fail('DISPATCH_TRACKING_CLOCK_REQUIRED');if(!authority.trackingClockSource)continue;
  const clock=(await sql.query('SELECT * FROM pos_dispatch_delivery_clock_v2 WHERE quota_id=?',[id])).values?.[0];if(clock?.witness_hash!==row.witness_hash)fail('DISPATCH_TRACKING_CLOCK_REQUIRED');const logical=dispatchTrackingLogicalTime(authority,clock,localNow);times.push({quotaId:id,effectAt:new Date(logical).toISOString()});await sql.run('UPDATE pos_dispatch_delivery_clock_v2 SET max_local_ms=? WHERE quota_id=?',[localNow,id],false);
 }
 return times;
}
export async function readDispatchEffectClock(sql:DispatchSQL,checkoutId:string):Promise<Record<string,unknown>|null>{const row=(await sql.query('SELECT proof_json FROM pos_dispatch_effect_clock_v2 WHERE checkout_id=?',[checkoutId])).values?.[0];return row?JSON.parse(String(row.proof_json)):null;}
export function dispatchTrackingClockAvailable(authority:Record<string,any>,anchor:Record<string,any>,localNow=Date.now()):boolean{
 if(!authority.trackingClockSource)return !(authority.catalogSource?.stockSelectionProfile==='DISPATCH_QUOTA_GRAIN_V2'&&authority.dimensions?.trackingUnitId);
 try{if(anchor.clock_witness_hash!==anchor.witness_hash)return false;dispatchTrackingLogicalTime(authority,anchor,localNow);return true;}catch{return false;}
}
