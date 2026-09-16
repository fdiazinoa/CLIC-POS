import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { classify, validateEvidence, safeOutput, ARTIFACT_FIELDS, inspectArtifact } from './workflow-gate.mjs';
const plan = { baseSha: 'base', candidateSha: 'candidate', ...classify(['App.tsx']) };
function fixture() {
  const gates = {};
  for (const name of plan.requiredGates) gates[name] = {
    status: 'PASS', candidateSha: 'candidate', agentId: ['functional','regression','offline'].includes(name) ? 'qa' : name,
    role: ({analysis:'analyst',plan:'plan-approver',review:'reviewer',qa:'qa',performance:'performance',sync:'sync-validator'})[name] || 'qa', artifacts: ['real-log'],
  };
  return {schemaVersion:2, taskId:'task',baseSha:'base',candidateSha:'candidate',implementationAuthors:['developer'],gates};
}
test('shared, deleted, new and unknown functional paths activate all critical gates', () => {
  for (const file of ['types.ts','services/sync/ApiSyncAdapter.ts','native-stubs/android/ClicPOSMasterHttpServer.kt','new/module.ts','package-lock.json']) assert.ok(plan.requiredGates.every(g => classify([file]).requiredGates.includes(g)));
  assert.ok(classify(['native-stubs/android/ClicPOSMasterHttpServer.kt']).requiredGates.includes('device'));
  assert.ok(plan.testFiles.includes('tests/tablePaymentClosureContract.test.ts'));
  assert.ok(plan.testFiles.includes('tests/durableOutboxV2.test.ts'));
});
test('documentation remains nonfunctional but indirect impact can force critical suites', () => {
  assert.equal(classify(['WORKFLOW.md','.codex/agents/qa.toml']).critical,false);
  assert.equal(classify(['docs/change.md'],true).critical,true);
  assert.equal(classify([]).changed,false);
});
test('complete independent evidence passes', () => assert.equal(validateEvidence(plan,fixture(),()=>true).status,'PASS'));
test('FAIL BLOCKED PENDING N/A and missing gates block release', () => {
  for (const status of ['FAIL','BLOCKED','PENDING','N/A',undefined]) { const e=fixture();e.gates.sync.status=status;assert.throws(()=>validateEvidence(plan,e,()=>true)); }
  const e=fixture();delete e.gates.offline;assert.throws(()=>validateEvidence(plan,e,()=>true));
});
test('new SHA and missing artifacts invalidate approvals', () => {
  const e=fixture();e.candidateSha='other';assert.throws(()=>validateEvidence(plan,e,()=>true));
  assert.throws(()=>validateEvidence(plan,fixture(),()=>false));
  const stale=fixture();stale.gates.qa.candidateSha='old';assert.throws(()=>validateEvidence(plan,stale,()=>true));
});
test('self approval, plan self approval and reused review/qa identity are rejected', () => {
  const self=fixture();self.gates.review.agentId='developer';assert.throws(()=>validateEvidence(plan,self,()=>true));
  const p=fixture();p.gates.plan.agentId=p.gates.analysis.agentId;assert.throws(()=>validateEvidence(plan,p,()=>true));
  const same=fixture();same.gates.review.agentId=same.gates.qa.agentId;assert.throws(()=>validateEvidence(plan,same,()=>true));
});
test('additional gates cannot be silently omitted and role must match', () => {
  const e=fixture();e.additionalRequiredGates=['made-up'];assert.throws(()=>validateEvidence(plan,e,()=>true));
  const wrong=fixture();wrong.gates.performance.role='developer';assert.throws(()=>validateEvidence(plan,wrong,()=>true));
  const doc={baseSha:'base',candidateSha:'candidate',...classify(['WORKFLOW.md'])};
  const extra=fixture();extra.additionalRequiredGates=['performance'];delete extra.gates.performance;assert.throws(()=>validateEvidence(doc,extra,()=>true));
});

test('log and report destinations cannot overwrite repository code', () => {
  assert.throws(() => safeOutput(new URL('../../App.tsx', import.meta.url).pathname));
  assert.throws(() => safeOutput(new URL('../agents/new.toml', import.meta.url).pathname));
  assert.ok(safeOutput('/private/tmp/clic-pos-workflow-output.json').endsWith('clic-pos-workflow-output.json'));
});

test('dangling external symlink cannot create new repository code', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workflow-output-'));
  try {
    const link=path.join(dir,'report');
    fs.symlinkSync(new URL('../../workflow-forbidden-new-module.ts',import.meta.url).pathname,link);
    assert.throws(()=>safeOutput(link));
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

const apk={application:'CLIC-POS',filename:'approved.apk',localPath:'/private/tmp/approved.apk',versionName:'1.2.3',versionCode:1400,commitSha:'candidate',buildId:'build-1',buildDate:'2026-09-16T12:00:00Z',sizeBytes:10,sha256:'a'.repeat(64),certificateSha256:'b'.repeat(64),packageName:'com.clicpos.app',buildType:'release',instrumented:false,diagnostic:false,temporary:false};
const inspect=()=>({sizeBytes:10,sha256:'a'.repeat(64)});
function staged() {
  const e=fixture();e.approvedArtifact={...apk};
  const later={build:'release',internalApproval:'orchestrator',internalDeployment:'internal-deploy',internalTesting:'qa',productionApproval:'release',productionRelease:'release'};
  for(const [name,role] of Object.entries(later))e.gates[name]={status:'PASS',candidateSha:'candidate',agentId:name,role,artifacts:['real-log'],artifact:{...apk}};
  Object.assign(e.gates.internalDeployment,{environment:'INTERNAL_TESTING',releaseStatus:'internal_testing',steps:['IDENTIFY','VALIDATE','INSPECT_CURRENT','UPLOAD_NEW','VERIFY_STORAGE','PUBLISH_INTERNAL','VERIFY_DOWNLOAD','CLEANUP'].map(name=>({name,status:name==='CLEANUP'?'RETAINED':'PASS'})),storage:inspect(),download:inspect(),publishedReference:'release-id',previousInspected:true,previousRetainedUntilVerification:true});
  Object.assign(e.gates.productionRelease,{environment:'PRODUCTION',publishedReference:'production-id',download:inspect()});return e;
}
test('risk never LOW for critical domains; governance HIGH and documentation LOW',()=>{
  for(const f of ['components/PaymentModal.tsx','components/TableMap.tsx','components/TicketHistory.tsx','services/db/index.ts','services/auth/AuthLevelService.ts','services/sync/DurableOutboxSchema.ts','android/app/build.gradle'])assert.notEqual(classify([f]).riskLevel,'LOW');
  assert.equal(classify(['docs/architecture/SYSTEM_MAP.md']).riskLevel,'LOW');
  assert.equal(classify(['.codex/scripts/workflow-gate.mjs']).riskLevel,'HIGH');
  assert.equal(classify(['public/favicon.png']).riskLevel,'MEDIUM');
});
test('code and legacy evidence never authorize internal or production',()=>{
  const r=validateEvidence(plan,fixture(),()=>true);assert.equal(r.approvedForProduction,false);assert.equal(r.approvedForInternalTesting,false);assert.equal(r.releaseEligible,false);
  const old=fixture();old.schemaVersion=1;old.gates.sync.role='qa';assert.equal(validateEvidence(plan,old,()=>true).approvedForProduction,false);
  assert.throws(()=>validateEvidence(plan,old,()=>true,'internal',inspect));
});
test('all stages require accumulated predecessors and produce distinct states',()=>{
  const states=['APPROVED_FOR_INTERNAL_TESTING','INTERNAL_TESTING','INTERNAL_TESTING_PASSED','APPROVED_FOR_PRODUCTION','RELEASED'];
  ['internal','deployment','testing','production','released'].forEach((stage,i)=>assert.equal(validateEvidence(plan,staged(),()=>true,stage,inspect).state,states[i]));
  for(const name of ['build','internalApproval','internalDeployment','internalTesting','productionApproval','productionRelease']){const e=staged();delete e.gates[name];assert.throws(()=>validateEvidence(plan,e,()=>true,'released',inspect));}
});
test('every artifact identity field must match every posterior gate',()=>{
  for(const name of ['build','internalApproval','internalDeployment','internalTesting','productionApproval','productionRelease'])for(const field of ARTIFACT_FIELDS){const e=staged();e.gates[name].artifact[field]='different';assert.throws(()=>validateEvidence(plan,e,()=>true,'released',inspect));}
});
test('binary mismatch debug diagnostic instrumented or incomplete manifest aborts',()=>{
  assert.throws(()=>validateEvidence(plan,staged(),()=>true,'internal',()=>({sizeBytes:9,sha256:apk.sha256})));
  assert.throws(()=>validateEvidence(plan,staged(),()=>true,'internal',()=>({sizeBytes:10,sha256:'c'.repeat(64)})));
  for(const field of ['instrumented','diagnostic','temporary']){const e=staged();e.approvedArtifact[field]=true;assert.throws(()=>validateEvidence(plan,e,()=>true,'internal',inspect));}
  const e=staged();e.approvedArtifact.buildType='debug';assert.throws(()=>validateEvidence(plan,e,()=>true,'internal',inspect));
  const missing=staged();delete missing.approvedArtifact.buildId;assert.throws(()=>validateEvidence(plan,missing,()=>true,'internal',inspect));
});
test('wrong download partial upload early cleanup and production channel abort',()=>{
  const bad=staged();bad.gates.internalDeployment.download.sha256='c'.repeat(64);assert.throws(()=>validateEvidence(plan,bad,()=>true,'deployment',inspect));
  const partial=staged();partial.gates.internalDeployment.steps[3].status='BLOCKED';assert.throws(()=>validateEvidence(plan,partial,()=>true,'deployment',inspect));
  const order=staged();order.gates.internalDeployment.steps.reverse();assert.throws(()=>validateEvidence(plan,order,()=>true,'deployment',inspect));
  const prod=staged();prod.gates.internalDeployment.releaseStatus='available';assert.throws(()=>validateEvidence(plan,prod,()=>true,'deployment',inspect));
});
test('deploy/testing/build/production cannot approve their own preceding work',()=>{
  for(const [target,source] of [['internalApproval','build'],['internalDeployment','internalApproval'],['internalTesting','internalDeployment'],['productionApproval','internalTesting'],['productionRelease','productionApproval']]){const e=staged();e.gates[target].agentId=e.gates[source].agentId;assert.throws(()=>validateEvidence(plan,e,()=>true,'released',inspect));}
  const same=fixture();same.gates.sync.agentId='qa';assert.throws(()=>validateEvidence(plan,same,()=>true));
});

test('optional failed gate cannot be hidden behind code PASS',()=>{
  const e=fixture();e.gates.extra={status:'FAIL'};assert.throws(()=>validateEvidence(plan,e,()=>true));
});

test('physical inspector hashes bytes instead of trusting manifest checksum',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workflow-physical-'));
  try{
    const localPath=path.join(dir,'fixture.bin');fs.writeFileSync(localPath,'abc');
    const actual=inspectArtifact({localPath,sha256:'fake'});
    assert.equal(actual.sizeBytes,3);assert.equal(actual.sha256,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    fs.writeFileSync(localPath,'abcd');assert.notEqual(inspectArtifact({localPath}).sha256,actual.sha256);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
