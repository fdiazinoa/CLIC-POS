// Read-only paired-source contract check. Producer tests must export ORIGINAL native SALE_POSTED wire.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const [erpDirectory,wireDirectory,expectedErpSha]=process.argv.slice(2);
if(!erpDirectory||!wireDirectory||!expectedErpSha)throw Error('Usage: node assert-allocation-erp-fingerprint.mjs ERP_SOURCE ORIGINAL_WIRE_DIRECTORY ERP_SHA');
const erp=realpathSync(erpDirectory),head=execFileSync('git',['rev-parse','HEAD'],{cwd:erp,encoding:'utf8'}).trim();assert.equal(head,expectedErpSha);
assert.equal(execFileSync('git',['status','--porcelain'],{cwd:erp,encoding:'utf8'}).trim(),'','ERP source must be frozen clean');
const {v3OperationFingerprint,expectedV3PaymentSummary,same}=await import(pathToFileURL(path.join(erp,'server/services/fiscal/posFiscalV3Source.js')).href);
const files=readdirSync(wireDirectory).filter(name=>/^original-env[012]-old(?:true|false)\.json$/.test(name));assert.equal(files.length,6);
const results=[];
for(const name of files){const file=path.join(wireDirectory,name),bytes=readFileSync(file),wire=JSON.parse(bytes),transaction=wire.transaction;
 assert.equal(wire.fiscalWorkflowBirth.schemaVersion,3);assert.equal(wire.fiscalWorkflowBirth.authorizationKind,'OFFLINE_FISCAL_ALLOCATION_V2');
 assert.equal(transaction.v3CommitFingerprint,v3OperationFingerprint(transaction));
 const paymentFile=path.join(wireDirectory,name.replace('original-','payment-')),paymentBytes=readFileSync(paymentFile),paymentWire=JSON.parse(paymentBytes);assert.ok(same(paymentWire.summary,expectedV3PaymentSummary(transaction)));assert.ok(same(paymentWire.payments,transaction.payments));assert.deepEqual(readFileSync(paymentFile),paymentBytes,'PAYMENT reader must not rewrite original committed payload');
 assert.deepEqual([transaction.displayId,transaction.globalSequence,transaction.seriesNumber],['T-000001',1,1]);
 for(const key of ['displayId','globalSequence','seriesNumber']){const changed=structuredClone(transaction);delete changed[key];assert.notEqual(transaction.v3CommitFingerprint,v3OperationFingerprint(changed),`final ${key} must remain authenticated by canonical source`);}
 assert.deepEqual(readFileSync(file),bytes,'reader must not rewrite original committed source');
 results.push({file:name,sha256:createHash('sha256').update(bytes).digest('hex'),transactionId:transaction.id,ncf:transaction.ncf,environment:transaction.fiscalEnvironment,globalSequence:transaction.globalSequence});
}
console.log(JSON.stringify({erpSha:head,originalNativeOutboxCount:files.length*2,finalNumbersRequired:true,results},null,2));
