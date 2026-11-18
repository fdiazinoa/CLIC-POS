import test from 'node:test';
import assert from 'node:assert/strict';
import { isAuditContextMissing,isAuditContextBlocked } from '../services/sync/AuditContextRetry';
import { canRetryPendingSyncQueue,type PendingSyncDocument } from '../services/sync/PendingSyncDocuments';
const body='{"status":"error","code":"ERP_CONTEXT_MISSING"}';
const legacy=`Operational sync failed: 409 Conflict — ${body}`;

for(const collection of ['posAuditEvents','invoiceAuditEvents'])test(`exact context classifier admits only bounded authorized formats in ${collection}`,()=>{
 for(const error of [legacy,`Operational sync failed after re-auth: 409 Conflict — ${body}`,`Operational sync failed: 409  — ${body}`,'ERP_CONTEXT_MISSING',new Error(legacy),Object.assign(new Error('request rejected'),{httpStatus:409,responseBody:body}),{httpStatus:409,responseBody:{code:'ERP_CONTEXT_MISSING'}}])assert.equal(isAuditContextMissing(collection,error),true,String(error));
 for(const error of ['prefix '+legacy,legacy+' extra','ERP_CONTEXT_MISSING_OTHER','error ERP_CONTEXT_MISSING',`Operational sync failed: 403 Forbidden — ${body}`,`Operational sync failed: 409 Conflict — {"error":{"code":"ERP_CONTEXT_MISSING"}}`,`Operational sync failed: 409 Conflict — {"code":"ERP_CONTEXT_MISSING"`,`Operational sync failed: 409 Conflict — {"code":"POS_AUDIT_REPLAY_CONFLICT","message":"ERP_CONTEXT_MISSING"}`,{httpStatus:400,responseBody:{code:'ERP_CONTEXT_MISSING'},message:'ERP_CONTEXT_MISSING'},{httpStatus:409,responseBody:'truncated ERP_CONTEXT_MISSING',message:legacy},{httpStatus:403,message:legacy},{code:'ERP_CONTEXT_MISSING'},{message:legacy},{httpStatus:'409',responseBody:body}])assert.equal(isAuditContextMissing(collection,error),false,JSON.stringify(error));
});

test('only dedicated blocked audit rows qualify; conflicting reasons fail closed',()=>{
 for(const collection of ['transactions','inventoryLedger','cashMovements','sync_outbox_v2','customerMutations'])assert.equal(isAuditContextMissing(collection,legacy),false);
 for(const status of ['APPLIED_ERP','SYNCED_CLOUD','SYNCED_MASTER','FAILED_FINAL','ERROR','PENDING'])assert.equal(isAuditContextBlocked('posAuditEvents',{syncStatus:status,syncError:legacy}),false);
 assert.equal(isAuditContextBlocked('posAuditEvents',{syncStatus:'BLOCKED_FUNCTIONAL',syncBlockedReason:legacy,syncError:legacy}),true);
 assert.equal(isAuditContextBlocked('posAuditEvents',{syncStatus:'BLOCKED_FUNCTIONAL',syncBlockedReason:'POS_AUDIT_REPLAY_CONFLICT',syncError:legacy}),false);
 assert.equal(isAuditContextBlocked('invoiceAuditEvents',{syncStatus:'BLOCKED_FUNCTIONAL',syncError:'ERP_CONTEXT_MISSING'}),true);
});

test('modal retry recognizes exact historical context while all other functional blocks remain disabled',()=>{
 const base:PendingSyncDocument={source:'posAuditEvents',id:'original',reference:'original',kind:'AUTHORIZATION',date:'2026',terminal:'Master-01',amount:null,status:'BLOCKED_FUNCTIONAL',attempts:1,reason:legacy};
 assert.equal(canRetryPendingSyncQueue(base),true);assert.equal(canRetryPendingSyncQueue({...base,source:'invoiceAuditEvents'}),true);
 for(const row of [{...base,source:'transactions'},{...base,reason:'409 Conflict'},{...base,reason:'POS_AUDIT_REPLAY_CONFLICT'},{...base,reason:legacy+' truncated'}])assert.equal(canRetryPendingSyncQueue(row),false);
});
