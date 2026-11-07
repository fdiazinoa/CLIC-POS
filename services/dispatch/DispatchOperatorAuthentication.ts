import {canonicalDispatchJSON,type DispatchSQL} from '../db/CompanyDispatchEscrowStore';
import type {DispatchOperatorPolicy} from './DispatchOperatorPolicy';
export const DISPATCH_OPERATOR_AUTH_SCHEMA=`
CREATE TABLE IF NOT EXISTS pos_dispatch_operator_authority_v1(id TEXT PRIMARY KEY,pool_id TEXT NOT NULL REFERENCES pos_dispatch_pool_v1(pool_id),authority_canonical TEXT NOT NULL,authority_hash TEXT NOT NULL,authentication_hash TEXT NOT NULL,witness_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('ACTIVE','REVOKED')));
CREATE TRIGGER IF NOT EXISTS dispatch_operator_grant_identity BEFORE UPDATE ON pos_dispatch_operator_authority_v1 WHEN OLD.id IS NOT NEW.id OR OLD.pool_id IS NOT NEW.pool_id OR OLD.authority_canonical IS NOT NEW.authority_canonical OR OLD.authority_hash IS NOT NEW.authority_hash OR OLD.authentication_hash IS NOT NEW.authentication_hash OR OLD.witness_hash IS NOT NEW.witness_hash OR OLD.state='REVOKED' AND NEW.state<>'REVOKED' BEGIN SELECT RAISE(ABORT,'DISPATCH_OPERATOR_AUTHORITY_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS dispatch_operator_grant_durable BEFORE DELETE ON pos_dispatch_operator_authority_v1 BEGIN SELECT RAISE(ABORT,'DISPATCH_OPERATOR_AUTHORITY_DURABLE');END;
CREATE TABLE IF NOT EXISTS pos_dispatch_operator_auth_material_v1(authority_id TEXT PRIMARY KEY REFERENCES pos_dispatch_operator_authority_v1(id),authentication_canonical TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS dispatch_operator_material_immutable BEFORE UPDATE ON pos_dispatch_operator_auth_material_v1 BEGIN SELECT RAISE(ABORT,'DISPATCH_OPERATOR_MATERIAL_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS dispatch_operator_material_retirement BEFORE DELETE ON pos_dispatch_operator_auth_material_v1 WHEN EXISTS(SELECT 1 FROM pos_dispatch_operator_authority_v1 a WHERE a.id=OLD.authority_id AND a.state<>'REVOKED') BEGIN SELECT RAISE(ABORT,'DISPATCH_OPERATOR_MATERIAL_STILL_ACTIVE');END;
CREATE TABLE IF NOT EXISTS pos_dispatch_auth_attempt_v1(rate_key TEXT PRIMARY KEY,failures INTEGER NOT NULL CHECK(failures>=0),last_clock_ms INTEGER NOT NULL,blocked_until_ms INTEGER NOT NULL,window_end_ms INTEGER NOT NULL,clock_observation_ms INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS dispatch_auth_attempt_monotonic BEFORE UPDATE ON pos_dispatch_auth_attempt_v1 WHEN NEW.last_clock_ms<OLD.last_clock_ms OR NEW.clock_observation_ms<OLD.clock_observation_ms OR NEW.failures<OLD.failures BEGIN SELECT RAISE(ABORT,'DISPATCH_AUTH_ATTEMPT_CANNOT_RESET');END;
CREATE TRIGGER IF NOT EXISTS dispatch_auth_attempt_durable BEFORE DELETE ON pos_dispatch_auth_attempt_v1 BEGIN SELECT RAISE(ABORT,'DISPATCH_AUTH_ATTEMPT_DURABLE');END;
CREATE TABLE IF NOT EXISTS pos_dispatch_authenticated_operator_v1(id TEXT PRIMARY KEY,checkout_id TEXT NOT NULL REFERENCES pos_dispatch_precharge_v1(checkout_id),authority_id TEXT NOT NULL REFERENCES pos_dispatch_operator_authority_v1(id),user_id TEXT NOT NULL,erp_pos_user_id TEXT NOT NULL,intent_digest TEXT NOT NULL,authority_hash TEXT NOT NULL,authenticated_at_ms INTEGER NOT NULL,UNIQUE(checkout_id,authority_id,user_id));
CREATE TRIGGER IF NOT EXISTS dispatch_authenticated_operator_immutable BEFORE UPDATE ON pos_dispatch_authenticated_operator_v1 BEGIN SELECT RAISE(ABORT,'DISPATCH_AUTHENTICATED_OPERATOR_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS dispatch_authenticated_operator_durable BEFORE DELETE ON pos_dispatch_authenticated_operator_v1 BEGIN SELECT RAISE(ABORT,'DISPATCH_AUTHENTICATED_OPERATOR_DURABLE');END;
`;
interface SensitiveAuthority {
 publicPolicy:{schemaVersion:1|2;source:'ERP_DISPATCH_OPERATOR_AUTHORITY_V1'|'ERP_DISPATCH_OPERATOR_AUTHORITY_V2';id:string;scope:{bindingId:string;generation:string;deviceId:string};issuedAt:string;eligibility?:{profile:'FINITE_QUOTA_SET';quotaSet:Array<{quotaId:string;authorityHash:string}>;allowedNoStockSources:Array<{sourceId:string;authorityHash:string}>};authenticationPolicy:AuthenticationPolicy;operators:DispatchOperatorPolicy[]};
 privateAuthentication:{schemaVersion:1|2;source:'ERP_DISPATCH_PIN_VERIFIERS_V1'|'ERP_DISPATCH_PIN_VERIFIERS_V2';authorityId:string;verifiers:Array<{userId:string;algorithm:string;salt:string;verifier:string}>};
}
type AuthenticationPolicy={schemaVersion:1;maxUserFailures:number;maxDeviceFailures:number;windowMilliseconds:number;recovery:'AUTHENTICATED_SERVER_COOLDOWN'};
export type DispatchAuthenticationResult={ok:true;authenticationId:string;userId:string;intentDigest:string}|{ok:false;code:string;retryAfterMilliseconds?:number};
const sha=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');
const equal=(a:string,b:string)=>{let difference=a.length^b.length;for(let n=0;n<Math.max(a.length,b.length);n++)difference|=(a.charCodeAt(n)||0)^(b.charCodeAt(n)||0);return difference===0;};
/** Caller owns the native writer TX and commits DENIED outcomes too. A thrown
 * error must not represent an ordinary wrong PIN, otherwise rollback would undo
 * its rate limit. No PIN is ever written to SQLite, a source, or an outbox.
 * Installation and external-witness verification are required by the native port;
 * this helper does not turn a caller-supplied policy or JSON into authority.
 */
export async function authenticateDispatchOperator(sql:DispatchSQL,input:{authorityId:string;checkoutId:string;userId:string;pin:string},trusted:{now:number;serverObservedAt:number;verifyWitness:(authorityHash:string,authenticationHash:string,witnessHash:string)=>Promise<void>}):Promise<DispatchAuthenticationResult>{
 const {now,serverObservedAt}=trusted;
 if(!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(serverObservedAt)||serverObservedAt<0||serverObservedAt>now)throw Error('DISPATCH_AUTH_CLOCK_POLICY_REQUIRED');
 const row=(await sql.query('SELECT a.*,p.source_json,p.phase precharge_phase,p.pool_id checkout_pool,q.binding_id,q.generation,q.state pool_state FROM pos_dispatch_operator_authority_v1 a JOIN pos_dispatch_precharge_v1 p ON p.checkout_id=? JOIN pos_dispatch_pool_v1 q ON q.pool_id=p.pool_id WHERE a.id=?',[input.checkoutId,input.authorityId])).values?.[0];
 if(!row||row.pool_id!==row.checkout_pool)throw Error('DISPATCH_OPERATOR_AUTHORITY_SCOPE');
 await trusted.verifyWitness(String(row.authority_hash),String(row.authentication_hash),String(row.witness_hash));
 if(await sha(String(row.authority_canonical))!==row.authority_hash)throw Error('DISPATCH_OPERATOR_AUTHORITY_HASH');
 const authority={publicPolicy:JSON.parse(String(row.authority_canonical))} as SensitiveAuthority,scope=authority.publicPolicy?.scope;
 if(!([1,2].includes(authority.publicPolicy?.schemaVersion)&&authority.publicPolicy?.source===`ERP_DISPATCH_OPERATOR_AUTHORITY_V${authority.publicPolicy.schemaVersion}`)||authority.publicPolicy?.id!==input.authorityId||scope?.bindingId!==row.binding_id||scope?.generation!==row.generation)throw Error('DISPATCH_OPERATOR_AUTHORITY_SCOPE');
 const policy=authority.publicPolicy.authenticationPolicy;
 if(policy?.schemaVersion!==1||policy.recovery!=='AUTHENTICATED_SERVER_COOLDOWN'||![policy.maxUserFailures,policy.maxDeviceFailures,policy.windowMilliseconds].every(v=>Number.isSafeInteger(v)&&v>0))throw Error('DISPATCH_AUTH_POLICY_REQUIRED');
 const retainedSource=JSON.parse(String(row.source_json));
 if(retainedSource.companyDispatchSource?.operatorAuthorityId!==input.authorityId)throw Error('DISPATCH_OPERATOR_CHECKOUT_AUTHORITY_CONFLICT');
 const intentDigest=await sha(String(row.source_json));
 const previous=(await sql.query('SELECT * FROM pos_dispatch_authenticated_operator_v1 WHERE checkout_id=? AND authority_id=? AND user_id=?',[input.checkoutId,input.authorityId,input.userId])).values?.[0];
 if(previous&&['EFFECT_POSSIBLE','COMMITTED'].includes(String(row.precharge_phase))){if(previous.intent_digest!==intentDigest||previous.authority_hash!==row.authority_hash)throw Error('DISPATCH_OPERATOR_AUTHENTICATION_CONFLICT');return{ok:true,authenticationId:String(previous.id),userId:String(previous.user_id),intentDigest};}
 if(authority.publicPolicy.schemaVersion!==2||authority.publicPolicy.eligibility?.profile!=='FINITE_QUOTA_SET')return{ok:false,code:'DISPATCH_OPERATOR_FINITE_PROFILE_REQUIRED'};
 if(row.pool_state!=='WAREHOUSE_DISPATCH')return{ok:false,code:'DISPATCH_POOL_FROZEN_OR_UNAVAILABLE'};
 if(row.state!=='ACTIVE')return{ok:false,code:'DISPATCH_OPERATOR_NEW_AUTHORITY_REQUIRED'};
 if(retainedSource.companyDispatchSource?.operatorAuthorityHash!==row.authority_hash)throw Error('DISPATCH_OPERATOR_CHECKOUT_AUTHORITY_CONFLICT');
 const eligibility=authority.publicPolicy.eligibility;
 if(!Array.isArray(eligibility.quotaSet)||!Array.isArray(eligibility.allowedNoStockSources)||eligibility.quotaSet.length+eligibility.allowedNoStockSources.length===0)throw Error('DISPATCH_OPERATOR_FINITE_AUTHORITY_REQUIRED');
 const quotaSet=new Map(eligibility.quotaSet.map(q=>[q.quotaId,q.authorityHash]));
 if(quotaSet.size!==eligibility.quotaSet.length)throw Error('DISPATCH_OPERATOR_FINITE_AUTHORITY_REQUIRED');
 const financed=(await sql.query('SELECT l.quota_id,q.authority_hash FROM pos_dispatch_precharge_lines_v1 l JOIN pos_dispatch_quota_v1 q ON q.id=l.quota_id AND q.pool_id=? WHERE l.checkout_id=?',[row.pool_id,input.checkoutId])).values||[];
 if(!financed.length||retainedSource.companyDispatchSource?.noStockSources?.length)throw Error('DISPATCH_NO_STOCK_CHECKOUT_PROOF_REQUIRED');
 if(financed.some(q=>quotaSet.get(String(q.quota_id))!==q.authority_hash))throw Error('DISPATCH_OPERATOR_QUOTA_SET_CONFLICT');
 if(row.precharge_phase!=='PREPARED')return{ok:false,code:'DISPATCH_OPERATOR_CHECKOUT_NOT_PREPARED'};
 const operator=authority.publicPolicy.operators.find(o=>o.userId===input.userId);
 const keys=[...(operator?[{key:canonicalDispatchJSON(['USER',scope.bindingId,operator.erpPosUserId]),limit:policy.maxUserFailures}]:[]),{key:canonicalDispatchJSON(['DEVICE',scope.deviceId]),limit:policy.maxDeviceFailures}];
 const attempts=[];
 for(const key of keys){const value=(await sql.query('SELECT * FROM pos_dispatch_auth_attempt_v1 WHERE rate_key=?',[key.key])).values?.[0];
  if(value&&now<Number(value.last_clock_ms))return{ok:false,code:'DISPATCH_AUTH_CLOCK_RECONCILIATION_REQUIRED'};
  // Neither local time nor a refreshed bundle/clock unlocks an exhausted budget.
  // Recovery requires the separate authenticated server cooldown/counter proof.
  const attempt={key,failures:Number(value?.failures||0),blockedUntil:Number(value?.blocked_until_ms||0),windowEnd:!value?serverObservedAt+policy.windowMilliseconds:Number(value.window_end_ms),observation:Math.max(serverObservedAt,Number(value?.clock_observation_ms||0))};attempts.push(attempt);
  if(attempt.failures>=key.limit)return{ok:false,code:'DISPATCH_AUTH_SERVER_RECOVERY_REQUIRED'};
  if(attempt.blockedUntil>now)return{ok:false,code:'DISPATCH_AUTH_BACKOFF',retryAfterMilliseconds:attempt.blockedUntil-now};
 }
 const material=(await sql.query('SELECT authentication_canonical FROM pos_dispatch_operator_auth_material_v1 WHERE authority_id=?',[input.authorityId])).values?.[0];
 if(!material||await sha(String(material.authentication_canonical))!==row.authentication_hash)throw Error('DISPATCH_OPERATOR_AUTH_MATERIAL_REQUIRED');
 authority.privateAuthentication=JSON.parse(String(material.authentication_canonical));
 if(authority.privateAuthentication.schemaVersion!==2||authority.privateAuthentication.source!=='ERP_DISPATCH_PIN_VERIFIERS_V2'||authority.privateAuthentication.authorityId!==input.authorityId)throw Error('DISPATCH_OPERATOR_AUTHORITY_SCOPE');
 const verifier=authority.privateAuthentication.verifiers.find(v=>v.userId===input.userId);
 if(operator&&(!verifier||verifier.algorithm!=='DISPATCH_PIN_SHA256_SALTED_V1'||!/^[a-f0-9]{64}$/.test(verifier.salt)||!/^[a-f0-9]{64}$/.test(verifier.verifier)))throw Error('DISPATCH_OPERATOR_VERIFIER_INVALID');
 const digest=verifier&&/^\d{4}$/.test(input.pin)?await sha(JSON.stringify([verifier.algorithm,scope.bindingId,scope.generation,input.userId,verifier.salt,input.pin])):'';
 if(!operator||!verifier||!equal(digest,verifier.verifier)){
  for(const attempt of attempts)await sql.run('INSERT INTO pos_dispatch_auth_attempt_v1(rate_key,failures,last_clock_ms,blocked_until_ms,window_end_ms,clock_observation_ms)VALUES(?,?,?,?,?,?) ON CONFLICT(rate_key)DO UPDATE SET failures=excluded.failures,last_clock_ms=excluded.last_clock_ms,blocked_until_ms=excluded.blocked_until_ms,window_end_ms=excluded.window_end_ms,clock_observation_ms=excluded.clock_observation_ms',[attempt.key.key,attempt.failures+1,now,now,attempt.windowEnd,attempt.observation],false);
  return{ok:false,code:'DISPATCH_OPERATOR_PIN_DENIED'};
 }
 for(const attempt of attempts)await sql.run('INSERT INTO pos_dispatch_auth_attempt_v1(rate_key,failures,last_clock_ms,blocked_until_ms,window_end_ms,clock_observation_ms)VALUES(?,?,?,0,?,?) ON CONFLICT(rate_key)DO UPDATE SET failures=excluded.failures,last_clock_ms=excluded.last_clock_ms,window_end_ms=excluded.window_end_ms,clock_observation_ms=excluded.clock_observation_ms',[attempt.key.key,attempt.failures,now,attempt.windowEnd,attempt.observation],false);
 if(previous)return{ok:true,authenticationId:String(previous.id),userId:input.userId,intentDigest};
 const id=crypto.randomUUID();await sql.run('INSERT INTO pos_dispatch_authenticated_operator_v1(id,checkout_id,authority_id,user_id,erp_pos_user_id,intent_digest,authority_hash,authenticated_at_ms)VALUES(?,?,?,?,?,?,?,?)',[id,input.checkoutId,input.authorityId,input.userId,operator!.erpPosUserId,intentDigest,row.authority_hash,now],false);
 return{ok:true,authenticationId:id,userId:input.userId,intentDigest};
}

/** Requires the same caller-owned writer transaction. Revocation stops new authentications; paid checkout principals and public
 * policy remain immutable. The rotated PIN verifier itself is no longer needed
 * to replay a previously authenticated EFFECT_POSSIBLE/COMMITTED checkout. */
export async function retireDispatchOperatorAuthenticationMaterial(sql:DispatchSQL,authorityId:string):Promise<void>{
 await sql.run("UPDATE pos_dispatch_operator_authority_v1 SET state='REVOKED' WHERE id=?",[authorityId],false);
 await sql.run('DELETE FROM pos_dispatch_operator_auth_material_v1 WHERE authority_id=?',[authorityId],false);
}
