import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {createHash} from 'node:crypto';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {COMPANY_DISPATCH_ESCROW_SCHEMA} from '../services/db/CompanyDispatchEscrowStore';
import {DISPATCH_OPERATOR_AUTH_SCHEMA,authenticateDispatchOperator,retireDispatchOperatorAuthenticationMaterial} from '../services/dispatch/DispatchOperatorAuthentication';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
function fixture(policy={schemaVersion:1,maxUserFailures:2,maxDeviceFailures:4,windowMilliseconds:1000,recovery:'AUTHENTICATED_SERVER_COOLDOWN'}){
 const directory=mkdtempSync(join(tmpdir(),'clic-dispatch-auth-')),file=join(directory,'own.sqlite');let db=new DatabaseSync(file);db.exec(COMPANY_DISPATCH_ESCROW_SCHEMA+DISPATCH_OPERATOR_AUTH_SCHEMA);
 db.exec("INSERT INTO pos_dispatch_pool_v1 VALUES('pool','binding','generation',1,'WAREHOUSE_DISPATCH',NULL,NULL);INSERT INTO pos_dispatch_precharge_v1(checkout_id,pool_id,transaction_id,demand_digest,source_json,phase)VALUES('checkout','pool','transaction','digest','{\"items\":[{\"id\":\"item\",\"quantity\":1}],\"companyDispatchSource\":{\"operatorAuthorityId\":\"grant\"}}','PREPARED')");
 const sql={query:async(q:string,v:any[]=[])=>({values:db.prepare(q).all(...v) as any[]}),run:async(q:string,v:any[]=[],transaction?:boolean)=>{assert.equal(transaction,false);return db.prepare(q).run(...v);}};
 const grants=new Map<string,{publicHash:string;privateHash:string}>();
 const install=(id='grant')=>{const scope={bindingId:'binding',generation:'generation',deviceId:'device'},users=[['user','9073'],['supervisor','6184']];
  const authority={publicPolicy:{schemaVersion:1,source:'ERP_DISPATCH_OPERATOR_AUTHORITY_V1',id,scope,issuedAt:new Date(0).toISOString(),validUntil:'2027-01-01T00:00:00Z',authenticationPolicy:policy,operators:users.map(([userId])=>({userId,erpPosUserId:'erp-'+userId,roleId:'CASHIER',roleVersion:1,permissions:['POS_DISCOUNT'],userOverride:null,limitSource:'ERP_ASSIGNED_ROLE',discountLimit:{kind:'PERCENT',value:10}}))},privateAuthentication:{schemaVersion:1,source:'ERP_DISPATCH_PIN_VERIFIERS_V1',authorityId:id,verifiers:users.map(([userId,pin])=>({userId,algorithm:'DISPATCH_PIN_SHA256_SALTED_V1',salt:'a'.repeat(64),verifier:hash(JSON.stringify(['DISPATCH_PIN_SHA256_SALTED_V1','binding','generation',userId,'a'.repeat(64),pin]))}))}};
  const raw=JSON.stringify(authority.publicPolicy),privateRaw=JSON.stringify(authority.privateAuthentication),digest=hash(raw),privateDigest=hash(privateRaw);grants.set(id,{publicHash:digest,privateHash:privateDigest});db.prepare('INSERT INTO pos_dispatch_operator_authority_v1 VALUES(?,?,?,?,?,?,?)').run(id,'pool',raw,digest,privateDigest,'synthetic-external-witness','ACTIVE');db.prepare('INSERT INTO pos_dispatch_operator_auth_material_v1 VALUES(?,?)').run(id,privateRaw);if(id!=='grant')db.prepare("INSERT INTO pos_dispatch_precharge_v1(checkout_id,pool_id,transaction_id,demand_digest,source_json,phase)VALUES(?,'pool',?,'digest',?,'PREPARED')").run('checkout-'+id,'transaction-'+id,JSON.stringify({items:[{id:'item',quantity:1}],companyDispatchSource:{operatorAuthorityId:id}}));
 };
 install();
 const invoke=async({pin='9073',userId='user',authorityId='grant',checkoutId=authorityId==='grant'?'checkout':'checkout-'+authorityId,now=1000,serverObservedAt=0}={})=>{
  db.exec('BEGIN IMMEDIATE');try{const result=await authenticateDispatchOperator(sql,{authorityId,checkoutId,userId,pin},{now,serverObservedAt,verifyWitness:async(digest,privateDigest,witness)=>{assert.equal(digest,grants.get(authorityId)!.publicHash);assert.equal(privateDigest,grants.get(authorityId)!.privateHash);assert.equal(witness,'synthetic-external-witness');}});db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}
 };
 return{invoke,install,retire:async()=>{db.exec('BEGIN IMMEDIATE');try{await retireDispatchOperatorAuthenticationMaterial(sql,'grant');db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}},read:(sql:string)=>db.prepare(sql).all() as any[],exec:(sql:string)=>db.exec(sql),reopen:()=>{db.close();db=new DatabaseSync(file);},close:()=>{db.close();rmSync(directory,{recursive:true,force:true});}};
}
test('wrong PIN commits durable budgets across restart and bundle refresh; local time alone cannot unlock them',async t=>{
 const f=fixture();t.after(()=>f.close());assert.deepEqual(await f.invoke({pin:'0000'}),{ok:false,code:'DISPATCH_OPERATOR_PIN_DENIED'});f.reopen();f.install('refreshed');
 assert.equal(f.read('SELECT failures FROM pos_dispatch_auth_attempt_v1').every(r=>r.failures===1),true);
 assert.deepEqual(await f.invoke({authorityId:'refreshed',pin:'0000',now:1002}),{ok:false,code:'DISPATCH_OPERATOR_PIN_DENIED'});
 assert.deepEqual(await f.invoke({authorityId:'refreshed',now:100000}),{ok:false,code:'DISPATCH_AUTH_SERVER_RECOVERY_REQUIRED'});
 assert.deepEqual(await f.invoke({authorityId:'refreshed',now:1004,serverObservedAt:1004}),{ok:false,code:'DISPATCH_AUTH_SERVER_RECOVERY_REQUIRED'});
 assert.equal(f.read('SELECT count(*) n FROM pos_dispatch_authenticated_operator_v1')[0].n,0);
});
test('global device budget spans operators and local rollback never clears a user budget',async t=>{
 const f=fixture({schemaVersion:1,maxUserFailures:5,maxDeviceFailures:2,windowMilliseconds:1000,recovery:'AUTHENTICATED_SERVER_COOLDOWN'});t.after(()=>f.close());
 await f.invoke({pin:'0000'});await f.invoke({userId:'supervisor',pin:'0000',now:1002});
 assert.deepEqual(await f.invoke({now:1004}),{ok:false,code:'DISPATCH_AUTH_SERVER_RECOVERY_REQUIRED'});
 assert.deepEqual(await f.invoke({now:999}),{ok:false,code:'DISPATCH_AUTH_CLOCK_RECONCILIATION_REQUIRED'});
 assert.equal(f.read('SELECT count(*) n FROM pos_dispatch_authenticated_operator_v1')[0].n,0);
});
test('a paid uncertain checkout retains its exact authentication after grant revocation without reauthentication or release',async t=>{
 const f=fixture();t.after(()=>f.close());const initial=await f.invoke();assert.equal(initial.ok,true);
 await f.retire();assert.equal(f.read('SELECT count(*) n FROM pos_dispatch_operator_auth_material_v1')[0].n,0);f.exec("UPDATE pos_dispatch_precharge_v1 SET phase='EFFECT_POSSIBLE'");
 const recovered=await f.invoke({pin:'0000',now:Date.parse('2028-01-01T00:00:00Z')});assert.deepEqual(recovered,initial);
 assert.equal(f.read('SELECT count(*) n FROM pos_dispatch_auth_attempt_v1 WHERE failures>0')[0].n,0);
 assert.equal(f.read('SELECT phase FROM pos_dispatch_precharge_v1')[0].phase,'EFFECT_POSSIBLE');
});
test('unknown identities and malformed PINs consume the same durable device budget without creating a principal',async t=>{
 const f=fixture({schemaVersion:1,maxUserFailures:5,maxDeviceFailures:2,windowMilliseconds:1000,recovery:'AUTHENTICATED_SERVER_COOLDOWN'});t.after(()=>f.close());
 assert.deepEqual(await f.invoke({userId:'not-issued',pin:'wrong'}),{ok:false,code:'DISPATCH_OPERATOR_PIN_DENIED'});
 assert.deepEqual(await f.invoke({userId:'other-not-issued',pin:'0000',now:1001}),{ok:false,code:'DISPATCH_OPERATOR_PIN_DENIED'});
 assert.deepEqual(await f.invoke({now:1002}),{ok:false,code:'DISPATCH_AUTH_SERVER_RECOVERY_REQUIRED'});
 assert.equal(f.read('SELECT count(*) n FROM pos_dispatch_authenticated_operator_v1')[0].n,0);
});
test('the emitted V1 defaults deny the sixth user attempt and the twenty-first device attempt, including a correct PIN',async t=>{
 const defaults={schemaVersion:1,maxUserFailures:5,maxDeviceFailures:20,windowMilliseconds:300000,recovery:'AUTHENTICATED_SERVER_COOLDOWN'};
 const user=fixture(defaults),device=fixture(defaults);t.after(()=>{user.close();device.close();});
 for(let n=0;n<5;n++)assert.deepEqual(await user.invoke({pin:'0000',now:1000+n}),{ok:false,code:'DISPATCH_OPERATOR_PIN_DENIED'});
 assert.deepEqual(await user.invoke({now:1005}),{ok:false,code:'DISPATCH_AUTH_SERVER_RECOVERY_REQUIRED'});
 for(let n=0;n<20;n++)assert.deepEqual(await device.invoke({userId:'unknown-'+n,pin:'0000',now:1000+n}),{ok:false,code:'DISPATCH_OPERATOR_PIN_DENIED'});
 assert.deepEqual(await device.invoke({now:1020}),{ok:false,code:'DISPATCH_AUTH_SERVER_RECOVERY_REQUIRED'});
});
test('another valid issued grant cannot authenticate an intent that retained a different operator authority',async t=>{
 const f=fixture();t.after(()=>f.close());f.install('other');
 await assert.rejects(f.invoke({authorityId:'other',checkoutId:'checkout'}),/CHECKOUT_AUTHORITY_CONFLICT/);
 assert.equal(f.read('SELECT count(*) n FROM pos_dispatch_authenticated_operator_v1')[0].n,0);
 assert.equal(f.read("SELECT phase FROM pos_dispatch_precharge_v1 WHERE checkout_id='checkout'")[0].phase,'PREPARED');
});
