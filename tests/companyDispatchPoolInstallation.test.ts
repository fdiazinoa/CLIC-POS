import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeFixture,id} from './articleFormatsNativeFixture';
import {installNativeDispatchPool} from '../services/dispatch/DispatchPoolInstallation';
import {dispatchPoolId,type DispatchPoolSnapshot} from '../services/db/CompanyDispatchPool';
const snapshot=():DispatchPoolSnapshot=>({contractVersion:1,policy:{tenant_id:id(1),company_id:id(2),effective_mode:'IMMEDIATE',target_mode:'WAREHOUSE_DISPATCH',phase:'PREPARING',revision:1,transition_id:id(210)},binding:{id:id(211),tenant_id:id(1),company_id:id(2),store_id:id(3),terminal_id:id(4),device_id:id(50),generation:id(212),accepted_sequence:0,native_schema_hash:null},barrier:{id:id(213),nonce:id(214),state:'REQUIRED',transition_id:id(210),proof:null},readiness:{historicalUniverseComplete:true}});
async function setup(){const f=await nativeFixture();const prefs=new Map<string,string>();const port={readLocal:(binding:string,generation:string)=>f.adapter.readDispatchPoolInstallation(binding,generation),readWitness:async(key:string)=>prefs.get(key)??null,writeWitness:async(key:string,value:string)=>{prefs.set(key,value);},install:(...args:Parameters<typeof f.adapter.installDispatchPoolSnapshot>)=>f.adapter.installDispatchPoolSnapshot(...args)};return{...f,prefs,port,hash:await f.adapter.dispatchNativeSchemaHash()};}
test('native pool stages FROZEN+zero cursor together; barrier ACK cannot enable funds until the server policy is installed',async t=>{
 const f=await setup();t.after(()=>f.db.close());const s=snapshot(),pool=await installNativeDispatchPool(s,f.hash,f.port);assert.equal(pool,dispatchPoolId(s.binding));assert.equal((f.db.prepare('SELECT state FROM pos_dispatch_pool_v1').get() as {state:string}).state,'FROZEN');assert.equal((f.db.prepare('SELECT last_sequence n FROM pos_dispatch_capture_cursor_v1').get() as {n:number}).n,0);
 const proof=await f.adapter.prepareDispatchBarrierProof(s);assert.equal(proof.nativeState,'FROZEN');assert.match(String(proof.nativePoolWitnessHash),/^[a-f0-9]{64}$/);
 s.barrier!.proof=proof;s.barrier!.state='DRAINED';await installNativeDispatchPool(s,f.hash,f.port);assert.equal((f.db.prepare('SELECT state FROM pos_dispatch_pool_v1').get() as {state:string}).state,'FROZEN');
 s.policy.phase='STABLE';s.policy.effective_mode='WAREHOUSE_DISPATCH';s.policy.revision=2;s.binding.native_schema_hash=f.hash;await installNativeDispatchPool(s,f.hash,f.port);assert.equal((f.db.prepare('SELECT state FROM pos_dispatch_pool_v1').get() as {state:string}).state,'WAREHOUSE_DISPATCH');
 await installNativeDispatchPool(s,f.hash,f.port);assert.equal((f.db.prepare('SELECT last_sequence n FROM pos_dispatch_capture_cursor_v1').get() as {n:number}).n,0);
});
test('server sequence or a retained witness never authorizes reconstructing a blank local pool',async t=>{
 const f=await setup();t.after(()=>f.db.close());const s=snapshot();s.binding.accepted_sequence=1;await assert.rejects(installNativeDispatchPool(s,f.hash,f.port),/POOL_RECONCILIATION_REQUIRED/);assert.equal(f.prefs.size,0);
 s.binding.accepted_sequence=0;await installNativeDispatchPool(s,f.hash,f.port);
 const lost=await setup();t.after(()=>lost.db.close());for(const [key,value] of f.prefs)lost.prefs.set(key,value);
 await assert.rejects(installNativeDispatchPool(s,lost.hash,lost.port),/POOL_RECONCILIATION_REQUIRED/);assert.equal((lost.db.prepare('SELECT count(*) n FROM pos_dispatch_pool_v1').get() as {n:number}).n,0);
});
test('a staging fault rolls pool+cursor+active owner back and keeps external ownership fenced for reconciliation',async t=>{
 const f=await setup();t.after(()=>f.db.close());f.db.exec("CREATE TRIGGER fail_pool_cursor BEFORE INSERT ON pos_dispatch_capture_cursor_v1 BEGIN SELECT RAISE(ABORT,'SYNTHETIC_CURSOR_FAULT');END");
 await assert.rejects(installNativeDispatchPool(snapshot(),f.hash,f.port),/SYNTHETIC_CURSOR_FAULT/);assert.equal(f.prefs.size,1);for(const table of ['pos_dispatch_pool_v1','pos_dispatch_pool_install_v1','pos_dispatch_capture_cursor_v1','pos_dispatch_active_pool_v1'])assert.equal((f.db.prepare(`SELECT count(*) n FROM ${table}`).get() as {n:number}).n,0);
 f.db.exec('DROP TRIGGER fail_pool_cursor');await assert.rejects(installNativeDispatchPool(snapshot(),f.hash,f.port),/POOL_RECONCILIATION_REQUIRED/);
});
test('foreign config scope, unknown historical universe and premature STABLE policy never install an operational pool',async t=>{
 for(const change of [(s:DispatchPoolSnapshot)=>{s.binding.company_id=id(220);s.policy.company_id=id(220);},(s:DispatchPoolSnapshot)=>{s.readiness.historicalUniverseComplete=false;},(s:DispatchPoolSnapshot)=>{s.policy.phase='STABLE';s.policy.effective_mode='WAREHOUSE_DISPATCH';}]){const f=await setup();t.after(()=>f.db.close());const s=snapshot();change(s);await assert.rejects(installNativeDispatchPool(s,f.hash,f.port),/POOL_/);assert.equal((f.db.prepare('SELECT count(*) n FROM pos_dispatch_pool_v1').get() as {n:number}).n,0);}
});
test('barrier proof denies pending or unknown economic sources even if browser JSON claims inventory applied',async t=>{
 const f=await setup();t.after(()=>f.db.close());const s=snapshot();await installNativeDispatchPool(s,f.hash,f.port);
 await f.adapter.saveDocument('transactions',{id:id(225),terminalId:id(4),metadata:{inventory_applied:true,accounting_applied:true}});await assert.rejects(f.adapter.prepareDispatchBarrierProof(s),/LEGACY_RECONCILIATION_REQUIRED/);
 const g=await setup();t.after(()=>g.db.close());await installNativeDispatchPool(s,g.hash,g.port);g.db.prepare("INSERT INTO sync_outbox_v2(event_id,event_type,aggregate_type,aggregate_id,schema_version,payload_json,created_at,updated_at)VALUES(?,'SALE_POSTED','TRANSACTION',?,1,'{}','fixture','fixture')").run(id(226),id(227));await assert.rejects(g.adapter.prepareDispatchBarrierProof(s),/EFFECTS_PENDING/);
});
test('production synchronizer stages a barrier, keeps it fenced after ACK, then installs a delivered quota only after STABLE',async t=>{
 const f=await setup();t.after(()=>f.db.close());const {synchronizeNativeCompanyDispatch}=await import('../services/dispatch/CompanyDispatchRuntime');const {canonicalDispatchJSON}=await import('../services/db/CompanyDispatchEscrowStore');
 const s={...snapshot(),rows:[] as any[],snapshotSequence:0,nextSequence:0,hasMore:false};const calls:string[]=[];let authority:any;
 const witness={readWitness:f.port.readWitness,writeWitness:f.port.writeWitness};
 const transport={request:async(_path:string,init:any)=>{
  if(init.method==='GET')return{status:200,headers:{},text:JSON.stringify(s)};
  calls.push(init.body.action);
  if(init.body.action==='acceptBarrier'){assert.equal(init.body.proof.nativeState,'FROZEN');assert.equal((f.db.prepare('SELECT state FROM pos_dispatch_pool_v1').get() as {state:string}).state,'FROZEN');s.barrier!.proof=init.body.proof;s.barrier!.state='DRAINED';return{status:200,headers:{},text:JSON.stringify({barrierId:s.barrier!.id,state:'DRAINED',generation:s.binding.generation})};}
  if(init.body.action==='claimQuota'){assert.equal(await f.adapter.readDispatchQuota(authority.id),null);return{status:200,headers:{},text:JSON.stringify({quotaId:authority.id,authorityHash:authority.authorityHash,witnessHash:init.body.witnessHash,firstInstallationAllowed:true})};}
  assert.equal(init.body.action,'ackQuotaInstalled');assert.equal((await f.adapter.readDispatchQuota(authority.id))!.availableMinor,1000000);return{status:200,headers:{},text:JSON.stringify({quotaId:authority.id,authorityHash:authority.authorityHash,installed:true,generation:s.binding.generation})};
 }};
 const install=(value:DispatchPoolSnapshot,hash:string)=>installNativeDispatchPool(value,hash,f.port);
 assert.deepEqual(await synchronizeNativeCompanyDispatch(transport,f.adapter,install,witness),{state:'FROZEN',installedQuotas:0});assert.deepEqual(calls,['acceptBarrier']);
 s.policy.phase='STABLE';s.policy.effective_mode='WAREHOUSE_DISPATCH';s.policy.revision=2;s.binding.native_schema_hash=f.hash;
 const master={id:id(7),tenant_id:id(1),company_id:id(2),type:'PRODUCT',metadata:{}};
 const plain={contractVersion:1,kind:'COMPANY_DISPATCH_QUOTA',id:id(230),scope:{tenantId:id(1),companyId:id(2),storeId:id(3),warehouseId:id(5),localId:id(5),terminalId:id(4),deviceId:id(50),bindingId:s.binding.id,generation:s.binding.generation},itemId:id(7),dimensions:{},grantedMinor:1000000,policyRevision:2,issuedSequence:1,inventoryEffectsContract:'WAREHOUSE_RESERVATION_V1',catalogSource:{schemaVersion:1,discriminator:'COMPANY_DISPATCH_CATALOG_SOURCE_V1',stockItem:master,commercialItem:master,rawGraph:[master],tariffs:[],taxes:[]}};
 const canonical=canonicalDispatchJSON(plain),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical))),n=>n.toString(16).padStart(2,'0')).join('');authority={...plain,authorityHash:hash,authorityCanonical:canonical,digestVersion:'DISPATCH_JSONB_CANONICAL_UTF8_V1'};
 s.rows=[{delivery:authority,delivered:false,witnessHash:null}];s.snapshotSequence=1;s.nextSequence=1;
 assert.deepEqual(await synchronizeNativeCompanyDispatch(transport,f.adapter,install,witness),{state:'WAREHOUSE_DISPATCH',installedQuotas:1});assert.deepEqual(calls,['acceptBarrier','claimQuota','ackQuotaInstalled']);assert.equal(await f.adapter.readDispatchActivePoolState(),'WAREHOUSE_DISPATCH');assert.equal((f.db.prepare('SELECT last_sequence n FROM pos_dispatch_capture_cursor_v1').get() as {n:number}).n,0);
});

test('late STABLE rev2 cannot undo a newer rev3 freeze; same-revision rekeys/phase/mode also conflict',async t=>{
 const f=await setup();t.after(()=>f.db.close());const first=snapshot();await installNativeDispatchPool(first,f.hash,f.port);const proof=await f.adapter.prepareDispatchBarrierProof(first);
 const stable=structuredClone(first);stable.policy={...stable.policy,phase:'STABLE',effective_mode:'WAREHOUSE_DISPATCH',revision:2};stable.barrier!.state='DRAINED';stable.barrier!.proof=proof;stable.binding.native_schema_hash=f.hash;await installNativeDispatchPool(stable,f.hash,f.port);
 const frozen=structuredClone(stable);frozen.policy={...frozen.policy,phase:'PREPARING',revision:3,transition_id:id(240)};frozen.barrier={id:id(241),nonce:id(242),state:'REQUIRED',transition_id:id(240),proof:null};await installNativeDispatchPool(frozen,f.hash,f.port);
 for(const late of [stable,{...frozen,policy:{...frozen.policy,phase:'STABLE'}},{...frozen,policy:{...frozen.policy,target_mode:'IMMEDIATE'}},{...frozen,barrier:{...frozen.barrier,id:id(243)}}]){
  await assert.rejects(installNativeDispatchPool(late,f.hash,f.port),/POOL_POLICY_REVISION_CONFLICT/);assert.equal(await f.adapter.readDispatchActivePoolState(),'FROZEN');assert.equal((f.db.prepare('SELECT policy_revision FROM pos_dispatch_pool_v1').get() as {policy_revision:number}).policy_revision,3);
 }
 await installNativeDispatchPool(frozen,f.hash,f.port);assert.equal(await f.adapter.readDispatchActivePoolState(),'FROZEN');
 const nextGeneration=structuredClone(frozen);nextGeneration.binding.id=id(245);nextGeneration.binding.generation=id(246);nextGeneration.policy.revision=4;nextGeneration.policy.transition_id=id(247);nextGeneration.barrier={id:id(248),nonce:id(249),state:'REQUIRED',transition_id:id(247),proof:null};
 await installNativeDispatchPool(nextGeneration,f.hash,f.port);await assert.rejects(installNativeDispatchPool(frozen,f.hash,f.port),/POOL_POLICY_REVISION_CONFLICT|POOL_GENERATION_SUPERSEDED/);assert.equal((f.db.prepare('SELECT pool_id FROM pos_dispatch_active_pool_v1').get() as {pool_id:string}).pool_id,dispatchPoolId(nextGeneration.binding));
 assert.throws(()=>f.db.prepare('UPDATE pos_dispatch_policy_snapshot_v1 SET revision=2').run(),/POLICY_REVISION_CONFLICT/);
});

test('a superseded generation cannot reclaim the active slot at the same company policy revision',async t=>{
 const f=await setup();t.after(()=>f.db.close());const a=snapshot();await installNativeDispatchPool(a,f.hash,f.port);
 const b=structuredClone(a);b.binding.id=id(250);b.binding.generation=id(251);b.barrier={id:id(252),nonce:id(253),state:'REQUIRED',transition_id:b.policy.transition_id!,proof:null};await installNativeDispatchPool(b,f.hash,f.port);
 await assert.rejects(installNativeDispatchPool(a,f.hash,f.port),/POOL_GENERATION_SUPERSEDED/);
 assert.equal((f.db.prepare('SELECT pool_id FROM pos_dispatch_active_pool_v1').get() as {pool_id:string}).pool_id,dispatchPoolId(b.binding));assert.equal(await f.adapter.readDispatchActivePoolState(),'FROZEN');assert.equal((f.db.prepare('SELECT successor_pool_id FROM pos_dispatch_superseded_pool_v1').get() as {successor_pool_id:string}).successor_pool_id,dispatchPoolId(b.binding));
 await installNativeDispatchPool(b,f.hash,f.port);assert.throws(()=>f.db.exec('DELETE FROM pos_dispatch_superseded_pool_v1'),/SUPERSEDED_POOL_DURABLE/);
});
