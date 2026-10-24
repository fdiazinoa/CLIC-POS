import {assertOfflineFiscalPaymentReceipts} from './OfflineFiscalPaymentAuthority';
import {assertRetirementHasNoEffects} from './FiscalWorkflowRetirementStore';
import type {BusinessConfig,FiscalAllocation,FiscalRangeDGII,LocalFiscalBuffer,Transaction} from '../../types';
import type {FiscalWorkflowCheckoutV2} from '../fiscal/FiscalWorkflowV2Types';
import {fiscalWorkflowScopeKey} from '../fiscal/FiscalWorkflowV2Types';
import type {OfflineFiscalLocalAuthority,TableFiscalSaleContext} from '../fiscal/OfflineFiscalLease';
import {validateTableFiscalSaleContext} from '../fiscal/OfflineFiscalLease';
import {allocationFail,validateOfflineFiscalAllocation,assertAllocationMemberTime,type OfflineFiscalAllocation,type OfflineFiscalAllocationSelection} from '../fiscal/OfflineFiscalAllocation';
import {offlineFiscalAuthorityFromConfig} from '../fiscal/OfflineFiscalLeaseContext';
import {createUuid} from '../../utils/uuid';
import {formatFiscalNumber} from '../../utils/fiscalNumber';
import {snapshotFiscalIssuance} from '../../utils/fiscalIssuance';
import {validateFiscalBufferReservation} from '../../utils/fiscalBufferAuthority';
import {planNativeFiscalReceipt} from './NativeFiscalReservation';

type SQL={query(sql:string,params?:any[]):Promise<{values?:any[]}>;run(sql:string,params?:any[],transaction?:boolean):Promise<any>};
export const OFFLINE_FISCAL_ALLOCATION_SCHEMA=`
CREATE TABLE IF NOT EXISTS pos_offline_fiscal_allocations_v2(authorization_id TEXT PRIMARY KEY,scope_key TEXT NOT NULL,authority_json TEXT NOT NULL,binding_hash TEXT NOT NULL,server_offset_ms INTEGER NOT NULL,max_local_ms INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN(0,1)));
CREATE INDEX IF NOT EXISTS pos_offline_fiscal_allocation_active_v2 ON pos_offline_fiscal_allocations_v2(authorization_id) WHERE revoked=0;
CREATE INDEX IF NOT EXISTS pos_offline_fiscal_allocation_scope_v2 ON pos_offline_fiscal_allocations_v2(scope_key,revoked);
CREATE TRIGGER IF NOT EXISTS pos_allocation_immutable_v2 BEFORE UPDATE ON pos_offline_fiscal_allocations_v2 WHEN OLD.authorization_id IS NOT NEW.authorization_id OR OLD.scope_key IS NOT NEW.scope_key OR OLD.authority_json IS NOT NEW.authority_json OR OLD.binding_hash IS NOT NEW.binding_hash OR OLD.server_offset_ms IS NOT NEW.server_offset_ms OR NEW.max_local_ms<OLD.max_local_ms OR OLD.revoked=1 AND NEW.revoked<>1 BEGIN SELECT RAISE(ABORT,'OFFLINE_FISCAL_ALLOCATION_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS pos_allocation_durable_v2 BEFORE DELETE ON pos_offline_fiscal_allocations_v2 BEGIN SELECT RAISE(ABORT,'OFFLINE_FISCAL_ALLOCATION_DURABLE');END;
CREATE TABLE IF NOT EXISTS pos_fiscal_authority_withdrawals_v2(id INTEGER PRIMARY KEY,collection_name TEXT NOT NULL,doc_id TEXT NOT NULL,data TEXT NOT NULL,recorded_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS pos_fiscal_authority_withdrawal_document_v2 ON pos_fiscal_authority_withdrawals_v2(collection_name,doc_id,id DESC);
CREATE TRIGGER IF NOT EXISTS pos_fiscal_withdrawal_immutable_update_v2 BEFORE UPDATE ON pos_fiscal_authority_withdrawals_v2 BEGIN SELECT RAISE(ABORT,'OFFLINE_FISCAL_WITHDRAWAL_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS pos_fiscal_withdrawal_immutable_delete_v2 BEFORE DELETE ON pos_fiscal_authority_withdrawals_v2 BEGIN SELECT RAISE(ABORT,'OFFLINE_FISCAL_WITHDRAWAL_IMMUTABLE');END;
CREATE TABLE IF NOT EXISTS pos_fiscal_pending_numbers_v2(checkout_id TEXT PRIMARY KEY,transaction_id TEXT NOT NULL UNIQUE,authorization_id TEXT NOT NULL REFERENCES pos_offline_fiscal_allocations_v2(authorization_id),issuer_rnc TEXT NOT NULL,environment INTEGER NOT NULL,account_key TEXT,buffer_id TEXT NOT NULL,allocation_id TEXT NOT NULL,ncf TEXT NOT NULL,sequence INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN('PREPARED','EFFECT_POSSIBLE','CONSUMED','ABANDONED')));
CREATE UNIQUE INDEX IF NOT EXISTS pos_fiscal_pending_unique_v2 ON pos_fiscal_pending_numbers_v2(allocation_id,sequence) WHERE state<>'ABANDONED';
CREATE UNIQUE INDEX IF NOT EXISTS pos_fiscal_pending_ncf_v2 ON pos_fiscal_pending_numbers_v2(issuer_rnc,environment,ncf) WHERE state<>'ABANDONED';
CREATE UNIQUE INDEX IF NOT EXISTS pos_fiscal_pending_account_v2 ON pos_fiscal_pending_numbers_v2(account_key) WHERE account_key IS NOT NULL AND state<>'ABANDONED';
CREATE INDEX IF NOT EXISTS pos_fiscal_pending_active_ncf_v2 ON pos_fiscal_pending_numbers_v2(ncf,issuer_rnc) WHERE state IN('PREPARED','EFFECT_POSSIBLE');
CREATE INDEX IF NOT EXISTS pos_fiscal_pending_active_allocation_v2 ON pos_fiscal_pending_numbers_v2(allocation_id) WHERE state IN('PREPARED','EFFECT_POSSIBLE');
CREATE INDEX IF NOT EXISTS pos_fiscal_pending_abandoned_v2 ON pos_fiscal_pending_numbers_v2(checkout_id) WHERE state='ABANDONED';
CREATE INDEX IF NOT EXISTS pos_fiscal_pending_buffer_v2 ON pos_fiscal_pending_numbers_v2(buffer_id,state);
CREATE TRIGGER IF NOT EXISTS pos_pending_number_identity_v2 BEFORE UPDATE ON pos_fiscal_pending_numbers_v2 WHEN OLD.checkout_id IS NOT NEW.checkout_id OR OLD.transaction_id IS NOT NEW.transaction_id OR OLD.authorization_id IS NOT NEW.authorization_id OR OLD.account_key IS NOT NEW.account_key OR OLD.issuer_rnc IS NOT NEW.issuer_rnc OR OLD.environment IS NOT NEW.environment OR OLD.buffer_id IS NOT NEW.buffer_id OR OLD.allocation_id IS NOT NEW.allocation_id OR OLD.ncf IS NOT NEW.ncf OR OLD.sequence IS NOT NEW.sequence OR OLD.state IN('CONSUMED','ABANDONED') AND NEW.state<>OLD.state OR OLD.state='EFFECT_POSSIBLE' AND NEW.state NOT IN('EFFECT_POSSIBLE','CONSUMED') BEGIN SELECT RAISE(ABORT,'OFFLINE_FISCAL_NUMBER_OWNER_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS pos_pending_number_durable_v2 BEFORE DELETE ON pos_fiscal_pending_numbers_v2 BEGIN SELECT RAISE(ABORT,'OFFLINE_FISCAL_NUMBER_OWNER_DURABLE');END;
`;
const allocationIdentityStillOwned=(oldData:string)=>['terminalId','fiscalRangeId','ncfType','prefix','reservedStart','reservedEnd'].map(key=>`json_extract(NEW.data,'$.${key}') IS json_extract(${oldData},'$.${key}')`).join(' AND ')+" AND json_extract(NEW.data,'$.status') IN('ACTIVE','EXHAUSTED') AND json_extract(NEW.data,'$.releasedAt') IS NULL";
const previousAllocationData="coalesce((SELECT data FROM documents WHERE collection_name=NEW.collection_name AND doc_id=NEW.doc_id),(SELECT data FROM pos_fiscal_authority_withdrawals_v2 WHERE collection_name=NEW.collection_name AND doc_id=NEW.doc_id ORDER BY id DESC LIMIT 1))";
/** Install after documents exists. Covers all generic, snapshot, V1 and format numbering writers.
 * Keep multi-statement trigger bodies on one line: Android UtilsSQLite splits at semicolon+newline. */
export const OFFLINE_FISCAL_ALLOCATION_WRITER_SCHEMA=`
CREATE TRIGGER IF NOT EXISTS pos_pending_receipt_v2 BEFORE INSERT ON documents WHEN NEW.collection_name='nativeFiscalReservations' AND EXISTS(SELECT 1 FROM pos_fiscal_pending_numbers_v2 p JOIN pos_offline_fiscal_allocations_v2 a ON a.authorization_id=p.authorization_id WHERE p.state IN('PREPARED','EFFECT_POSSIBLE') AND p.ncf=(substr(upper(trim(json_extract(NEW.data,'$.ncf'))),1,3)||printf('%010d',cast(substr(trim(json_extract(NEW.data,'$.ncf')),4) as integer))) AND json_extract(a.authority_json,'$.issuerRnc')=json_extract(NEW.data,'$.issuerRnc')) BEGIN SELECT RAISE(ABORT,'OFFLINE_FISCAL_NUMBER_RESERVED');END;

DROP TRIGGER IF EXISTS pos_pending_allocation_pointer_v2;
CREATE TRIGGER pos_pending_allocation_pointer_v2 BEFORE UPDATE ON documents WHEN OLD.collection_name='fiscalAllocations' AND (${allocationIdentityStillOwned('OLD.data')}) AND json_extract(NEW.data,'$.nextNumber') IS NOT json_extract(OLD.data,'$.nextNumber') AND EXISTS(SELECT 1 FROM pos_fiscal_pending_numbers_v2 p WHERE p.allocation_id=OLD.doc_id AND p.state IN('PREPARED','EFFECT_POSSIBLE')) BEGIN SELECT RAISE(ABORT,'OFFLINE_FISCAL_NUMBER_RESERVED');END;
CREATE TRIGGER IF NOT EXISTS pos_pending_buffer_insert_v2 BEFORE INSERT ON documents WHEN NEW.collection_name='localFiscalBuffer' AND EXISTS(SELECT 1 FROM pos_fiscal_pending_numbers_v2 p WHERE (p.buffer_id=NEW.doc_id OR p.allocation_id=json_extract(NEW.data,'$.allocationId')) AND p.state IN('PREPARED','EFFECT_POSSIBLE')) BEGIN SELECT RAISE(ABORT,'OFFLINE_FISCAL_NUMBER_RESERVED');END;
DROP TRIGGER IF EXISTS pos_pending_authority_delete_v2;
CREATE TRIGGER pos_pending_authority_delete_v2 BEFORE DELETE ON documents WHEN OLD.collection_name IN('config','fiscalAllocations','fiscalRanges') BEGIN  INSERT INTO pos_fiscal_authority_withdrawals_v2(collection_name,doc_id,data,recorded_at) SELECT OLD.collection_name,OLD.doc_id,OLD.data,strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE EXISTS(SELECT 1 FROM pos_offline_fiscal_allocations_v2 a WHERE OLD.collection_name='config' AND OLD.doc_id='current' OR EXISTS(SELECT 1 FROM json_each(a.authority_json,'$.allocations') m WHERE OLD.collection_name='fiscalAllocations' AND json_extract(m.value,'$.allocationId')=OLD.doc_id OR OLD.collection_name='fiscalRanges' AND json_extract(m.value,'$.fiscalRangeId')=OLD.doc_id));  UPDATE pos_offline_fiscal_allocations_v2 SET revoked=1 WHERE revoked=0 AND (OLD.collection_name='config' AND OLD.doc_id='current' OR EXISTS(SELECT 1 FROM json_each(authority_json,'$.allocations') m WHERE OLD.collection_name='fiscalAllocations' AND json_extract(m.value,'$.allocationId')=OLD.doc_id OR OLD.collection_name='fiscalRanges' AND json_extract(m.value,'$.fiscalRangeId')=OLD.doc_id)); END;
DROP TRIGGER IF EXISTS pos_pending_allocation_replace_v2;
CREATE TRIGGER pos_pending_allocation_replace_v2 BEFORE INSERT ON documents WHEN NEW.collection_name='fiscalAllocations' AND (${allocationIdentityStillOwned(previousAllocationData)}) AND EXISTS(SELECT 1 FROM pos_fiscal_pending_numbers_v2 p WHERE p.allocation_id=NEW.doc_id AND p.state IN('PREPARED','EFFECT_POSSIBLE') AND json_extract(NEW.data,'$.nextNumber') IS NOT json_extract(coalesce((SELECT data FROM documents WHERE collection_name=NEW.collection_name AND doc_id=NEW.doc_id),(SELECT data FROM pos_fiscal_authority_withdrawals_v2 WHERE collection_name=NEW.collection_name AND doc_id=NEW.doc_id ORDER BY id DESC LIMIT 1)),'$.nextNumber')) BEGIN SELECT RAISE(ABORT,'OFFLINE_FISCAL_NUMBER_RESERVED');END;
CREATE TRIGGER IF NOT EXISTS pos_pending_buffer_update_v2 BEFORE UPDATE ON documents WHEN OLD.collection_name='localFiscalBuffer' AND EXISTS(SELECT 1 FROM pos_fiscal_pending_numbers_v2 p WHERE p.buffer_id=OLD.doc_id AND p.state IN('PREPARED','EFFECT_POSSIBLE') AND (NEW.collection_name<>OLD.collection_name OR NEW.doc_id<>OLD.doc_id OR json_extract(NEW.data,'$.currentNumber') IS NOT json_extract(OLD.data,'$.currentNumber') OR json_remove(NEW.data,'$.currentNumber') IS NOT json_remove(OLD.data,'$.currentNumber'))) BEGIN SELECT RAISE(ABORT,'OFFLINE_FISCAL_NUMBER_RESERVED');END;
CREATE TRIGGER IF NOT EXISTS pos_pending_buffer_delete_v2 BEFORE DELETE ON documents WHEN OLD.collection_name='localFiscalBuffer' AND EXISTS(SELECT 1 FROM pos_fiscal_pending_numbers_v2 p WHERE p.buffer_id=OLD.doc_id AND p.state IN('PREPARED','EFFECT_POSSIBLE')) BEGIN SELECT RAISE(ABORT,'OFFLINE_FISCAL_NUMBER_RESERVED');END;

CREATE TRIGGER IF NOT EXISTS pos_allocation_config_revoke_insert_v2 AFTER INSERT ON documents WHEN NEW.collection_name='config' AND NEW.doc_id='current' BEGIN UPDATE pos_offline_fiscal_allocations_v2 SET revoked=1 WHERE revoked=0 AND (replace(replace(replace(replace(json_extract(NEW.data,'$.companyInfo.rnc'),' ',''),'-',''),'.',''),char(9),'') IS NOT json_extract(authority_json,'$.issuerRnc') OR NOT EXISTS(SELECT 1 FROM json_each(NEW.data,'$.terminals') t WHERE coalesce(json_extract(t.value,'$.config.erpTerminalId'),json_extract(t.value,'$.id'))=json_extract(authority_json,'$.scope.terminalId') AND json_extract(t.value,'$.config.currentDeviceId')=json_extract(authority_json,'$.scope.deviceId') AND json_extract(t.value,'$.config.erpBinding.tenantId')=json_extract(authority_json,'$.scope.tenantId') AND json_extract(t.value,'$.config.erpBinding.companyId')=json_extract(authority_json,'$.scope.companyId') AND json_extract(t.value,'$.config.erpBinding.storeId')=json_extract(authority_json,'$.scope.storeId') AND json_extract(t.value,'$.config.isPrimaryNode')=1 AND coalesce(json_extract(t.value,'$.config.governedByMaster'),0)=0 AND json_extract(t.value,'$.config.syncConfig.mode')='MASTER' AND json_extract(t.value,'$.config.fiscal.mode')='ECF' AND json_extract(t.value,'$.config.fiscal.providerId')='MSELLER' AND coalesce(json_extract(t.value,'$.config.fiscal.enabled'),1)=1 AND json_extract(t.value,'$.config.fiscal.environment')=json_extract(authority_json,'$.environment') AND json_extract(t.value,'$.config.fiscal.credentialKey')=json_extract(authority_json,'$.issuerRnc')));END;
CREATE TRIGGER IF NOT EXISTS pos_allocation_range_revoke_insert_v2 AFTER INSERT ON documents WHEN NEW.collection_name='fiscalRanges' BEGIN UPDATE pos_offline_fiscal_allocations_v2 SET revoked=1 WHERE revoked=0 AND EXISTS(SELECT 1 FROM json_each(authority_json,'$.allocations') m WHERE json_extract(m.value,'$.fiscalRangeId')=NEW.doc_id AND (json_extract(NEW.data,'$.isActive') IS NOT 1 OR json_extract(NEW.data,'$.type') IS NOT json_extract(m.value,'$.ncfType') OR json_extract(NEW.data,'$.prefix') IS NOT json_extract(m.value,'$.prefix') OR json_extract(NEW.data,'$.startNumber') IS NOT json_extract(m.value,'$.rangeStart') OR json_extract(NEW.data,'$.endNumber') IS NOT json_extract(m.value,'$.rangeEnd') OR nullif(json_extract(NEW.data,'$.expiryDate'),'') IS NOT json_extract(m.value,'$.expiryDate')));END;
CREATE TRIGGER IF NOT EXISTS pos_allocation_member_revoke_insert_v2 AFTER INSERT ON documents WHEN NEW.collection_name='fiscalAllocations' BEGIN UPDATE pos_offline_fiscal_allocations_v2 SET revoked=1 WHERE revoked=0 AND EXISTS(SELECT 1 FROM json_each(authority_json,'$.allocations') m WHERE json_extract(m.value,'$.allocationId')=NEW.doc_id AND (json_extract(NEW.data,'$.status') NOT IN('ACTIVE','EXHAUSTED') OR json_extract(NEW.data,'$.releasedAt') IS NOT NULL OR json_extract(NEW.data,'$.terminalId') IS NOT json_extract(authority_json,'$.scope.terminalId') OR json_extract(NEW.data,'$.fiscalRangeId') IS NOT json_extract(m.value,'$.fiscalRangeId') OR json_extract(NEW.data,'$.ncfType') IS NOT json_extract(m.value,'$.ncfType') OR json_extract(NEW.data,'$.reservedStart') IS NOT json_extract(m.value,'$.start') OR json_extract(NEW.data,'$.reservedEnd') IS NOT json_extract(m.value,'$.end')));END;

CREATE TRIGGER IF NOT EXISTS pos_allocation_config_revoke_update_v2 AFTER UPDATE ON documents WHEN NEW.collection_name='config' AND NEW.doc_id='current' BEGIN UPDATE pos_offline_fiscal_allocations_v2 SET revoked=1 WHERE revoked=0 AND (replace(replace(replace(replace(json_extract(NEW.data,'$.companyInfo.rnc'),' ',''),'-',''),'.',''),char(9),'') IS NOT json_extract(authority_json,'$.issuerRnc') OR NOT EXISTS(SELECT 1 FROM json_each(NEW.data,'$.terminals') t WHERE coalesce(json_extract(t.value,'$.config.erpTerminalId'),json_extract(t.value,'$.id'))=json_extract(authority_json,'$.scope.terminalId') AND json_extract(t.value,'$.config.currentDeviceId')=json_extract(authority_json,'$.scope.deviceId') AND json_extract(t.value,'$.config.erpBinding.tenantId')=json_extract(authority_json,'$.scope.tenantId') AND json_extract(t.value,'$.config.erpBinding.companyId')=json_extract(authority_json,'$.scope.companyId') AND json_extract(t.value,'$.config.erpBinding.storeId')=json_extract(authority_json,'$.scope.storeId') AND json_extract(t.value,'$.config.isPrimaryNode')=1 AND coalesce(json_extract(t.value,'$.config.governedByMaster'),0)=0 AND json_extract(t.value,'$.config.syncConfig.mode')='MASTER' AND json_extract(t.value,'$.config.fiscal.mode')='ECF' AND json_extract(t.value,'$.config.fiscal.providerId')='MSELLER' AND coalesce(json_extract(t.value,'$.config.fiscal.enabled'),1)=1 AND json_extract(t.value,'$.config.fiscal.environment')=json_extract(authority_json,'$.environment') AND json_extract(t.value,'$.config.fiscal.credentialKey')=json_extract(authority_json,'$.issuerRnc')));END;
CREATE TRIGGER IF NOT EXISTS pos_allocation_range_revoke_update_v2 AFTER UPDATE ON documents WHEN NEW.collection_name='fiscalRanges' BEGIN UPDATE pos_offline_fiscal_allocations_v2 SET revoked=1 WHERE revoked=0 AND EXISTS(SELECT 1 FROM json_each(authority_json,'$.allocations') m WHERE json_extract(m.value,'$.fiscalRangeId')=NEW.doc_id AND (json_extract(NEW.data,'$.isActive') IS NOT 1 OR json_extract(NEW.data,'$.type') IS NOT json_extract(m.value,'$.ncfType') OR json_extract(NEW.data,'$.prefix') IS NOT json_extract(m.value,'$.prefix') OR json_extract(NEW.data,'$.startNumber') IS NOT json_extract(m.value,'$.rangeStart') OR json_extract(NEW.data,'$.endNumber') IS NOT json_extract(m.value,'$.rangeEnd') OR nullif(json_extract(NEW.data,'$.expiryDate'),'') IS NOT json_extract(m.value,'$.expiryDate')));END;
CREATE TRIGGER IF NOT EXISTS pos_allocation_member_revoke_update_v2 AFTER UPDATE ON documents WHEN NEW.collection_name='fiscalAllocations' BEGIN UPDATE pos_offline_fiscal_allocations_v2 SET revoked=1 WHERE revoked=0 AND EXISTS(SELECT 1 FROM json_each(authority_json,'$.allocations') m WHERE json_extract(m.value,'$.allocationId')=NEW.doc_id AND (json_extract(NEW.data,'$.status') NOT IN('ACTIVE','EXHAUSTED') OR json_extract(NEW.data,'$.releasedAt') IS NOT NULL OR json_extract(NEW.data,'$.terminalId') IS NOT json_extract(authority_json,'$.scope.terminalId') OR json_extract(NEW.data,'$.fiscalRangeId') IS NOT json_extract(m.value,'$.fiscalRangeId') OR json_extract(NEW.data,'$.ncfType') IS NOT json_extract(m.value,'$.ncfType') OR json_extract(NEW.data,'$.reservedStart') IS NOT json_extract(m.value,'$.start') OR json_extract(NEW.data,'$.reservedEnd') IS NOT json_extract(m.value,'$.end')));END;
`;
const row=async(sql:SQL,query:string,params:any[]=[])=> (await sql.query(query,params)).values?.[0];
const document=async<T>(sql:SQL,name:string,id:string):Promise<T>=>{const value=await row(sql,'SELECT data FROM documents WHERE collection_name=? AND doc_id=?',[name,id]);if(!value)allocationFail('OFFLINE_FISCAL_ALLOCATION_REQUIRED');return JSON.parse(value.data);};
export async function saveAllocation(sql:SQL,value:OfflineFiscalAllocation,local:OfflineFiscalLocalAuthority,serverTime:string):Promise<void>{
 await validateOfflineFiscalAllocation(value,local);const now=Date.now(),server=Date.parse(serverTime);
 if(!Number.isFinite(server)||server<Date.parse(value.issuedAt))allocationFail('OFFLINE_FISCAL_CLOCK_INVALID');
 const previous=await row(sql,'SELECT * FROM pos_offline_fiscal_allocations_v2 WHERE authorization_id=?',[value.authorizationId]);
 if(previous){if(previous.authority_json!==JSON.stringify(value)||previous.binding_hash!==local.bindingHash||previous.revoked)allocationFail('OFFLINE_FISCAL_AUTHORITY_CHANGED');return;}
 await sql.run("UPDATE pos_offline_fiscal_allocations_v2 SET revoked=1 WHERE scope_key=? AND authorization_id<>? AND (binding_hash<>? OR json_extract(authority_json,'$.bindingFingerprint')<>? OR EXISTS(SELECT 1 FROM json_each(authority_json,'$.allocations') old WHERE NOT EXISTS(SELECT 1 FROM json_each(?) incoming WHERE json_extract(old.value,'$.allocationId') IS json_extract(incoming.value,'$.allocationId') AND json_extract(old.value,'$.fiscalRangeId') IS json_extract(incoming.value,'$.fiscalRangeId') AND json_extract(old.value,'$.ncfType') IS json_extract(incoming.value,'$.ncfType') AND json_extract(old.value,'$.prefix') IS json_extract(incoming.value,'$.prefix') AND json_extract(old.value,'$.padding') IS json_extract(incoming.value,'$.padding') AND json_extract(old.value,'$.start') IS json_extract(incoming.value,'$.start') AND json_extract(old.value,'$.end') IS json_extract(incoming.value,'$.end') AND json_extract(old.value,'$.rangeStart') IS json_extract(incoming.value,'$.rangeStart') AND json_extract(old.value,'$.rangeEnd') IS json_extract(incoming.value,'$.rangeEnd') AND json_extract(old.value,'$.expiryDate') IS json_extract(incoming.value,'$.expiryDate'))))",[fiscalWorkflowScopeKey(local.scope),value.authorizationId,local.bindingHash,value.bindingFingerprint,JSON.stringify(value.allocations)],false);
 await sql.run('INSERT INTO pos_offline_fiscal_allocations_v2(authorization_id,scope_key,authority_json,binding_hash,server_offset_ms,max_local_ms)VALUES(?,?,?,?,?,?)',[value.authorizationId,fiscalWorkflowScopeKey(local.scope),JSON.stringify(value),local.bindingHash,server-now,now],false);
}
export async function readAllocation(sql:SQL,local:OfflineFiscalLocalAuthority,id?:string,recovery=false):Promise<{authority:OfflineFiscalAllocation;now:number}|null>{
 const rows=(await sql.query('SELECT * FROM pos_offline_fiscal_allocations_v2 WHERE scope_key=? ORDER BY rowid DESC',[fiscalWorkflowScopeKey(local.scope)])).values||[];
 for(const saved of rows){if(id&&saved.authorization_id!==id)continue;if(saved.binding_hash!==local.bindingHash)allocationFail('OFFLINE_FISCAL_AUTHORITY_CHANGED');if(saved.revoked)allocationFail('OFFLINE_FISCAL_AUTHORITY_REVOKED');
  const value=JSON.parse(saved.authority_json) as OfflineFiscalAllocation;await validateOfflineFiscalAllocation(value,local);
  const now=Date.now();if(now<saved.max_local_ms&&!recovery)allocationFail('OFFLINE_FISCAL_CLOCK_ROLLBACK');
  if(now>=saved.max_local_ms)await sql.run('UPDATE pos_offline_fiscal_allocations_v2 SET max_local_ms=? WHERE authorization_id=?',[now,value.authorizationId],false);
  return {authority:value,now:now+saved.server_offset_ms};
 }return null;
}
export async function readAllocationSelection(sql:SQL,authority:OfflineFiscalAllocation,type:string,time:number,selection?:OfflineFiscalAllocationSelection,allocationId?:string){
 if(selection&&selection.environment!==undefined&&selection.environment!==authority.environment)allocationFail('OFFLINE_FISCAL_AUTHORITY_CHANGED');
 const members=authority.allocations.filter(a=>a.ncfType===type&&(!selection||a.allocationId===selection.allocationId)&&(!allocationId||a.allocationId===allocationId));
 if(!members.length)allocationFail('OFFLINE_FISCAL_ALLOCATION_REQUIRED');
 let expired=false;
 const config=await document<BusinessConfig>(sql,'config','current');
 for(const member of members){try{assertAllocationMemberTime(member,time);}catch{expired=true;continue;}
  const allocation=await document<FiscalAllocation>(sql,'fiscalAllocations',member.allocationId),range=await document<FiscalRangeDGII>(sql,'fiscalRanges',member.fiscalRangeId);
  if(allocation.terminalId!==authority.scope.terminalId||!['ACTIVE','EXHAUSTED'].includes(allocation.status)||allocation.releasedAt||allocation.reservedStart!==member.start||allocation.reservedEnd!==member.end||allocation.fiscalRangeId!==member.fiscalRangeId||range.isActive!==true||range.type!==type||range.prefix!==member.prefix||range.startNumber!==member.rangeStart||range.endNumber!==member.rangeEnd||(range.expiryDate||null)!==member.expiryDate)allocationFail('OFFLINE_FISCAL_AUTHORITY_CHANGED');
  const buffers=(await sql.query("SELECT data FROM documents WHERE collection_name='localFiscalBuffer' AND json_extract(data,'$.allocationId')=?",[member.allocationId])).values||[];
  if(buffers.length>1)allocationFail('OFFLINE_FISCAL_ALLOCATION_REQUIRED');
  const createBuffer=buffers.length===0;
  let buffer:LocalFiscalBuffer=createBuffer?{id:'V2-'+allocation.id,type:type as any,prefix:member.prefix,currentNumber:allocation.nextNumber,startNumber:allocation.nextNumber,endNumber:member.end,expiryDate:member.expiryDate||'',terminalId:authority.scope.terminalId,allocationId:allocation.id,fiscalRangeId:range.id}:JSON.parse(buffers[0].data);
  const refillBuffer=!createBuffer&&buffer.currentNumber>buffer.endNumber&&allocation.nextNumber<=member.end&&allocation.nextNumber>buffer.endNumber;
  if(refillBuffer)buffer={...buffer,currentNumber:allocation.nextNumber,startNumber:allocation.nextNumber,endNumber:member.end};
  const reserveAllocation=createBuffer||refillBuffer;
  const reservedAllocation=reserveAllocation?{...allocation,nextNumber:member.end+1}:allocation;
  if(buffer.currentNumber>Math.min(buffer.endNumber,member.end))continue;
  const ncf=formatFiscalNumber(type as any,member.prefix,buffer.currentNumber);
  if(selection&&(selection.bufferId!==buffer.id||selection.sequence!==buffer.currentNumber||selection.ncf!==ncf))allocationFail('OFFLINE_FISCAL_NUMBER_OWNER_CONFLICT');
  const nextBuffer={...validateFiscalBufferReservation({business:config,terminalId:authority.scope.terminalId,type:type as any,buffer:{...buffer,expiryDate:''},allocation:reservedAllocation,range:{...range,expiryDate:''},ncf}),expiryDate:buffer.expiryDate};
  const issuance=snapshotFiscalIssuance(config,range,allocation,buffer,ncf);
  return {config,buffer,allocation,range,nextBuffer,issuance,createBuffer,reserveAllocation,reservedAllocation,remaining:buffer.endNumber-buffer.currentNumber+1+Math.max(0,member.end-Math.max(reservedAllocation.nextNumber,buffer.endNumber+1)+1),selection:{authorizationId:authority.authorizationId,authorityHash:authority.authorityHash,environment:authority.environment,allocationId:member.allocationId,fiscalRangeId:member.fiscalRangeId,ncf,ncfType:type,sequence:buffer.currentNumber,bufferId:buffer.id} as OfflineFiscalAllocationSelection};
 }
 allocationFail(expired?'OFFLINE_FISCAL_RANGE_EXPIRED':'OFFLINE_FISCAL_RANGE_EXHAUSTED');
}
export async function prepareAllocationCheckout(sql:SQL,local:OfflineFiscalLocalAuthority,cartIdentity:string,operationId:string,context?:TableFiscalSaleContext):Promise<FiscalWorkflowCheckoutV2>{
 if((await sql.query("SELECT 1 FROM pos_fiscal_pending_numbers_v2 p JOIN pos_fiscal_checkouts_v2 c ON c.checkout_id=p.checkout_id WHERE p.state='ABANDONED' AND c.scope_key=? AND json_extract(c.checkout_json,'$.operationId')=?",[fiscalWorkflowScopeKey(local.scope),operationId])).values?.length)operationId=createUuid();
 const key=fiscalWorkflowScopeKey(local.scope),current=await row(sql,'SELECT c.checkout_json FROM pos_fiscal_checkout_current_v2 p JOIN pos_fiscal_checkouts_v2 c ON c.checkout_id=p.checkout_id WHERE p.scope_key=?',[key]);
 if(current){const saved=JSON.parse(current.checkout_json) as FiscalWorkflowCheckoutV2;
  if(saved.phase==='COMMITTED'||saved.phase==='ACKNOWLEDGED'&&saved.operationId===operationId)return saved;
  if(saved.phase==='ACKNOWLEDGED'){await sql.run('DELETE FROM pos_fiscal_checkout_current_v2 WHERE scope_key=?',[key],false);}
  else if(saved.cartIdentity===cartIdentity&&saved.operationId===operationId&&saved.allocation){await assertAllocationCheckout(sql,saved,saved.phase==='EFFECT_POSSIBLE');return saved;}
  else if(saved.allocation&&saved.phase==='PREPARED'&&!saved.paymentIds.length){
   await assertRetirementHasNoEffects(sql,{transactionId:saved.transactionId,checkoutId:saved.checkoutId,permitId:saved.checkoutId},{targetedQueues:true});
   await sql.run("UPDATE pos_fiscal_pending_numbers_v2 SET state='ABANDONED' WHERE checkout_id=? AND state='PREPARED'",[saved.checkoutId],false);
   await sql.run('DELETE FROM pos_fiscal_checkout_current_v2 WHERE scope_key=? AND checkout_id=?',[key,saved.checkoutId],false);operationId=createUuid();

  }else allocationFail('FISCAL_WORKFLOW_CHECKOUT_RECONCILIATION_REQUIRED');
 }
 const proof=await readAllocation(sql,local);if(!proof)allocationFail('OFFLINE_FISCAL_ALLOCATION_REQUIRED');
 let cart:any;try{cart=JSON.parse(cartIdentity);}catch{allocationFail();}if(context)validateTableFiscalSaleContext(context);
 if(!Array.isArray(cart.items)||!cart.items.length||cart.items.some((line:any)=>!line.id||!line.cartId||!Number.isFinite(line.quantity)||line.quantity<=0||!Number.isFinite(line.price)||line.price<0||line.articleFormat||line.recipeDetails?.length)||JSON.stringify(context)!==JSON.stringify(cart.fiscalSaleContext))allocationFail('OFFLINE_FISCAL_SOURCE_UNSUPPORTED');
 await assertNoPendingAllocationTable(sql,local.scope,context);
 const planned=await readAllocationSelection(sql,proof.authority,cart.fiscalType,proof.now);
 await planNativeFiscalReceipt(async<T>(query:string,params:any[])=>(await sql.query(query,params)).values as T[]||[],planned.config,planned.buffer,planned.selection.ncf,{transactionId:'pending',requireIssuer:true});
 const checkout:FiscalWorkflowCheckoutV2={checkoutId:createUuid(),operationId,transactionId:createUuid(),scopeKey:key,cartIdentity,permit:null,allocation:planned.selection,phase:'PREPARED',paymentIds:[],allocationIssuance:planned.issuance,offlineBindingHash:local.bindingHash,offlineSaleDate:new Date(proof.now).toISOString(),...(context?{fiscalSaleContext:context}:{})};
 await sql.run("INSERT INTO pos_fiscal_pending_numbers_v2(checkout_id,transaction_id,authorization_id,issuer_rnc,environment,account_key,buffer_id,allocation_id,ncf,sequence,state)VALUES(?,?,?,?,?,?,?,?,?,?,'PREPARED')",[checkout.checkoutId,checkout.transactionId,proof.authority.authorizationId,proof.authority.issuerRnc,proof.authority.environment,context?JSON.stringify([local.scope.tenantId,local.scope.companyId,local.scope.storeId,context.accountId]):null,planned.buffer.id,planned.allocation.id,planned.selection.ncf,planned.selection.sequence],false);
 await sql.run("INSERT INTO pos_fiscal_checkouts_v2(checkout_id,transaction_id,scope_key,cart_identity,permit_id,checkout_json,phase)VALUES(?,?,?,?,NULL,?,'PREPARED')",[checkout.checkoutId,checkout.transactionId,key,cartIdentity,JSON.stringify(checkout)],false);
 await sql.run('INSERT INTO pos_fiscal_checkout_current_v2(scope_key,checkout_id)VALUES(?,?)',[key,checkout.checkoutId],false);return checkout;
}
export async function assertAllocationCheckout(sql:SQL,checkout:FiscalWorkflowCheckoutV2,recovery=false){
 if(!checkout.allocation)allocationFail();const config=await document<BusinessConfig>(sql,'config','current'),local=await offlineFiscalAuthorityFromConfig(config),proof=await readAllocation(sql,local,checkout.allocation.authorizationId,recovery);
 if(!proof||proof.authority.authorityHash!==checkout.allocation.authorityHash||checkout.offlineBindingHash!==local.bindingHash)allocationFail('OFFLINE_FISCAL_AUTHORITY_CHANGED');
 const claim=await row(sql,'SELECT * FROM pos_fiscal_pending_numbers_v2 WHERE checkout_id=?',[checkout.checkoutId]);
 if(!claim||claim.transaction_id!==checkout.transactionId||claim.authorization_id!==proof.authority.authorizationId||claim.environment!==proof.authority.environment||claim.ncf!==checkout.allocation.ncf||claim.sequence!==checkout.allocation.sequence||claim.allocation_id!==checkout.allocation.allocationId||!['PREPARED','EFFECT_POSSIBLE'].includes(claim.state))allocationFail('OFFLINE_FISCAL_NUMBER_OWNER_CONFLICT');
 const at=recovery?Date.parse(checkout.offlineEffectAt||''):proof.now;
 if(!Number.isFinite(at)||at<Date.parse(proof.authority.issuedAt))allocationFail('OFFLINE_FISCAL_CLOCK_INVALID');
 const planned=await readAllocationSelection(sql,proof.authority,checkout.allocation.ncfType,at,checkout.allocation);
 return {...proof,planned};
}
/** Caller owns the native financial transaction. Never allocates or commits independently. */
export async function consumeAllocationNumber(sql:SQL,checkout:FiscalWorkflowCheckoutV2,source:Transaction,eventId:string):Promise<void>{
 const proof=await assertAllocationCheckout(sql,checkout,checkout.phase==='EFFECT_POSSIBLE'),selection=checkout.allocation!;
 const cart=JSON.parse(checkout.cartIdentity),money=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?Math.round(v*100):NaN;
 if(checkout.phase!=='EFFECT_POSSIBLE'||checkout.paymentIds.length!==source.payments.length||new Set(source.payments.map(p=>p.id)).size!==source.payments.length||source.payments.some(p=>!checkout.paymentIds.includes(p.id))||source.documentType!=='TICKET'||source.originalTransactionId||source.reservationId||source.v3ReservationClaimId||source.v3RestoredTicketId||source.payments.length===0||source.payments.some(p=>!['CASH','CARD','QR','WALLET','ADVANCE','OTHER','CREDIT','STORE_CREDIT','UBER_EATS'].includes(p.method))||money(Number(source.pendingBalance||0))!==source.payments.filter(p=>p.method==='CREDIT').reduce((sum,p)=>sum+money(p.amountApplied??p.appliedAmount??p.amount),0)||source.items.length!==cart.items.length||source.items.some(line=>line.quantity<=0||line.articleFormat||line.recipeDetails?.length||cart.items.filter((old:any)=>old.id===line.id&&old.cartId===line.cartId&&old.quantity===line.quantity&&old.price===line.price&&JSON.stringify([old.restaurantConfig,old.selected_combo_items,old.selected_modifiers,old.selected_fraction_parts,old.note,old.variantId,old.variantSku,old.trackingData])===JSON.stringify([line.restaurantConfig,line.selected_combo_items,line.selected_modifiers,line.selected_fraction_parts,line.note,line.variantId,line.variantSku,line.trackingData])).length!==1)||(source.customerId||null)!==(cart.customerId||null)||source.ncfType!==cart.fiscalType||money(source.netAmount)+money(source.taxAmount)+money(Number(source.serviceChargeAmount||0))!==money(source.total)||source.payments.reduce((sum,p)=>sum+money(p.amountApplied??p.appliedAmount??p.amount),0)!==money(source.total)||!checkout.fiscalSaleContext&&Number(source.serviceChargeAmount||0)!==0)allocationFail('OFFLINE_FISCAL_SOURCE_UNSUPPORTED');
 if(checkout.fiscalSaleContext&&Number(source.serviceChargeAmount||0)>0){
  const policy=source.serviceTaxPolicySnapshot,assignedBase=(source.taxBreakdown||[]).filter(r=>r.type==='SERVICE_CHARGE').reduce((sum,r)=>sum+money(r.taxableBase),0);
  if(policy?.legalTip?.enabled!==true||policy.legalTip.percentage!==10||money(Number(source.serviceChargeAmount))!==Math.round((money(source.netAmount)-assignedBase)*.1))allocationFail('OFFLINE_FISCAL_TABLE_TIP_UNSUPPORTED');
 }
 if(source.id!==checkout.transactionId||source.ncf!==selection.ncf||source.ncfType!==selection.ncfType||source.fiscalEnvironment!==proof.authority.environment||source.fiscalProvider!=='MSELLER'||source.fiscalMode!=='ECF'||source.fiscalAllocationAuthorizationId!==selection.authorizationId||source.date!==checkout.offlineSaleDate||JSON.stringify(source.fiscalSaleContext)!==JSON.stringify(checkout.fiscalSaleContext)||JSON.stringify(source.fiscalIssuance)!==JSON.stringify(checkout.allocationIssuance)||JSON.stringify({...source.fiscalIssuance,capturedAt:''})!==JSON.stringify({...proof.planned.issuance,capturedAt:''}))allocationFail('OFFLINE_FISCAL_SOURCE_AUTHORITY_CHANGED');
 await assertOfflineFiscalPaymentReceipts(sql,source);
 const receipt=await planNativeFiscalReceipt(async<T>(query:string,params:any[])=>(await sql.query(query,params)).values as T[]||[],proof.planned.config,proof.planned.buffer,selection.ncf,{eventId,transactionId:source.id,requireIssuer:true,occurredAt:source.date});
 await sql.run("UPDATE pos_fiscal_pending_numbers_v2 SET state='CONSUMED' WHERE checkout_id=? AND state IN('PREPARED','EFFECT_POSSIBLE')",[checkout.checkoutId],false);
 await sql.run('INSERT INTO article_format_wire_write_scope VALUES(1)',[],false);
 await sql.run(receipt.statement.statement,receipt.statement.values||[],false);
 await sql.run('DELETE FROM article_format_wire_write_scope WHERE id=1',[],false);
 if(proof.planned.createBuffer){
  await sql.run("INSERT INTO documents(collection_name,doc_id,data,sort_order,updatedAt)VALUES('localFiscalBuffer',?,?,0,?)",[selection.bufferId,JSON.stringify(proof.planned.nextBuffer),source.date],false);
 }else await sql.run("UPDATE documents SET data=?,updatedAt=? WHERE collection_name='localFiscalBuffer' AND doc_id=?",[JSON.stringify(proof.planned.nextBuffer),source.date,selection.bufferId],false);
 if(proof.planned.reserveAllocation)await sql.run("UPDATE documents SET data=?,updatedAt=? WHERE collection_name='fiscalAllocations' AND doc_id=?",[JSON.stringify(proof.planned.reservedAllocation),source.date,selection.allocationId],false);
}

export async function allocationAvailability(sql:SQL,local:OfflineFiscalLocalAuthority,type?:string){
 const proof=await readAllocation(sql,local);if(!proof)return null;
 const remaining:Record<string,number>={},total:Record<string,number>={};let lastError:unknown;
 for(const member of proof.authority.allocations.filter(m=>!type||m.ncfType===type)){
  try{const p=await readAllocationSelection(sql,proof.authority,member.ncfType,proof.now,undefined,member.allocationId);remaining[member.ncfType]=(remaining[member.ncfType]||0)+p.remaining;total[member.ncfType]=(total[member.ncfType]||0)+member.end-member.start+1;}
  catch(error){lastError=error;}
 }
 if(!Object.values(remaining).some(n=>n>0)&&lastError)throw lastError;
 return {authorizationId:proof.authority.authorizationId,remaining,total};
}
export async function allocationCommitPreconditions(sql:SQL,checkout:FiscalWorkflowCheckoutV2){
 const proof=await assertAllocationCheckout(sql,checkout,checkout.phase==='EFFECT_POSSIBLE');
 const ids=[['config','current'],['fiscalAllocations',proof.planned.allocation.id],['fiscalRanges',proof.planned.range.id],['localFiscalBuffer',proof.planned.buffer.id]];
 const snapshots=[];
 for(const [collection,id] of ids){const saved=await row(sql,'SELECT data FROM documents WHERE collection_name=? AND doc_id=?',[collection,id]);snapshots.push({collection,id,expected:saved?.data||null});}
 return snapshots;
}

/** Completed authority stays readable after withdrawal; verification uses the immutable local receipt, never new eligibility. */
export async function assertCommittedAllocationReceipt(sql:SQL,checkout:FiscalWorkflowCheckoutV2):Promise<void>{
 if(!checkout.allocation||!['COMMITTED','ACKNOWLEDGED'].includes(checkout.phase))return;
 const source=await document<Transaction>(sql,'transactionHistory',checkout.transactionId);
 const receipts=(await sql.query("SELECT data FROM documents WHERE collection_name='nativeFiscalReservations' AND json_extract(data,'$.transactionId')=?",[checkout.transactionId])).values||[];
 if(receipts.length!==1)allocationFail('OFFLINE_FISCAL_COMMITTED_RECEIPT_REQUIRED');const receipt=JSON.parse(receipts[0].data);
 if(receipt.ncf!==checkout.allocation.ncf||receipt.allocationId!==checkout.allocation.allocationId||receipt.fiscalRangeId!==checkout.allocation.fiscalRangeId||source.fiscalWorkflowCheckoutId!==checkout.checkoutId||source.ncf!==receipt.ncf||source.fiscalAllocationAuthorizationId!==checkout.allocation.authorizationId||JSON.stringify(source.fiscalIssuance)!==JSON.stringify(checkout.allocationIssuance)||JSON.stringify(checkout.committedNumbering)!==JSON.stringify({displayId:source.displayId,globalSequence:source.globalSequence,seriesNumber:source.seriesNumber}))allocationFail('OFFLINE_FISCAL_COMMITTED_RECEIPT_REQUIRED');
}

export async function assertNoPendingAllocationTable(sql:SQL,scope:import('../fiscal/FiscalWorkflowV2Types').FiscalWorkflowScope,context?:TableFiscalSaleContext){
 if(!context)return;const key=JSON.stringify([scope.tenantId,scope.companyId,scope.storeId,context.accountId]);
 if((await sql.query("SELECT 1 FROM pos_fiscal_pending_numbers_v2 WHERE account_key=? AND state<>'ABANDONED'",[key])).values?.length)allocationFail('PAYMENT_INTENT_RECONCILIATION_REQUIRED');
}
