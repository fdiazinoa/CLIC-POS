import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { classify, validateEvidence, safeOutput } from './workflow-gate.mjs';
const plan = { baseSha: 'base', candidateSha: 'candidate', ...classify(['App.tsx']) };
function fixture() {
  const gates = {};
  for (const name of plan.requiredGates) gates[name] = {
    status: 'PASS', candidateSha: 'candidate', agentId: ['functional','regression','sync','offline'].includes(name) ? 'qa' : name,
    role: ({analysis:'analyst',plan:'plan-approver',review:'reviewer',qa:'qa',performance:'performance'})[name] || 'qa', artifacts: ['real-log'],
  };
  return {schemaVersion:1, taskId:'task',baseSha:'base',candidateSha:'candidate',implementationAuthors:['developer'],gates};
}
test('shared, deleted, new and unknown functional paths activate all critical gates', () => {
  for (const file of ['types.ts','services/sync/ApiSyncAdapter.ts','native-stubs/android/ClicPOSMasterHttpServer.kt','new/module.ts','package-lock.json']) assert.deepEqual(classify([file]).requiredGates, plan.requiredGates);
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
