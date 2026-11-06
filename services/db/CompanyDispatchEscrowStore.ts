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
CREATE TABLE IF NOT EXISTS pos_dispatch_quota_v1(id TEXT PRIMARY KEY,pool_id TEXT NOT NULL REFERENCES pos_dispatch_pool_v1(pool_id),authority_json TEXT NOT NULL,authority_hash TEXT NOT NULL,granted_minor INTEGER NOT NULL CHECK(granted_minor>0),consumed_minor INTEGER NOT NULL DEFAULT 0 CHECK(consumed_minor>=0 AND consumed_minor<=granted_minor),returned_minor INTEGER NOT NULL DEFAULT 0 CHECK(returned_minor>=0 AND consumed_minor+returned_minor<=granted_minor),state TEXT NOT NULL CHECK(state IN('ACTIVE','RETURN_PENDING','RETURNED')));
CREATE TABLE IF NOT EXISTS pos_dispatch_quota_delivery_v1(quota_id TEXT PRIMARY KEY REFERENCES pos_dispatch_quota_v1(id),witness_hash TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS dispatch_quota_delivery_immutable_v1 BEFORE UPDATE ON pos_dispatch_quota_delivery_v1 BEGIN SELECT RAISE(ABORT,'DISPATCH_DELIVERY_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS dispatch_quota_delivery_durable_v1 BEFORE DELETE ON pos_dispatch_quota_delivery_v1 BEGIN SELECT RAISE(ABORT,'DISPATCH_DELIVERY_DURABLE');END;
CREATE TABLE IF NOT EXISTS pos_dispatch_precharge_v1(checkout_id TEXT PRIMARY KEY,pool_id TEXT NOT NULL REFERENCES pos_dispatch_pool_v1(pool_id),transaction_id TEXT NOT NULL UNIQUE,demand_digest TEXT NOT NULL,source_json TEXT NOT NULL,phase TEXT NOT NULL CHECK(phase IN('PREPARED','EFFECT_POSSIBLE','COMMITTED','ABANDONED')),effect_digest TEXT,effects_json TEXT,event_id TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS pos_dispatch_precharge_lines_v1(checkout_id TEXT NOT NULL REFERENCES pos_dispatch_precharge_v1(checkout_id),quota_id TEXT NOT NULL REFERENCES pos_dispatch_quota_v1(id),quantity_minor INTEGER NOT NULL CHECK(quantity_minor>0 AND quantity_minor%100=0),PRIMARY KEY(checkout_id,quota_id));
CREATE TRIGGER IF NOT EXISTS dispatch_quota_immutable_v1 BEFORE UPDATE ON pos_dispatch_quota_v1 WHEN OLD.id IS NOT NEW.id OR OLD.pool_id IS NOT NEW.pool_id OR OLD.authority_json IS NOT NEW.authority_json OR OLD.authority_hash IS NOT NEW.authority_hash OR OLD.granted_minor IS NOT NEW.granted_minor OR NEW.consumed_minor<OLD.consumed_minor OR NEW.returned_minor<OLD.returned_minor OR OLD.state='RETURNED' AND NEW.state<>'RETURNED' BEGIN SELECT RAISE(ABORT,'DISPATCH_QUOTA_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS dispatch_precharge_immutable_v1 BEFORE UPDATE ON pos_dispatch_precharge_v1 WHEN OLD.checkout_id IS NOT NEW.checkout_id OR OLD.pool_id IS NOT NEW.pool_id OR OLD.transaction_id IS NOT NEW.transaction_id OR OLD.demand_digest IS NOT NEW.demand_digest OR OLD.source_json IS NOT NEW.source_json OR OLD.effects_json IS NOT NULL AND OLD.effects_json IS NOT NEW.effects_json OR OLD.effect_digest IS NOT NULL AND OLD.effect_digest IS NOT NEW.effect_digest OR OLD.event_id IS NOT NULL AND OLD.event_id IS NOT NEW.event_id OR OLD.phase IN('COMMITTED','ABANDONED') AND OLD.phase IS NOT NEW.phase OR OLD.phase='EFFECT_POSSIBLE' AND NEW.phase NOT IN('EFFECT_POSSIBLE','COMMITTED') BEGIN SELECT RAISE(ABORT,'DISPATCH_PRECHARGE_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS dispatch_precharge_lines_immutable_v1 BEFORE UPDATE ON pos_dispatch_precharge_lines_v1 BEGIN SELECT RAISE(ABORT,'DISPATCH_DEMAND_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS dispatch_quota_durable_v1 BEFORE DELETE ON pos_dispatch_quota_v1 BEGIN SELECT RAISE(ABORT,'DISPATCH_QUOTA_DURABLE');END;
CREATE TRIGGER IF NOT EXISTS dispatch_precharge_durable_v1 BEFORE DELETE ON pos_dispatch_precharge_v1 BEGIN SELECT RAISE(ABORT,'DISPATCH_PRECHARGE_DURABLE');END;
CREATE TRIGGER IF NOT EXISTS dispatch_precharge_lines_durable_v1 BEFORE DELETE ON pos_dispatch_precharge_lines_v1 BEGIN SELECT RAISE(ABORT,'DISPATCH_DEMAND_DURABLE');END;
`;
export function canonicalDispatchJSON(value:unknown):string{
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
 return canonicalDispatchJSON(Object.fromEntries(['items','customerId','customer','currency','total','tax','taxAmount','discount','subtotal','v3Binding','v3WarehouseId'].map(k=>[k,source[k]])));
}
export type DispatchDemand={quotaId:string;quantityMinor:number};
const fail=(code:string):never=>{throw new Error(code);};
const safe=(n:number)=>Number.isSafeInteger(n)&&n>0&&n%100===0;
export async function prepareDispatchPrecharge(sql:DispatchSQL,input:{checkoutId:string;transactionId:string;poolId:string;demandDigest:string;source:Record<string,unknown>;demands:DispatchDemand[]}):Promise<void>{
 const {checkoutId,transactionId,poolId,demandDigest}=input;
 const sourceJSON=dispatchCommercialSource(input.source);
 if(!checkoutId||!transactionId||!poolId||!/^[a-f0-9]{64}$/.test(demandDigest)||!input.demands.length||input.demands.length>200)fail('DISPATCH_PRECHARGE_INVALID');
 const demands=[...input.demands].sort((a,b)=>a.quotaId.localeCompare(b.quotaId));
 if(new Set(demands.map(x=>x.quotaId)).size!==demands.length||demands.some(x=>!safe(x.quantityMinor)))fail('DISPATCH_DEMAND_INVALID');
 const old=(await sql.query('SELECT * FROM pos_dispatch_precharge_v1 WHERE checkout_id=?',[checkoutId])).values?.[0];
 if(old){const prior=(await sql.query('SELECT quota_id,quantity_minor FROM pos_dispatch_precharge_lines_v1 WHERE checkout_id=? ORDER BY quota_id',[checkoutId])).values||[];
 if(old.pool_id!==poolId||old.transaction_id!==transactionId||old.demand_digest!==demandDigest||old.source_json!==sourceJSON||JSON.stringify(prior.map(x=>({quotaId:x.quota_id,quantityMinor:Number(x.quantity_minor)})))!==JSON.stringify(demands))fail('DISPATCH_PRECHARGE_PAYLOAD_CONFLICT');
 if(old.phase==='ABANDONED')fail('DISPATCH_PRECHARGE_ABANDONED');return;}
 const pool=(await sql.query('SELECT state FROM pos_dispatch_pool_v1 WHERE pool_id=?',[poolId])).values?.[0];
 if(pool?.state!=='WAREHOUSE_DISPATCH')fail('DISPATCH_POOL_FROZEN_OR_UNAVAILABLE');
 for(const d of demands){const quota=(await sql.query("SELECT q.*,COALESCE((SELECT SUM(l.quantity_minor) FROM pos_dispatch_precharge_lines_v1 l JOIN pos_dispatch_precharge_v1 p ON p.checkout_id=l.checkout_id WHERE l.quota_id=q.id AND p.phase IN('PREPARED','EFFECT_POSSIBLE')),0) prepared FROM pos_dispatch_quota_v1 q WHERE q.id=? AND q.pool_id=?",[d.quotaId,poolId])).values?.[0];
 if(!quota||quota.state!=='ACTIVE'||Number(quota.granted_minor)-Number(quota.consumed_minor)-Number(quota.returned_minor)-Number(quota.prepared)<d.quantityMinor)fail('DISPATCH_LOCAL_QUOTA_EXHAUSTED');}
 await sql.run("INSERT INTO pos_dispatch_precharge_v1(checkout_id,pool_id,transaction_id,demand_digest,source_json,phase) VALUES(?,?,?,?,?,'PREPARED')",[checkoutId,poolId,transactionId,demandDigest,sourceJSON],false);
 for(const d of demands)await sql.run('INSERT INTO pos_dispatch_precharge_lines_v1(checkout_id,quota_id,quantity_minor) VALUES(?,?,?)',[checkoutId,d.quotaId,d.quantityMinor],false);
}
export async function markDispatchEffectPossible(sql:DispatchSQL,checkoutId:string,effectDigest:string,payments:unknown[]):Promise<void>{
 if(!Array.isArray(payments)||!payments.length||!/^[a-f0-9]{64}$/.test(effectDigest))fail('DISPATCH_EFFECT_DIGEST_REQUIRED');
 const p=(await sql.query('SELECT * FROM pos_dispatch_precharge_v1 WHERE checkout_id=?',[checkoutId])).values?.[0];
 if(!p||p.phase==='ABANDONED'||p.phase==='COMMITTED'||p.effect_digest&&p.effect_digest!==effectDigest||p.effects_json&&p.effects_json!==dispatchPaymentIntents(payments))fail('DISPATCH_PRECHARGE_EFFECT_CONFLICT');
 const pool=(await sql.query('SELECT state FROM pos_dispatch_pool_v1 WHERE pool_id=?',[p.pool_id])).values?.[0];
 if(pool?.state!=='WAREHOUSE_DISPATCH')fail('DISPATCH_POOL_FROZEN_OR_UNAVAILABLE');
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
