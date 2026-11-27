import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {drainPendingOfflineFiscalPush} from '../services/sync/OfflineFiscalPushDrain';

const source=(relative:string)=>readFileSync(new URL(`../${relative}`,import.meta.url),'utf8');

test('C1 pending offline sales are drained in order before reauthorization (bounded, one send per progress)',async()=>{
 let pending=2;const sends:number[]=[];
 const result=await drainPendingOfflineFiscalPush({
  count:async()=>pending,
  sendNext:async()=>{sends.push(pending);pending-=1;},
  sleep:async()=>{},
 });
 assert.deepEqual(result,{pending:0,drained:true,attempts:2});
 assert.deepEqual(sends,[2,1],'each pass sends the remaining queue exactly once');
});

test('C1 no progress stops after one pass: no infinite retry loop and no duplicate push',async()=>{
 let pending=3;const sends:number[]=[];
 const result=await drainPendingOfflineFiscalPush({
  count:async()=>pending,
  sendNext:async()=>{sends.push(pending);},
  sleep:async()=>{},
 });
 assert.equal(result.drained,false);
 assert.equal(result.pending,3);
 assert.equal(result.attempts,1,'a pass that does not reduce the queue is not repeated');
 assert.deepEqual(sends,[3],'the same events are never re-sent in this pass');
});

test('C1 an empty outbox proceeds immediately without sending anything',async()=>{
 const sends:number[]=[];
 const result=await drainPendingOfflineFiscalPush({count:async()=>0,sendNext:async()=>{sends.push(1);},sleep:async()=>{}});
 assert.deepEqual(result,{pending:0,drained:true,attempts:0});
 assert.deepEqual(sends,[]);
});

test('C1 the drain is capped even when the queue keeps shrinking (bounded attempts)',async()=>{
 let pending=10;
 const result=await drainPendingOfflineFiscalPush({
  count:async()=>pending,
  sendNext:async()=>{pending-=1;},
  sleep:async()=>{},
  maxAttempts:99,
 });
 assert.equal(result.attempts,3,'maxAttempts is clamped to 3');
 assert.equal(result.drained,false);
 assert.equal(result.pending,7);
});

test('C1 repair: reauthorization drains the offline outbox before register and exposes the reason when it cannot',()=>{
 const reauth=source('services/sync/TerminalReauthorizationService.ts');
 const drainIndex=reauth.indexOf('drainPendingOfflineFiscalPush(');
 const registerIndex=reauth.indexOf('registerErpSyncTerminal(');
 assert.ok(drainIndex>0&&registerIndex>0,'both the drain and the register exist');
 assert.ok(drainIndex<registerIndex,'the outbox is prioritized before the terminal re-registration');
 assert.match(reauth,/countPendingOfflineFiscalPush\(\)/);
 assert.match(reauth,/renewTerminalSession\(\)\.catch/,'only the session is renewed while draining');
 assert.match(reauth,/deferred: true/);
 assert.match(reauth,/pendingPushEvents: pendingPush/);
 assert.match(reauth,/NO se rota la autoridad fiscal/);
 assert.match(source('services/sync/BootReconciliation.ts'),/Reautorización diferida/);
});

test('C1 repair: the outbox query only counts unacknowledged offline fiscal events',()=>{
 const repository=source('services/sync/DurableOutboxRepository.ts');
 assert.match(repository,/async pendingOfflineFiscalSales\(\)/);
 assert.match(repository,/WHERE status IN \('PENDING','SENDING','RETRY_WAIT'\)/);
 assert.match(repository,/event_type IN \('SALE_POSTED','PAYMENT_POSTED'\)/);
 assert.match(repository,/payload_json LIKE '%fiscalWorkflowBirth%'/);
});

test('C1 repair: refill rotation only reacts to explicit rotation signals and retries once with backoff',()=>{
 const client=source('services/fiscal/FiscalWorkflowV2Client.ts');
 assert.match(client,/FISCAL_OFFLINE_LEASE_OPERATION_REUSED/);
 assert.match(client,/REFILL_ROTATION_CODES/);
 assert.match(client,/const REFILL_ROTATION_DELAY_MS=250/);
 assert.equal((client.match(/rotateRefillOperation\(operationKey\)/g)||[]).length,1,'the operation rotates once before the single retry');
 assert.match(client,/PREPARATION_RETRY_REQUIRED/,'the 409 is an actionable readiness state');
 const policy=source('services/fiscal/OfflineFiscalFailurePolicy.ts');
 assert.match(policy,/PREPARATION_RETRY_REQUIRED/);
});
