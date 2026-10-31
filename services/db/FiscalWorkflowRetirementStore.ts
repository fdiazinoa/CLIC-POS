import {decodeOriginal,decodeBase64,originalDigest} from '../recovery/OriginalCodec';
import {CAPTURE_COLLECTIONS} from '../recovery/OriginalCapture';
import {cartDigest,isExpiredPrepared,retirementFail,validateRetirementProof,validateRetirementReceipt} from '../fiscal/FiscalWorkflowRetirement';
import type {FiscalRetirementProof,FiscalRetirementReceipt,FiscalRetirementRecord,FiscalWorkflowCheckoutV2} from '../fiscal/FiscalWorkflowV2Types';

/** UUID spelling equivalence only; arbitrary legacy identifiers retain byte/case identity. */
const uuidIdentity=(value:string)=>/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)?value.toLowerCase():value;
/** Parse JSON grammar instead of guessing codec tags from source prefixes. */
function typedOriginalText(text:string):boolean{
 if(new TextEncoder().encode(text).length>1048576)retirementFail();
 try{const value=JSON.parse(text);return Array.isArray(value)&&['object','array','string','number','date','boolean','null','undefined'].includes(value[0]);}catch{return false;}
}
type SQL={query(sql:string,values?:any[]):Promise<{values?:any[]}>;run(sql:string,values?:any[],transaction?:boolean):Promise<any>};
export const FISCAL_RETIREMENT_IDENTITY_SCHEMA=`
CREATE TABLE IF NOT EXISTS pos_fiscal_checkout_retirements_v1(checkout_id TEXT PRIMARY KEY REFERENCES pos_fiscal_checkouts_v2(checkout_id),transaction_id TEXT NOT NULL UNIQUE,command_id TEXT NOT NULL UNIQUE,scope_key TEXT NOT NULL,operation_id TEXT NOT NULL,permit_id TEXT NOT NULL,cart_identity_sha256 TEXT NOT NULL CHECK(length(cart_identity_sha256)=64),phase TEXT NOT NULL CHECK(phase IN ('CLOSING','CLOSED')),receipt_json TEXT,created_at TEXT NOT NULL,closed_at TEXT,CHECK((phase='CLOSING' AND receipt_json IS NULL AND closed_at IS NULL) OR (phase='CLOSED' AND receipt_json IS NOT NULL AND closed_at IS NOT NULL)));
CREATE INDEX IF NOT EXISTS pos_fiscal_retirement_scope_v1 ON pos_fiscal_checkout_retirements_v1(scope_key,created_at);
CREATE TRIGGER IF NOT EXISTS pos_fiscal_retirement_identity_v1 BEFORE UPDATE ON pos_fiscal_checkout_retirements_v1 WHEN OLD.phase<>'CLOSING' OR NEW.phase<>'CLOSED' OR OLD.checkout_id IS NOT NEW.checkout_id OR OLD.transaction_id IS NOT NEW.transaction_id OR OLD.command_id IS NOT NEW.command_id OR OLD.scope_key IS NOT NEW.scope_key OR OLD.operation_id IS NOT NEW.operation_id OR OLD.permit_id IS NOT NEW.permit_id OR OLD.cart_identity_sha256 IS NOT NEW.cart_identity_sha256 OR OLD.created_at IS NOT NEW.created_at BEGIN SELECT RAISE(ABORT,'FISCAL_WORKFLOW_RETIREMENT_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS pos_fiscal_retirement_delete_v1 BEFORE DELETE ON pos_fiscal_checkout_retirements_v1 BEGIN SELECT RAISE(ABORT,'FISCAL_WORKFLOW_RETIREMENT_IMMUTABLE');END;
CREATE INDEX IF NOT EXISTS pos_fiscal_retirement_operation_v1 ON pos_fiscal_checkout_retirements_v1(scope_key,operation_id);
CREATE TRIGGER IF NOT EXISTS pos_fiscal_retired_checkout_insert_v2 BEFORE INSERT ON pos_fiscal_checkouts_v2 WHEN EXISTS(SELECT 1 FROM pos_fiscal_checkout_retirements_v1 WHERE checkout_id=NEW.checkout_id COLLATE NOCASE OR transaction_id=NEW.transaction_id COLLATE NOCASE OR permit_id=NEW.permit_id COLLATE NOCASE OR (scope_key=NEW.scope_key AND operation_id=json_extract(NEW.checkout_json,'$.operationId') COLLATE NOCASE)) BEGIN SELECT RAISE(ABORT,'FISCAL_WORKFLOW_RETIREMENT_FENCED');END;
CREATE TRIGGER IF NOT EXISTS pos_fiscal_retired_checkout_v2 BEFORE UPDATE ON pos_fiscal_checkouts_v2 WHEN EXISTS(SELECT 1 FROM pos_fiscal_checkout_retirements_v1 WHERE checkout_id=OLD.checkout_id COLLATE NOCASE) BEGIN SELECT RAISE(ABORT,'FISCAL_WORKFLOW_RETIREMENT_FENCED');END;
CREATE TRIGGER IF NOT EXISTS pos_fiscal_retired_permit_v2 BEFORE UPDATE ON pos_fiscal_permits_v2 WHEN EXISTS(SELECT 1 FROM pos_fiscal_checkout_retirements_v1 WHERE checkout_id=OLD.checkout_id COLLATE NOCASE OR permit_id=OLD.permit_id COLLATE NOCASE) BEGIN SELECT RAISE(ABORT,'FISCAL_WORKFLOW_RETIREMENT_FENCED');END;
CREATE TRIGGER IF NOT EXISTS pos_fiscal_retired_pointer_delete_v2 BEFORE DELETE ON pos_fiscal_checkout_current_v2 WHEN EXISTS(SELECT 1 FROM pos_fiscal_checkout_retirements_v1 WHERE checkout_id=OLD.checkout_id COLLATE NOCASE AND (scope_key<>OLD.scope_key OR phase<>'CLOSED' OR receipt_json IS NULL)) BEGIN SELECT RAISE(ABORT,'FISCAL_WORKFLOW_RETIREMENT_FENCED');END;
CREATE TRIGGER IF NOT EXISTS pos_fiscal_retired_pointer_update_v2 BEFORE UPDATE ON pos_fiscal_checkout_current_v2 WHEN EXISTS(SELECT 1 FROM pos_fiscal_checkout_retirements_v1 WHERE checkout_id=OLD.checkout_id COLLATE NOCASE OR checkout_id=NEW.checkout_id COLLATE NOCASE) BEGIN SELECT RAISE(ABORT,'FISCAL_WORKFLOW_RETIREMENT_FENCED');END;
CREATE TRIGGER IF NOT EXISTS pos_fiscal_retired_pointer_insert_v2 BEFORE INSERT ON pos_fiscal_checkout_current_v2 WHEN EXISTS(SELECT 1 FROM pos_fiscal_checkout_retirements_v1 WHERE checkout_id=NEW.checkout_id COLLATE NOCASE) BEGIN SELECT RAISE(ABORT,'FISCAL_WORKFLOW_RETIREMENT_FENCED');END;
`;
// Targets must exist first: installed after documents + durable outbox on native init.
export const FISCAL_RETIREMENT_WRITER_SCHEMA=[
 ...['payment_intents_v2','pos_fiscal_watch_v2','pos_fiscal_state_v2'].flatMap(table=>['INSERT','UPDATE'].map(event=>`CREATE TRIGGER IF NOT EXISTS retired_${table}_${event.toLowerCase()}_v2 BEFORE ${event} ON ${table} WHEN EXISTS(SELECT 1 FROM pos_fiscal_checkout_retirements_v1 WHERE transaction_id=NEW.transaction_id COLLATE NOCASE) BEGIN SELECT RAISE(ABORT,'FISCAL_WORKFLOW_RETIREMENT_FENCED');END;`)),
 ...['INSERT','UPDATE'].map(event=>`CREATE TRIGGER IF NOT EXISTS retired_documents_${event.toLowerCase()}_v2 BEFORE ${event} ON documents WHEN NEW.collection_name IN ('transactions','transactionHistory','inventoryLedger','inventoryTracking','collections','cashMovements','wallet_transactions','recoveryOriginals','recoveryStage','recoveryState','v3RestoredTicketSources') AND EXISTS(SELECT 1 FROM pos_fiscal_checkout_retirements_v1 r WHERE r.transaction_id=NEW.doc_id COLLATE NOCASE OR r.checkout_id=NEW.doc_id COLLATE NOCASE OR r.permit_id=NEW.doc_id COLLATE NOCASE OR EXISTS(SELECT 1 FROM json_tree(NEW.data) j WHERE j.type='text' AND j.value COLLATE NOCASE IN (r.transaction_id,r.checkout_id,r.permit_id))) BEGIN SELECT RAISE(ABORT,'FISCAL_WORKFLOW_RETIREMENT_FENCED');END;`),
 ...['INSERT','UPDATE'].map(event=>`CREATE TRIGGER IF NOT EXISTS retired_legacy_queue_${event.toLowerCase()}_v2 BEFORE ${event} ON sync_queue WHEN EXISTS(SELECT 1 FROM pos_fiscal_checkout_retirements_v1 r JOIN json_tree(NEW.payload) j ON j.type='text' AND j.value COLLATE NOCASE IN (r.transaction_id,r.checkout_id,r.permit_id)) BEGIN SELECT RAISE(ABORT,'FISCAL_WORKFLOW_RETIREMENT_FENCED');END;`),
 ...['INSERT','UPDATE'].map(event=>`CREATE TRIGGER IF NOT EXISTS retired_outbox_${event.toLowerCase()}_v2 BEFORE ${event} ON sync_outbox_v2 WHEN NEW.event_type IN ('SALE_POSTED','PAYMENT_POSTED') AND EXISTS(SELECT 1 FROM pos_fiscal_checkout_retirements_v1 WHERE transaction_id=NEW.aggregate_id COLLATE NOCASE OR transaction_id=json_extract(NEW.payload_json,'$.transaction.id') COLLATE NOCASE OR transaction_id=json_extract(NEW.payload_json,'$.summary.transaction_id') COLLATE NOCASE OR transaction_id=json_extract(NEW.payload_json,'$.fiscalWorkflowBirth.transactionId') COLLATE NOCASE OR permit_id=json_extract(NEW.payload_json,'$.fiscalWorkflowBirth.permitId') COLLATE NOCASE) BEGIN SELECT RAISE(ABORT,'FISCAL_WORKFLOW_RETIREMENT_FENCED');END;`),
].join('\n');
export const OFFLINE_FISCAL_ABANDON_WRITER_SCHEMA=FISCAL_RETIREMENT_WRITER_SCHEMA.replaceAll('retired_','offline_abandoned_').replaceAll('pos_fiscal_checkout_retirements_v1','pos_offline_fiscal_abandoned_v1').replaceAll('FISCAL_WORKFLOW_RETIREMENT_FENCED','OFFLINE_FISCAL_ABANDONED');
const one=async(sql:SQL,q:string,v:any[]=[])=> (await sql.query(q,v)).values?.[0];
const proofFrom=(row:any):FiscalRetirementProof=>({schemaVersion:1,commandId:row.command_id,checkoutId:row.checkout_id,transactionId:row.transaction_id,permitId:row.permit_id,originalOperationId:row.operation_id,cartIdentitySha256:row.cart_identity_sha256,reason:'EXPIRED_PREPARED_NO_EFFECTS'});
const record=(row:any):FiscalRetirementRecord=>({...proofFrom(row),scopeKey:row.scope_key,phase:row.phase,receipt:row.receipt_json?JSON.parse(row.receipt_json):null});
export async function readRetirement(sql:SQL,scopeKey:string):Promise<FiscalRetirementRecord|null>{
 const row=await one(sql,'SELECT * FROM pos_fiscal_checkout_retirements_v1 WHERE scope_key=? ORDER BY created_at DESC,command_id DESC LIMIT 1',[scopeKey]);return row?record(row):null;
}
export async function assertNotRetired(sql:SQL,checkoutId:string):Promise<void>{if(await one(sql,'SELECT 1 FROM pos_fiscal_checkout_retirements_v1 WHERE checkout_id=? COLLATE NOCASE',[checkoutId]))throw Error('FISCAL_WORKFLOW_RETIREMENT_FENCED');}
async function original(sql:SQL,scopeKey:string,proof:FiscalRetirementProof):Promise<FiscalWorkflowCheckoutV2>{
 validateRetirementProof(proof);
 const row=await one(sql,'SELECT c.* FROM pos_fiscal_checkouts_v2 c JOIN pos_fiscal_checkout_current_v2 p ON p.checkout_id=c.checkout_id AND p.scope_key=c.scope_key WHERE c.scope_key=? AND c.checkout_id=?',[scopeKey,proof.checkoutId]);
 if(!row)retirementFail();let c:FiscalWorkflowCheckoutV2;try{c=JSON.parse(row.checkout_json);}catch{return retirementFail();}
 if(!isExpiredPrepared(c,scopeKey)||c.checkoutId!==proof.checkoutId||row.checkout_id!==c.checkoutId||row.scope_key!==c.scopeKey||new TextEncoder().encode(c.cartIdentity).length>1048576||row.phase!=='PREPARED'||row.transaction_id!==c.transactionId||row.cart_identity!==c.cartIdentity||row.permit_id!==c.permit!.permitId||c.operationId!==proof.originalOperationId||c.transactionId!==proof.transactionId||c.permit!.permitId!==proof.permitId||await cartDigest(c.cartIdentity)!==proof.cartIdentitySha256)retirementFail();
 const p=await one(sql,'SELECT * FROM pos_fiscal_permits_v2 WHERE permit_id=?',[proof.permitId]);
 if(!p||p.state!=='RESERVED'||p.checkout_id!==proof.checkoutId||p.transaction_id!==proof.transactionId||p.scope_key!==scopeKey||p.expires_at!==c.permit!.expiresAt||p.permit_json!==JSON.stringify(c.permit))retirementFail();return c;
}
export const RETIREMENT_SCAN_LIMITS={rows:512,encodedBytes:1048576,totalBytes:8388608,decodedBytes:1048576,nodes:50000,depth:64} as const;
const relevantCollections=['v3RestoredTicketSources','recoveryOriginals','recoveryStage','recoveryState'];
/** All replay stores are decoded under the writer. Unknown/oversized evidence is a hold. */
export async function assertRetirementHasNoEffects(sql:SQL,p:Pick<FiscalRetirementProof,'transactionId'|'checkoutId'|'permitId'>,options:{targetedQueues?:boolean;releasedPayments?:string[]}={}):Promise<void>{
 // A tender the provider declined (or the cashier confirmed as "no apareció en el voucher") never moved money,
 // so it cannot turn an unborn attempt into a possible effect. Anything else still blocks the release.
 const released=new Set((options.releasedPayments||[]).map(id=>String(id||'').trim()).filter(Boolean));
 const intents=(await sql.query('SELECT payment_id,status FROM payment_intents_v2 WHERE transaction_id=? COLLATE NOCASE',[p.transactionId])).values||[];
 if(intents.length&&!(released.size&&intents.every(row=>released.has(String(row.payment_id||''))&&String(row.status||'').toUpperCase()==='DECLINED')))retirementFail();
 for(const table of ['pos_fiscal_watch_v2','pos_fiscal_state_v2'])if(await one(sql,`SELECT 1 FROM ${table} WHERE transaction_id=? COLLATE NOCASE LIMIT 1`,[p.transactionId]))retirementFail();
 const ids=new Set([p.transactionId,p.checkoutId,p.permitId].map(uuidIdentity));let nodes=0,total=0;
 const inspect=(value:any,depth=0,wrappers=0,key=''):void=>{
  if(++nodes>RETIREMENT_SCAN_LIMITS.nodes||depth>RETIREMENT_SCAN_LIMITS.depth||wrappers>8)retirementFail();
  if(typeof value==='string'){
   if(ids.has(uuidIdentity(value)))retirementFail();
   if(['document','original','producerInput','configuration','item','body','requestBody','expectedDocument','declarationBody','capture'].includes(key))inspect(decode(value),0,wrappers+1);
   else if(typedOriginalText(value)){retirementFail();
   }else if(['submissionBody','packetJson','requestJson','sourceExpected'].includes(key))inspect(parse(value),0,wrappers+1);
  }else if(value&&typeof value==='object')Object.entries(value).forEach(([key,v])=>inspect(v,depth+1,wrappers,key));
 };
 const parse=(text:string)=>{try{return JSON.parse(text);}catch{return retirementFail();}};
 const decode=(text:string)=>{if(typeof text!=='string'||new TextEncoder().encode(text).length>RETIREMENT_SCAN_LIMITS.decodedBytes)retirementFail();try{return decodeOriginal(text);}catch{return retirementFail();}};
 const finance=(await sql.query(`SELECT doc_id FROM documents WHERE collection_name IN ('transactions','transactionHistory','inventoryLedger','inventoryTracking','collections','cashMovements','wallet_transactions') AND (doc_id COLLATE NOCASE IN (?,?,?) OR EXISTS(SELECT 1 FROM json_tree(documents.data) j WHERE j.type='text' AND j.value COLLATE NOCASE IN (?,?,?))) LIMIT 1`,[p.transactionId,p.checkoutId,p.permitId,p.transactionId,p.checkoutId,p.permitId])).values||[];if(finance.length)retirementFail();

 const inspectEnvelope=(envelope:any,kind?:string,originalId?:string)=>{
  inspect(envelope);
  if(kind==='MEMBERSHIP'){if(envelope?.version!==1||envelope.domain!=='pos.retained-capture-set.v1')retirementFail();return;}
  if(envelope?.version!==1||!CAPTURE_COLLECTIONS[envelope.collection]||kind&&CAPTURE_COLLECTIONS[envelope.collection]!==kind||typeof envelope.document!=='string'||typeof envelope.original!=='string'
    ||Object.keys(envelope).some(k=>!['version','collection','document','original','originalStage','producerInput','configuration','transport','closeCommitId'].includes(k)))retirementFail();
  const doc=decode(envelope.document);if(!doc||typeof doc!=='object'||originalId!==undefined&&(doc as any).id!==originalId)retirementFail();inspect(doc);inspect(decode(envelope.original));
  if(envelope.producerInput!==undefined)inspect(decode(envelope.producerInput));if(envelope.configuration!==undefined)inspect(decode(envelope.configuration));
  if(envelope.transport!==undefined){const t=envelope.transport;if(!t||t.version!==1||!['/api/sync/transactions','/api/sync/cash/movements'].includes(t.route)||typeof t.item!=='string'||Object.keys(t).some(k=>!['version','route','item'].includes(k)))retirementFail();inspect(decode(t.item));}
 };
 const rows=(await sql.query(`SELECT collection_name,doc_id,length(CAST(data AS BLOB)) bytes,substr(data,1,1048577) data FROM documents WHERE collection_name IN (${relevantCollections.map(()=>'?').join(',')}) LIMIT 513`,relevantCollections)).values||[];
 if(rows.length>RETIREMENT_SCAN_LIMITS.rows)retirementFail();
 for(const row of rows){total+=row.bytes;if(row.bytes>RETIREMENT_SCAN_LIMITS.encodedBytes||total>RETIREMENT_SCAN_LIMITS.totalBytes)retirementFail();if(ids.has(uuidIdentity(row.doc_id)))retirementFail();const value=parse(row.data);inspect(value);
  if(row.collection_name==='recoveryState'&&typeof value?.body==='string'){
   const body:any=decode(value.body);let identity:any[]=[];try{const id=JSON.parse(row.doc_id);if(Array.isArray(id))identity=id;}catch{/* Plain IDs are separate supported profiles below. */}
   const kind=identity[0];
   if(['TRANSACTION','CASH_MOVEMENT','COLLECTION','WALLET','Z_REPORT'].includes(kind))inspectEnvelope(body,kind,identity[1]);
   else{
    if(typeof value.bodySha256!=='string'||await originalDigest(new TextEncoder().encode(value.body))!==value.bodySha256||!body||typeof body!=='object'||Array.isArray(body))retirementFail();
    const known=kind==='closePreparation'&&body.domain==='pos.close.preparation.local.v1'&&body.version===1
      ||kind==='recoveryCloseUI'&&value.uiRecoveryClose===1&&body.scopeKey===identity[1]&&body.preparationId===identity[2]
      ||kind==='receivedCloseCandidate'&&body.input?.scopeKey===identity[1]&&body.input?.preparationId===identity[2]&&typeof body.submissionBody==='string'
      ||kind==='receivedCloseAck'&&body.status==='COMMITTED'&&body.coverage==='RECEIVED_ONLY'
      ||kind==='receivedClosePublished'&&typeof body.commitId==='string'&&typeof body.packetHash==='string'
      ||kind==='receivedCloseCancelled'&&body.status==='CANCELLED'&&body.reason==='NUMBER_CONFLICT';
    if(!known)retirementFail();
    const fields:Record<string,string[]>={
     closePreparation:['domain','version','requestBody','commandId','closeControl','preparedAt','nativeReport','nativeConfiguration','receivedContext','members','dependencies','observation','coverage','configurationCoverage','seal','exactZEligible','closeAuthorization'],
     recoveryCloseUI:['scopeKey','preparationId','snapshotId','seriesId','receiptBindings','terminalId'],
     receivedCloseCandidate:['input','scope','preparationHash','observed','submissionBody'],
     receivedCloseAck:['scope','commitId','membershipId','commandId','closeId','closeEventId','intentHash','registrationHash','seriesId','number','code','journalId','nextOpenSetId','report','summary','journal','packetHash','status','coverage','legacy','exactZEligible','closeAuthorization','snapshotId','snapshot','preparationHash','resourceHash','requestHash','committedAt','nativeProfile','financialState','operationStates','selectionProfile','configurationBasis','historicalConfiguration'],
     receivedClosePublished:['commitId','packetHash'],
     receivedCloseCancelled:['version','status','reason','proofId','commandId','scope','requestHash','exactZEligible','closeAuthorization','cancelledAt','series']
    };if(!fields[kind]||Object.keys(body).some(k=>!fields[kind].includes(k)))retirementFail();
    inspect(body);
   }
  }
  if(row.collection_name==='recoveryState'&&value?.body!==undefined&&typeof value.body!=='string'&&!(row.doc_id.startsWith('pendingSelection:')&&value.body?.version===1&&value.body?.profile==='erp.received-native-operations.v1'))retirementFail();
  if(row.collection_name==='v3RestoredTicketSources'&&typeof value?.sourceExpected==='string')inspect(parse(value.sourceExpected));
  if(['recoveryOriginals','recoveryStage'].includes(row.collection_name)){
   const r=row.collection_name==='recoveryStage'?value.record:value;
   if(row.collection_name==='recoveryStage'&&r?.encoding!=='pos.original.typed-json.v1')retirementFail();
   if(!r||!['MEMBERSHIP',...Object.values(CAPTURE_COLLECTIONS)].includes(r.kind)||typeof r.originalId!=='string')retirementFail();
   let envelope:any;if(row.collection_name==='recoveryStage'){if(typeof r.bodyBase64!=='string'||r.bodyBase64.length>RETIREMENT_SCAN_LIMITS.encodedBytes)retirementFail();try{const bytes=decodeBase64(r.bodyBase64);if(r.version!==1||bytes.length!==r.byteLength||await originalDigest(bytes)!==r.bodySha256)retirementFail();envelope=decode(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return retirementFail();}}
   else envelope=decode(r.body);
   inspectEnvelope(envelope,r.kind,r.originalId);
  }
 }
 for(const [table,column] of [['sync_outbox_v2','payload_json'],['sync_queue','payload']] as const){
  // Offline abandon may have >512 unrelated ordinary sales queued. Preserve every
  // recursive decoder candidate; only plain, unrelated queue envelopes are skipped.
  const targeted=options.targetedQueues?` WHERE ${table==='sync_outbox_v2'?'aggregate_id COLLATE NOCASE IN (?,?,?) OR ':''}EXISTS(SELECT 1 FROM json_tree(${column}) j WHERE j.type='text' AND (j.value COLLATE NOCASE IN (?,?,?) OR j.key IN ('document','original','producerInput','configuration','item','body','requestBody','expectedDocument','declarationBody','capture','submissionBody','packetJson','requestJson','sourceExpected') OR CASE WHEN json_valid(j.value) THEN json_extract(j.value,'$[0]') IN ('object','array','string','number','date','boolean','null','undefined') ELSE 0 END))`:'';
  const identities=[p.transactionId,p.checkoutId,p.permitId],params=options.targetedQueues?[...(table==='sync_outbox_v2'?identities:[]),...identities]:[];
  const queued=(await sql.query(`SELECT length(CAST(${column} AS BLOB)) bytes,substr(${column},1,1048577) payload${table==='sync_outbox_v2'?',aggregate_id':''} FROM ${table}${targeted} LIMIT 513`,params)).values||[];if(queued.length>512)retirementFail();for(const row of queued){total+=row.bytes;if(row.bytes>RETIREMENT_SCAN_LIMITS.encodedBytes||total>RETIREMENT_SCAN_LIMITS.totalBytes)retirementFail();inspect(row.aggregate_id);inspect(parse(row.payload));}}
}
export async function beginRetirement(sql:SQL,scopeKey:string,proof:FiscalRetirementProof):Promise<FiscalRetirementRecord>{
 const c=await original(sql,scopeKey,proof);await assertRetirementHasNoEffects(sql,proof);
 const existing=await one(sql,'SELECT * FROM pos_fiscal_checkout_retirements_v1 WHERE checkout_id=? OR command_id=?',[proof.checkoutId,proof.commandId]);
 if(existing){if(Object.entries(proofFrom(existing)).some(([k,v])=>(proof as any)[k]!==v)||existing.scope_key!==scopeKey||existing.phase!=='CLOSING')retirementFail();return record(existing);}
 await sql.run("INSERT INTO pos_fiscal_checkout_retirements_v1(checkout_id,transaction_id,command_id,scope_key,operation_id,permit_id,cart_identity_sha256,phase,created_at) VALUES(?,?,?,?,?,?,?,'CLOSING',?)",[c.checkoutId,c.transactionId,proof.commandId,scopeKey,c.operationId,proof.permitId,proof.cartIdentitySha256,new Date().toISOString()],false);
 return {...proof,scopeKey,phase:'CLOSING',receipt:null};
}
/** ERP-first retirement: the server receipt is the only authority that the attempt never
 * became a document, so the local record is written closed in one step after the answer.
 * Used for attempts that already carry an effect marker, which the expired-prepared path
 * (isExpiredPrepared) can never cover. */
export async function closeUnbornRetirement(sql:SQL,scopeKey:string,proof:FiscalRetirementProof,receipt:FiscalRetirementReceipt):Promise<FiscalRetirementRecord>{
 validateRetirementProof(proof);validateRetirementReceipt(receipt,proof,JSON.parse(scopeKey));
 const existing=await one(sql,'SELECT * FROM pos_fiscal_checkout_retirements_v1 WHERE checkout_id=? COLLATE NOCASE OR command_id=? COLLATE NOCASE OR transaction_id=? COLLATE NOCASE OR permit_id=? COLLATE NOCASE',[proof.checkoutId,proof.commandId,proof.transactionId,proof.permitId]);
 if(existing){if(existing.phase==='CLOSED'&&existing.checkout_id===proof.checkoutId&&existing.command_id===proof.commandId&&existing.receipt_json===JSON.stringify(receipt))return record(existing);retirementFail();}
 const row=await one(sql,'SELECT c.* FROM pos_fiscal_checkouts_v2 c JOIN pos_fiscal_checkout_current_v2 p ON p.checkout_id=c.checkout_id AND p.scope_key=c.scope_key WHERE c.scope_key=? AND c.checkout_id=?',[scopeKey,proof.checkoutId]);
 if(!row)retirementFail();let c:FiscalWorkflowCheckoutV2;try{c=JSON.parse(row.checkout_json);}catch{return retirementFail();}
 if(c.checkoutId!==proof.checkoutId||c.transactionId!==proof.transactionId||c.operationId!==proof.originalOperationId||c.scopeKey!==scopeKey
   ||!c.permit||c.permit.permitId!==proof.permitId||row.phase!=='PREPARED'&&row.phase!=='EFFECT_POSSIBLE'
   ||await cartDigest(c.cartIdentity)!==proof.cartIdentitySha256)retirementFail();
 const p=await one(sql,'SELECT * FROM pos_fiscal_permits_v2 WHERE permit_id=?',[proof.permitId]);
 if(!p||p.state!=='RESERVED'||p.checkout_id!==proof.checkoutId||p.transaction_id!==proof.transactionId||p.scope_key!==scopeKey||p.expires_at!==c.permit.expiresAt||p.permit_json!==JSON.stringify(c.permit))retirementFail();
 await assertRetirementHasNoEffects(sql,proof,{targetedQueues:true});
 const now=new Date().toISOString();
 await sql.run("INSERT INTO pos_fiscal_checkout_retirements_v1(checkout_id,transaction_id,command_id,scope_key,operation_id,permit_id,cart_identity_sha256,phase,receipt_json,created_at,closed_at)VALUES(?,?,?,?,?,?,?,'CLOSED',?,?,?)",[proof.checkoutId,proof.transactionId,proof.commandId,scopeKey,proof.originalOperationId,proof.permitId,proof.cartIdentitySha256,JSON.stringify(receipt),now,receipt.closedAt],false);
 await sql.run('DELETE FROM pos_fiscal_checkout_current_v2 WHERE scope_key=? AND checkout_id=?',[scopeKey,proof.checkoutId],false);
 if(Number((await one(sql,'SELECT changes() count'))?.count)!==1)retirementFail();
 return {...proof,scopeKey,phase:'CLOSED',receipt};
}

export async function completeRetirement(sql:SQL,scopeKey:string,receipt:FiscalRetirementReceipt):Promise<FiscalRetirementRecord>{
 const row=await one(sql,'SELECT * FROM pos_fiscal_checkout_retirements_v1 WHERE command_id=? AND scope_key=?',[receipt.commandId,scopeKey]);if(!row)retirementFail();const proof=proofFrom(row);
 validateRetirementReceipt(receipt,proof,JSON.parse(scopeKey));
 if(row.phase==='CLOSED'){if(row.receipt_json!==JSON.stringify(receipt))retirementFail();return record(row);}
 await original(sql,scopeKey,proof);await assertRetirementHasNoEffects(sql,proof);
 await sql.run("UPDATE pos_fiscal_checkout_retirements_v1 SET phase='CLOSED',receipt_json=?,closed_at=? WHERE command_id=? AND phase='CLOSING'",[JSON.stringify(receipt),receipt.closedAt,proof.commandId],false);
 await sql.run('DELETE FROM pos_fiscal_checkout_current_v2 WHERE scope_key=? AND checkout_id=?',[scopeKey,proof.checkoutId],false);
 if(Number((await one(sql,'SELECT changes() count'))?.count)!==1)retirementFail();return {...proof,scopeKey,phase:'CLOSED',receipt};
}

/** Promotion uses original provenance under the same native writer transaction, never just runtime id. */
export async function assertRetirementRecoveryPromotion(sql:SQL,mutations:import('./DatabaseAdapter').DurableDocumentMutation[]):Promise<void>{
 const promoted=mutations.filter(row=>row.recoveryOriginal!==undefined);
 if(!promoted.length)return;
 const abandonedExists=(await sql.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='pos_offline_fiscal_abandoned_v1'")).values?.length;
 const retired=(await sql.query('SELECT transaction_id,checkout_id,permit_id FROM pos_fiscal_checkout_retirements_v1'+(abandonedExists?' UNION SELECT transaction_id,checkout_id,permit_id FROM pos_offline_fiscal_abandoned_v1':'')+' LIMIT 513')).values||[];
 if(!retired.length)return;if(retired.length>RETIREMENT_SCAN_LIMITS.rows)retirementFail();
 const ids=new Set(retired.flatMap(row=>[row.transaction_id,row.checkout_id,row.permit_id].map(uuidIdentity)));let nodes=0,total=0;
 const scan=(value:any,depth=0,wrappers=0,key=''):void=>{
  if(++nodes>RETIREMENT_SCAN_LIMITS.nodes||depth>64||wrappers>8)retirementFail();
  if(typeof value==='string'){
   if(ids.has(uuidIdentity(value)))throw Error('FISCAL_WORKFLOW_RETIREMENT_FENCED');
   if(['document','original','producerInput','configuration','item','body','requestBody','expectedDocument','declarationBody','capture'].includes(key))scan(decode(value),0,wrappers+1);
   else if(typedOriginalText(value)){retirementFail();
   }else if(['submissionBody','packetJson','requestJson','sourceExpected'].includes(key)){let parsed;try{parsed=JSON.parse(value);}catch{return retirementFail();}scan(parsed,0,wrappers+1);}
  }else if(value&&typeof value==='object')Object.entries(value).forEach(([key,v])=>scan(v,depth+1,wrappers,key));
 };
 const decode=(text:string)=>{if(typeof text!=='string'||new TextEncoder().encode(text).length>RETIREMENT_SCAN_LIMITS.decodedBytes)retirementFail();try{return decodeOriginal(text);}catch{return retirementFail();}};
 if(promoted.length>RETIREMENT_SCAN_LIMITS.rows)retirementFail();
 for(const mutation of promoted){
  const r=mutation.recoveryOriginal!;if(r.encoding!=='pos.original.typed-json.v1'||r.version!==1||typeof r.bodyBase64!=='string'||r.bodyBase64.length>RETIREMENT_SCAN_LIMITS.encodedBytes)retirementFail();
  let bytes:Uint8Array;try{bytes=decodeBase64(r.bodyBase64);}catch{return retirementFail();}total+=bytes.length;
  if(bytes.length!==r.byteLength||total>RETIREMENT_SCAN_LIMITS.totalBytes||await originalDigest(bytes)!==r.bodySha256)retirementFail();
  let envelope:any;try{envelope=decode(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return retirementFail();}
  if(envelope?.version!==1||CAPTURE_COLLECTIONS[envelope.collection]!==r.kind||typeof envelope.document!=='string'||typeof envelope.original!=='string'||Object.keys(envelope).some(k=>!['version','collection','document','original','originalStage','producerInput','configuration','transport','closeCommitId'].includes(k)))retirementFail();
  scan(envelope);for(const key of ['document','original','producerInput','configuration'])if(envelope[key]!==undefined)scan(decode(envelope[key]));
  if(envelope.transport!==undefined){const t=envelope.transport;if(t?.version!==1||!['/api/sync/transactions','/api/sync/cash/movements'].includes(t.route)||typeof t.item!=='string')retirementFail();scan(decode(t.item));}
 }
}
