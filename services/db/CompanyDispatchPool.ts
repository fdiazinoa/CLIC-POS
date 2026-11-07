import {canonicalDispatchJSON,type DispatchSQL} from './CompanyDispatchEscrowStore';
export type DispatchPoolSnapshot={contractVersion:1;policy:{tenant_id?:string;company_id?:string;effective_mode:string;target_mode:string;phase:string;revision:number;transition_id?:string};binding:{id:string;tenant_id:string;company_id:string;store_id:string;terminal_id:string;device_id:string;generation:string;accepted_sequence:number;native_schema_hash:string|null};barrier:null|{id:string;nonce:string;state:string;transition_id:string;proof:Record<string,unknown>|null};readiness:{historicalUniverseComplete:boolean}};
export const DISPATCH_POOL_INSTALL_SCHEMA=`
CREATE TABLE IF NOT EXISTS pos_dispatch_pool_install_v1(pool_id TEXT PRIMARY KEY REFERENCES pos_dispatch_pool_v1(pool_id),native_binding TEXT NOT NULL,witness_hash TEXT NOT NULL,native_schema_hash TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS dispatch_pool_install_immutable BEFORE UPDATE ON pos_dispatch_pool_install_v1 BEGIN SELECT RAISE(ABORT,'DISPATCH_POOL_INSTALL_IMMUTABLE');END;
CREATE TRIGGER IF NOT EXISTS dispatch_pool_install_durable BEFORE DELETE ON pos_dispatch_pool_install_v1 BEGIN SELECT RAISE(ABORT,'DISPATCH_POOL_INSTALL_DURABLE');END;
`;
export const dispatchPoolId=(binding:{id:string;generation:string})=>binding.id+':'+binding.generation;
const fail=(code:string):never=>{throw Error(code);};
/** Runs under the same native writer queue/transaction as financial capture.
 * Initial state is always FROZEN. A status response cannot grant a blank DB the
 * cursor/consumption that used to belong to this generation. */
export async function installDispatchPoolSnapshot(sql:DispatchSQL,snapshot:DispatchPoolSnapshot,witnessHash:string,nativeSchemaHash:string,previouslySeen:boolean):Promise<string>{
 const b=snapshot?.binding,p=snapshot?.policy,barrier=snapshot?.barrier;
 if(snapshot?.contractVersion!==1||!b?.id||!b.generation||!Number.isSafeInteger(b.accepted_sequence)||b.accepted_sequence<0||!p||!Number.isSafeInteger(p.revision)||p.revision<1||p.tenant_id!==b.tenant_id||p.company_id!==b.company_id||!/^[a-f0-9]{64}$/.test(witnessHash)||!/^[a-f0-9]{64}$/.test(nativeSchemaHash))fail('DISPATCH_POOL_SNAPSHOT_INVALID');
 const owner=(await sql.query('SELECT binding FROM master_v3_operational_owner WHERE singleton=1')).values?.[0];
 let native:unknown;try{native=JSON.parse(String(owner?.binding));}catch{fail('DISPATCH_POOL_NATIVE_OWNER_REQUIRED');}
 if(!Array.isArray(native)||native[0]!==b.tenant_id||native[1]!==b.terminal_id||native[2]!==b.device_id)fail('DISPATCH_POOL_NATIVE_OWNER_REQUIRED');
 const configurations=(await sql.query("SELECT data FROM documents WHERE collection_name='config' AND doc_id NOT IN('_db_initialized','config_metadata')")).values||[];
 const matches=configurations.flatMap(row=>{const config=JSON.parse(String(row.data));return (config.terminals||[]).filter((terminal:any)=>terminal.id===b.terminal_id&&terminal.config?.currentDeviceId===b.device_id&&terminal.config?.erpBinding?.tenantId===b.tenant_id&&terminal.config?.erpBinding?.companyId===b.company_id&&terminal.config?.erpBinding?.storeId===b.store_id);});
 if(matches.length!==1)fail('DISPATCH_POOL_CONFIG_SCOPE');
 const poolId=dispatchPoolId(b),old=(await sql.query('SELECT * FROM pos_dispatch_pool_install_v1 WHERE pool_id=?',[poolId])).values?.[0];
 if(old){if(old.native_binding!==owner?.binding||old.witness_hash!==witnessHash||old.native_schema_hash!==nativeSchemaHash)fail('DISPATCH_POOL_OWNERSHIP_CONFLICT');}
 else{
  if(previouslySeen||b.accepted_sequence!==0||barrier?.proof?.nativePoolWitnessHash||p.phase!=='PREPARING'||!barrier||barrier.transition_id!==p.transition_id||snapshot.readiness?.historicalUniverseComplete!==true)fail('DISPATCH_POOL_RECONCILIATION_REQUIRED');
  await sql.run("INSERT INTO pos_dispatch_pool_v1(pool_id,binding_id,generation,policy_revision,state,barrier_id)VALUES(?,?,?,?,'FROZEN',?)",[poolId,b.id,b.generation,p.revision,barrier.id],false);
  await sql.run('INSERT INTO pos_dispatch_pool_install_v1(pool_id,native_binding,witness_hash,native_schema_hash)VALUES(?,?,?,?)',[poolId,owner!.binding,witnessHash,nativeSchemaHash],false);
  await sql.run('INSERT INTO pos_dispatch_capture_cursor_v1(pool_id,last_sequence)VALUES(?,0)',[poolId],false);
 }
 const cursor=(await sql.query('SELECT last_sequence FROM pos_dispatch_capture_cursor_v1 WHERE pool_id=?',[poolId])).values?.[0];
 if(!cursor||!Number.isSafeInteger(Number(cursor.last_sequence))||b.accepted_sequence>Number(cursor.last_sequence))fail('DISPATCH_POOL_CURSOR_RECONCILIATION_REQUIRED');
 const active=(await sql.query('SELECT * FROM pos_dispatch_active_pool_v1 WHERE singleton=1')).values?.[0];
 if(active&&active.pool_id!==poolId){const rights=(await sql.query("SELECT 1 AS held FROM pos_dispatch_precharge_v1 WHERE pool_id=? AND phase IN('PREPARED','EFFECT_POSSIBLE') UNION ALL SELECT 1 FROM pos_dispatch_quota_v1 WHERE pool_id=? AND granted_minor>consumed_minor+returned_minor UNION ALL SELECT 1 FROM pos_dispatch_native_capture_v1 c WHERE c.pool_id=? AND NOT EXISTS(SELECT 1 FROM pos_dispatch_adoption_v1 a WHERE a.event_id=c.event_id) LIMIT 1",[active.pool_id,active.pool_id,active.pool_id])).values||[];if(rights.length)fail('DISPATCH_PREVIOUS_POOL_RIGHTS_UNRESOLVED');}
 let state='FROZEN';
 if(p.phase==='STABLE'){
  if(!barrier||barrier.state!=='DRAINED'||barrier.transition_id!==p.transition_id||barrier.proof?.nativePoolWitnessHash!==witnessHash||barrier.proof?.nativeSchemaHash!==nativeSchemaHash||b.native_schema_hash!==nativeSchemaHash)fail('DISPATCH_POOL_POLICY_INSTALL_PROOF_REQUIRED');
  if(p.effective_mode==='WAREHOUSE_DISPATCH')state='WAREHOUSE_DISPATCH';
  else if(p.effective_mode==='IMMEDIATE'){
   const rights=(await sql.query("SELECT 1 held FROM pos_dispatch_quota_v1 WHERE pool_id=? AND granted_minor>consumed_minor+returned_minor UNION ALL SELECT 1 FROM pos_dispatch_precharge_v1 WHERE pool_id=? AND phase IN('PREPARED','EFFECT_POSSIBLE') LIMIT 1",[poolId,poolId])).values||[];
   if(rights.length)fail('DISPATCH_POOL_DRAIN_RIGHTS_REQUIRED');state='IMMEDIATE';
  }else fail('DISPATCH_POOL_POLICY_INVALID');
 }else if(p.phase!=='PREPARING')fail('DISPATCH_POOL_POLICY_INVALID');
 await sql.run('UPDATE pos_dispatch_pool_v1 SET state=?,policy_revision=?,barrier_id=?,barrier_digest=? WHERE pool_id=?',[state,p.revision,barrier?.id||null,barrier?.proof?canonicalDispatchJSON(barrier.proof):null,poolId],false);
 await sql.run('INSERT INTO pos_dispatch_active_pool_v1(singleton,pool_id,native_binding)VALUES(1,?,?) ON CONFLICT(singleton)DO UPDATE SET pool_id=excluded.pool_id,native_binding=excluded.native_binding',[poolId,owner!.binding],false);
 return poolId;
}

export async function prepareDispatchBarrierProof(sql:DispatchSQL,snapshot:DispatchPoolSnapshot):Promise<Record<string,unknown>>{
 const b=snapshot.binding,poolId=dispatchPoolId(b),pool=(await sql.query('SELECT p.state,p.barrier_id,i.* FROM pos_dispatch_pool_v1 p JOIN pos_dispatch_pool_install_v1 i ON i.pool_id=p.pool_id WHERE p.pool_id=?',[poolId])).values?.[0];
 if(!pool||pool.state!=='FROZEN'||snapshot.policy.phase!=='PREPARING'||!snapshot.barrier||pool.barrier_id!==snapshot.barrier.id||snapshot.readiness.historicalUniverseComplete!==true)fail('DISPATCH_NATIVE_BARRIER_NOT_FROZEN');
 const cursor=Number((await sql.query('SELECT last_sequence FROM pos_dispatch_capture_cursor_v1 WHERE pool_id=?',[poolId])).values?.[0]?.last_sequence);
 if(!Number.isSafeInteger(cursor)||cursor!==b.accepted_sequence)fail('DISPATCH_BARRIER_OUTBOX_NOT_DRAINED');
 const pending=(await sql.query("SELECT 1 pending FROM pos_dispatch_precharge_v1 WHERE pool_id=? AND phase IN('PREPARED','EFFECT_POSSIBLE') UNION ALL SELECT 1 FROM pos_dispatch_native_capture_v1 c WHERE c.pool_id=? AND NOT EXISTS(SELECT 1 FROM pos_dispatch_adoption_v1 a WHERE a.event_id=c.event_id) UNION ALL SELECT 1 FROM sync_outbox_v2 WHERE upper(aggregate_type)='TRANSACTION' AND status<>'APPLIED_ERP' UNION ALL SELECT 1 FROM pos_fiscal_checkouts_v2 WHERE phase IN('PREPARED','EFFECT_POSSIBLE') UNION ALL SELECT 1 FROM pos_tracking_checkout_v1 WHERE phase IN('PREPARED','EFFECT_POSSIBLE') LIMIT 1",[poolId,poolId])).values||[];
 if(pending.length)fail('DISPATCH_BARRIER_EFFECTS_PENDING');
 // Old JSON flags/transport APPLIED do not prove economic completion. The legacy
 // manifest/materialization protocol must reconcile these sources explicitly.
 const unknown=(await sql.query("SELECT 1 unknown_effect FROM documents WHERE collection_name IN('transactions','transactionHistory') AND (json_extract(data,'$.v3Binding')=? OR json_extract(data,'$.terminalId')=?) AND coalesce(json_extract(data,'$.inventoryEffectsContract'),'')<>'WAREHOUSE_RESERVATION_V1' LIMIT 1",[pool.native_binding,b.terminal_id])).values||[];
 if(unknown.length)fail('DISPATCH_BARRIER_LEGACY_RECONCILIATION_REQUIRED');
 return{protocol:'WAREHOUSE_RESERVATION_V1',nativeState:'FROZEN',generation:b.generation,pendingEffects:0,unknownEffects:0,nativeSchemaHash:pool.native_schema_hash,nativePoolWitnessHash:pool.witness_hash,snapshotRevision:snapshot.policy.revision,sourceSequence:cursor,materializedSequence:cursor};
}
