import {canonicalDispatchJSON,type DispatchSQL} from './CompanyDispatchEscrowStore';
export type DispatchAdoptionProof={sourceEventId:string;sourceHash:string;bindingId:string;generation:string;acceptedSequence:number;quotaEffects:Array<{quotaId:string;eventId:string;quantityMinor:number}>;nativeSourceDigestVersion:'DISPATCH_NATIVE_JSON_V1';nativeSourceHash:string};
export const DISPATCH_ADOPTION_SCHEMA=`
CREATE TABLE IF NOT EXISTS pos_dispatch_adoption_v1(event_id TEXT PRIMARY KEY REFERENCES pos_dispatch_native_capture_v1(event_id),proof_json TEXT NOT NULL,received_at TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS dispatch_adoption_immutable BEFORE UPDATE ON pos_dispatch_adoption_v1 BEGIN SELECT RAISE(ABORT,'DISPATCH_ADOPTION_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS dispatch_adoption_durable BEFORE DELETE ON pos_dispatch_adoption_v1 BEGIN SELECT RAISE(ABORT,'DISPATCH_ADOPTION_DURABLE');END;
-- Prototype builds could have persisted a bare transport ACK. Re-request the
-- same immutable event; never mint another capture, quota or financial effect.
UPDATE sync_outbox_v2 SET status='RETRY_WAIT',lease_owner=NULL,lease_expires_at=NULL,next_retry_at=NULL,last_error='DISPATCH_ERP_ADOPTION_PROOF_REQUIRED' WHERE status='APPLIED_ERP' AND EXISTS(SELECT 1 FROM pos_dispatch_native_capture_v1 c WHERE c.event_id=sync_outbox_v2.event_id) AND NOT EXISTS(SELECT 1 FROM pos_dispatch_adoption_v1 a WHERE a.event_id=sync_outbox_v2.event_id);
CREATE TRIGGER IF NOT EXISTS dispatch_outbox_proof_required BEFORE UPDATE OF status ON sync_outbox_v2 WHEN NEW.status='APPLIED_ERP' AND EXISTS(SELECT 1 FROM pos_dispatch_native_capture_v1 c WHERE c.event_id=OLD.event_id) AND NOT EXISTS(SELECT 1 FROM pos_dispatch_adoption_v1 a WHERE a.event_id=OLD.event_id) BEGIN SELECT RAISE(ABORT,'DISPATCH_ERP_ADOPTION_PROOF_REQUIRED');END;
`;
const fail=(code:string):never=>{throw Error(code);};
/** Only the direct authenticated ERP proof-reader may supply this input. The
 * caller holds the native writer transaction; a LAN APPLIED status is not proof.
 * No quota is replenished: local C remains consumed after server adoption. */
export async function acknowledgeDispatchAdoption(sql:DispatchSQL,eventId:string,proof:DispatchAdoptionProof,at:string):Promise<void>{
 const capture=(await sql.query('SELECT c.*,p.binding_id,p.generation FROM pos_dispatch_native_capture_v1 c JOIN pos_dispatch_pool_v1 p ON p.pool_id=c.pool_id WHERE c.event_id=?',[eventId])).values?.[0];
 if(!capture)fail('DISPATCH_NATIVE_CAPTURE_REQUIRED');
 if(!proof||proof.sourceEventId!==eventId||proof.bindingId!==capture.binding_id||proof.generation!==capture.generation||proof.acceptedSequence!==Number(capture.sequence)||!Number.isSafeInteger(proof.acceptedSequence)||!/^[a-f0-9]{64}$/.test(proof.sourceHash)||proof.nativeSourceDigestVersion!=='DISPATCH_NATIVE_JSON_V1'||!/^[a-f0-9]{64}$/.test(proof.nativeSourceHash)||!Array.isArray(proof.quotaEffects))fail('DISPATCH_ADOPTION_SCOPE_CONFLICT');
 const source=JSON.parse(String(capture.source_snapshot_json));
 if(!proof.quotaEffects.length&&(!source.items?.length||!source.companyDispatchSource?.lines?.length||source.companyDispatchSource.lines.some((line:any)=>!line.noStockSource||!Array.isArray(line.quotaAllocations)||line.quotaAllocations.length)))fail('DISPATCH_ADOPTION_QUOTA_CONFLICT');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalDispatchJSON(source)))),n=>n.toString(16).padStart(2,'0')).join('');
 if(hash!==proof.nativeSourceHash)fail('DISPATCH_ADOPTION_SOURCE_CONFLICT');
 const local=(await sql.query('SELECT quota_id,quantity_minor FROM pos_dispatch_precharge_lines_v1 WHERE checkout_id=? ORDER BY quota_id',[capture.checkout_id])).values||[];
 const effects=new Map<string,number>(),effectIds=new Set<string>();
 for(const effect of proof.quotaEffects){if(!effect||!effect.quotaId||!effect.eventId||effectIds.has(effect.eventId)||!Number.isSafeInteger(effect.quantityMinor)||effect.quantityMinor<=0||effect.quantityMinor%100!==0)fail('DISPATCH_ADOPTION_QUOTA_CONFLICT');effectIds.add(effect.eventId);const total=(effects.get(effect.quotaId)||0)+effect.quantityMinor;if(!Number.isSafeInteger(total))fail('DISPATCH_ADOPTION_QUOTA_CONFLICT');effects.set(effect.quotaId,total);}
 if(local.length!==effects.size||local.some(line=>effects.get(String(line.quota_id))!==Number(line.quantity_minor)))fail('DISPATCH_ADOPTION_QUOTA_CONFLICT');
 const event=(await sql.query('SELECT * FROM sync_outbox_v2 WHERE event_id=?',[eventId])).values?.[0];
 if(!event||event.event_type!=='SALE_POSTED'||String(event.aggregate_type).toUpperCase()!=='TRANSACTION'||event.aggregate_id!==capture.transaction_id||canonicalDispatchJSON(JSON.parse(String(event.payload_json)).transaction)!==canonicalDispatchJSON(source))fail('DISPATCH_ADOPTION_OUTBOX_CONFLICT');
 const encoded=canonicalDispatchJSON({...proof,quotaEffects:[...proof.quotaEffects].sort((a,b)=>a.eventId.localeCompare(b.eventId))});
 const prior=(await sql.query('SELECT proof_json FROM pos_dispatch_adoption_v1 WHERE event_id=?',[eventId])).values?.[0];
 if(prior&&prior.proof_json!==encoded)fail('DISPATCH_ADOPTION_REPLAY_CONFLICT');
 if(!prior)await sql.run('INSERT INTO pos_dispatch_adoption_v1(event_id,proof_json,received_at)VALUES(?,?,?)',[eventId,encoded,at],false);
 if(!['SENDING','SYNCED_MASTER','APPLIED_ERP'].includes(String(event.status)))fail('DISPATCH_ADOPTION_OUTBOX_NOT_IN_FLIGHT');
 if(event.status!=='APPLIED_ERP')await sql.run("UPDATE sync_outbox_v2 SET status='APPLIED_ERP',erp_applied_at=?,lease_owner=NULL,lease_expires_at=NULL,next_retry_at=NULL,updated_at=?,last_error=NULL WHERE event_id=?",[at,at,eventId],false);
 const stored=(await sql.query('SELECT a.proof_json,o.status FROM pos_dispatch_adoption_v1 a JOIN sync_outbox_v2 o ON o.event_id=a.event_id WHERE a.event_id=?',[eventId])).values?.[0];
 if(stored?.proof_json!==encoded||stored.status!=='APPLIED_ERP')fail('DISPATCH_ADOPTION_WRITE_REQUIRED');
}
