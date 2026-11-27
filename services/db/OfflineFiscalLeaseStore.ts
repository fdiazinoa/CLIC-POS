import {fiscalWorkflowScopeKey,type FiscalWorkflowPermitV2} from '../fiscal/FiscalWorkflowV2Types';
import {recordCheckoutTrace} from '../audit/CheckoutTrace';
import {offlineFiscalFail,validateOfflineFiscalLease,validateOfflineFiscalPermit,offlineFiscalRecordIdentityMatches,type OfflineFiscalLease,type OfflineFiscalLocalAuthority} from '../fiscal/OfflineFiscalLease';
type Connection={run(sql:string,params?:any[],transaction?:boolean):Promise<any>;query(sql:string,params?:any[]):Promise<{values?:any[]}>};
/** Support trace of a quarantined row, once per cause; reads must stay free of durable mutations. */
let lastQuarantineTrace='';
const traceQuarantine=(code:string)=>{if(lastQuarantineTrace===code)return;lastQuarantineTrace=code;try{recordCheckoutTrace('OFFLINE_RESERVE_QUARANTINED',`lease ${code}`);}catch{/* best effort */}};
export const OFFLINE_FISCAL_LEASE_SCHEMA=`
CREATE TABLE IF NOT EXISTS pos_offline_fiscal_leases_v1(lease_id TEXT PRIMARY KEY,scope_key TEXT NOT NULL,lease_json TEXT NOT NULL,binding_hash TEXT NOT NULL,server_offset_ms INTEGER NOT NULL,max_local_ms INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)));
CREATE INDEX IF NOT EXISTS pos_offline_fiscal_lease_scope_v1 ON pos_offline_fiscal_leases_v1(scope_key,revoked);
CREATE TRIGGER IF NOT EXISTS pos_offline_fiscal_lease_identity_v1 BEFORE UPDATE ON pos_offline_fiscal_leases_v1 WHEN OLD.lease_id IS NOT NEW.lease_id OR OLD.scope_key IS NOT NEW.scope_key OR OLD.lease_json IS NOT NEW.lease_json OR OLD.binding_hash IS NOT NEW.binding_hash OR OLD.server_offset_ms IS NOT NEW.server_offset_ms OR NEW.max_local_ms<OLD.max_local_ms OR OLD.revoked=1 AND NEW.revoked<>1 BEGIN SELECT RAISE(ABORT,'OFFLINE_FISCAL_LEASE_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS pos_offline_fiscal_lease_delete_v1 BEFORE DELETE ON pos_offline_fiscal_leases_v1 BEGIN SELECT RAISE(ABORT,'OFFLINE_FISCAL_LEASE_DURABLE');END;`;
export const OFFLINE_FISCAL_ABANDON_SCHEMA=`
CREATE TABLE IF NOT EXISTS pos_offline_fiscal_abandoned_v1(checkout_id TEXT PRIMARY KEY,transaction_id TEXT NOT NULL UNIQUE,permit_id TEXT NOT NULL UNIQUE,scope_key TEXT NOT NULL,operation_id TEXT NOT NULL,original_identity TEXT NOT NULL,created_at TEXT NOT NULL,reason TEXT NOT NULL CHECK(reason='PREPARED_WITHOUT_EFFECTS'));
CREATE TRIGGER IF NOT EXISTS pos_offline_abandoned_immutable_v1 BEFORE UPDATE ON pos_offline_fiscal_abandoned_v1 BEGIN SELECT RAISE(ABORT,'OFFLINE_FISCAL_ABANDONED');END;
CREATE TRIGGER IF NOT EXISTS pos_offline_abandoned_delete_v1 BEFORE DELETE ON pos_offline_fiscal_abandoned_v1 BEGIN SELECT RAISE(ABORT,'OFFLINE_FISCAL_ABANDONED');END;
CREATE TRIGGER IF NOT EXISTS pos_offline_abandoned_checkout_v1 BEFORE UPDATE ON pos_fiscal_checkouts_v2 WHEN EXISTS(SELECT 1 FROM pos_offline_fiscal_abandoned_v1 WHERE checkout_id=OLD.checkout_id COLLATE NOCASE) BEGIN SELECT RAISE(ABORT,'OFFLINE_FISCAL_ABANDONED');END;
CREATE TRIGGER IF NOT EXISTS pos_offline_abandoned_checkout_insert_v1 BEFORE INSERT ON pos_fiscal_checkouts_v2 WHEN EXISTS(SELECT 1 FROM pos_offline_fiscal_abandoned_v1 WHERE checkout_id=NEW.checkout_id COLLATE NOCASE OR transaction_id=NEW.transaction_id COLLATE NOCASE OR permit_id=NEW.permit_id COLLATE NOCASE OR (scope_key=NEW.scope_key AND operation_id=json_extract(NEW.checkout_json,'$.operationId') COLLATE NOCASE)) BEGIN SELECT RAISE(ABORT,'OFFLINE_FISCAL_ABANDONED');END;
CREATE TRIGGER IF NOT EXISTS pos_offline_abandoned_permit_v1 BEFORE UPDATE ON pos_fiscal_permits_v2 WHEN EXISTS(SELECT 1 FROM pos_offline_fiscal_abandoned_v1 WHERE permit_id=OLD.permit_id COLLATE NOCASE) BEGIN SELECT RAISE(ABORT,'OFFLINE_FISCAL_ABANDONED');END;
CREATE TRIGGER IF NOT EXISTS pos_offline_abandoned_pointer_v1 BEFORE INSERT ON pos_fiscal_checkout_current_v2 WHEN EXISTS(SELECT 1 FROM pos_offline_fiscal_abandoned_v1 WHERE checkout_id=NEW.checkout_id COLLATE NOCASE) BEGIN SELECT RAISE(ABORT,'OFFLINE_FISCAL_ABANDONED');END;
CREATE TRIGGER IF NOT EXISTS pos_offline_abandoned_pointer_update_v1 BEFORE UPDATE ON pos_fiscal_checkout_current_v2 WHEN EXISTS(SELECT 1 FROM pos_offline_fiscal_abandoned_v1 WHERE checkout_id=NEW.checkout_id COLLATE NOCASE) BEGIN SELECT RAISE(ABORT,'OFFLINE_FISCAL_ABANDONED');END;`;
export async function saveOfflineLeasePage(sql:Connection,lease:OfflineFiscalLease,permits:FiscalWorkflowPermitV2[],authority:OfflineFiscalLocalAuthority,serverTime:string):Promise<void>{
 validateOfflineFiscalLease(lease,authority);const serverMs=Date.parse(serverTime),now=Date.now(),key=fiscalWorkflowScopeKey(authority.scope);
 if(!Number.isFinite(serverMs)||serverMs<Date.parse(lease.issuedAt)||serverMs>=Date.parse(lease.validUntil)||!Array.isArray(permits)||permits.length>16)offlineFiscalFail();
 for(const permit of permits)validateOfflineFiscalPermit(permit,lease);
 const existingLeases=(await sql.query('SELECT lease_id,lease_json FROM pos_offline_fiscal_leases_v1 WHERE scope_key=? AND revoked=0',[key])).values||[];
 for(const previous of existingLeases)if(JSON.parse(previous.lease_json).bindingFingerprint!==lease.bindingFingerprint)
  await sql.run('UPDATE pos_offline_fiscal_leases_v1 SET revoked=1 WHERE lease_id=?',[previous.lease_id],false);
 const previous=(await sql.query('SELECT * FROM pos_offline_fiscal_leases_v1 WHERE lease_id=?',[lease.leaseId])).values?.[0];
 if(previous){if(previous.lease_json!==JSON.stringify(lease)||previous.revoked||now<previous.max_local_ms)offlineFiscalFail('OFFLINE_FISCAL_LEASE_REVOKED');
   // A lease downloaded by an older build keeps a hash that mixed the rotating device token;
   // the same fiscal identity is enough to keep it valid after an upgrade.
   if(previous.binding_hash!==authority.bindingHash&&!offlineFiscalRecordIdentityMatches(authority,JSON.parse(previous.lease_json)))offlineFiscalFail('OFFLINE_FISCAL_LEASE_REVOKED');}
 else await sql.run('INSERT INTO pos_offline_fiscal_leases_v1(lease_id,scope_key,lease_json,binding_hash,server_offset_ms,max_local_ms)VALUES(?,?,?,?,?,?)',[lease.leaseId,key,JSON.stringify(lease),authority.bindingHash,serverMs-now,now],false);
 const count=Number((await sql.query("SELECT count(*) n FROM pos_fiscal_permits_v2 WHERE json_extract(permit_json,'$.leaseId')=?",[lease.leaseId])).values?.[0]?.n||0);
 const newIds=[];
 for(const permit of permits){const encoded=JSON.stringify(permit),old=(await sql.query('SELECT permit_json FROM pos_fiscal_permits_v2 WHERE permit_id=?',[permit.permitId])).values?.[0];
  if(old){if(old.permit_json!==encoded)offlineFiscalFail();}else newIds.push(permit);
 }
 if(count+newIds.length>lease.saleCapacity)offlineFiscalFail('OFFLINE_FISCAL_CAPACITY_EXHAUSTED');
 for(const permit of newIds)await sql.run("INSERT INTO pos_fiscal_permits_v2(permit_id,transaction_id,scope_key,permit_json,expires_at,state)VALUES(?,?,?,?,?,'AVAILABLE')",[permit.permitId,permit.transactionId,key,JSON.stringify(permit),permit.expiresAt],false);
}
/** Pure read: never revokes, never advances `max_local_ms`. A row whose fiscal identity differs from
 * the current one is quarantined in memory (ignored here) and reported by `offlineLeaseReason`. */
export async function readOfflineLease(sql:Connection,authority:OfflineFiscalLocalAuthority,leaseId?:string,allowExpired=false):Promise<OfflineFiscalLease|null>{
 const scopeKey=fiscalWorkflowScopeKey(authority.scope),now=Date.now();
 const rows=(await sql.query('SELECT * FROM pos_offline_fiscal_leases_v1 WHERE revoked=0 ORDER BY rowid DESC',[])).values||[];
 if(rows.some(row=>now<row.max_local_ms))offlineFiscalFail('OFFLINE_FISCAL_CLOCK_ROLLBACK');
 for(const row of rows){
  if(row.scope_key!==scopeKey)continue;
  let lease:OfflineFiscalLease;
  try{lease=JSON.parse(row.lease_json) as OfflineFiscalLease;}catch{traceQuarantine('UNREADABLE_ROW');continue;}
  if(!offlineFiscalRecordIdentityMatches(authority,lease)){traceQuarantine('AUTHORITY_CHANGED');continue;}
  try{validateOfflineFiscalLease(lease,authority);}catch{traceQuarantine('OFFLINE_FISCAL_LEASE_INVALID');continue;}
  if(leaseId&&row.lease_id!==leaseId)continue;
  if(!allowExpired&&now+row.server_offset_ms>=Date.parse(lease.validUntil))continue;
  return lease;
 }
 return null;
}
/** Checkout/commit path only: proves the clock is monotonic when the reserve is actually consumed. */
export async function advanceOfflineLeaseClock(sql:Connection,leaseId:string,at=Date.now()):Promise<void>{
 await sql.run('UPDATE pos_offline_fiscal_leases_v1 SET max_local_ms=? WHERE lease_id=? AND revoked=0 AND max_local_ms<=?',[at,leaseId,at],false);
}
export async function offlineSaleDate(sql:Connection,leaseId:string):Promise<string>{
 const row=(await sql.query('SELECT server_offset_ms FROM pos_offline_fiscal_leases_v1 WHERE lease_id=? AND revoked=0',[leaseId])).values?.[0];
 if(!row)offlineFiscalFail('OFFLINE_FISCAL_LEASE_REQUIRED');
 return new Date(Date.now()+Number(row.server_offset_ms)).toISOString();
}
