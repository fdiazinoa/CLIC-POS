// Documentary binding verifier only; does not validate native business semantics.
import assert from 'node:assert/strict';
import {readFileSync,realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {canonical,hash,vector} from '../pos-recovery-journal/verify-vectors.mjs';
const read=n=>JSON.parse(readFileSync(new URL(n,import.meta.url),'utf8'));
const spec=read('intent-contract.json');
const exact=(o,keys,code)=>assert.deepEqual(Object.keys(o).sort(),[...keys].sort(),code);
const decimal=v=>assert(typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v),'DECIMAL');
const uuid=v=>assert(typeof v==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v),'UUID');
export const assignedDraftFields = [...new Set([...spec.assignedAfterIntent,'displayId','sequenceNumber'])];
export function checkArtifact(a){
 exact(a,['schemaVersion','role','document'],'ARTIFACT_ENVELOPE');
 assert(a.document && typeof a.document==='object' && !Array.isArray(a.document),'ARTIFACT_DOCUMENT');
 if(['saleDraft','refundDraft','collectionDraft','cashDraft','walletDraft'].includes(a.role)){
  const inspect=o=>{if(!o||typeof o!=='object')return;for(const key of Object.keys(o)){assert(!assignedDraftFields.includes(key),'ASSIGNED_FIELD_IN_DRAFT');inspect(o[key]);}};inspect(a.document);
 }
}
export function checkIntent(i,artifacts){
 exact(i,spec.commonFields,'INTENT_FIELDS');
 const s=spec.commands[i.command];assert(s,'COMMAND');
 assert.equal(i.domain,s.domain,'DOMAIN');assert.equal(i.version,s.version,'VERSION');
 uuid(i.commandId);uuid(i.storageEpoch);uuid(i.openSetId);
 exact(i.scope,spec.scopeFields,'SCOPE_FIELDS');Object.values(i.scope).forEach(uuid);
 assert(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(i.preparedAt)&&Number.isFinite(Date.parse(i.preparedAt)),'PREPARED_AT');
 assert.equal(new Date(i.preparedAt).toISOString(),i.preparedAt,'PREPARED_AT_CALENDAR');
 decimal(i.expectedSetRevision);
 const seriesIds=new Set();
 for(const r of i.expectedSeries){exact(r,spec.seriesFields,'SERIES_FIELDS');assert(!seriesIds.has(r.seriesId),'DUPLICATE_SERIES');seriesIds.add(r.seriesId);assert(typeof r.seriesId==='string'&&r.seriesId,'SERIES_ID');assert(r.reservationId===null||(typeof r.reservationId==='string'&&r.reservationId.trim().length>0),'EMPTY_RESERVATION');decimal(r.expectedRevision);decimal(r.expectedNext);}
 assert.deepEqual(i.expectedSeries.map(x=>x.seriesId),[...seriesIds].sort(),'SERIES_ORDER');
 assert.deepEqual(i.artifacts.map(x=>x.role),[...s.artifactRoles].sort(),'ARTIFACT_ROLES');
 for(const r of i.artifacts){exact(r,spec.artifactRefFields,'REF_FIELDS');assert.equal(r.profileVersion,s.profileVersionByRole[r.role],'PROFILE_VERSION');const a=artifacts[r.artifactHash];assert(a,'MISSING_ARTIFACT');checkArtifact(a);assert.equal(a.role,r.role,'ROLE');assert.equal(a.schemaVersion,r.profileVersion,'PROFILE');assert.equal(hash(a),r.artifactHash,'ARTIFACT_HASH');}
 return hash(i);
}
// Independent fixture context stands in for an authenticated, durable ERP registry.
// The import cannot supply/replace that context. No real registry access occurs.
export function checkAnchor(request,registry){
 assert.equal(request.anchor.domain,'pos.journal.resume.v1','ANCHOR_DOMAIN');
 assert(['NEW_EPOCH','SAME_EPOCH_SUFFIX'].includes(request.anchor.mode),'ANCHOR_MODE');
 const r=registry[request.registryId];assert(r,'UNKNOWN_ROOT');
 assert.equal(r.technicalAcceptance,'ACCEPTED','NOT_ACCEPTED');
 assert.equal(r.retentionState,'AVAILABLE','ARCHIVE_UNAVAILABLE');
 assert.equal(canonical(r.scope),canonical(request.scope),'ROOT_SCOPE');
 for(const k of ['priorAcceptanceDigest','priorChainHash','priorStorageEpoch','priorOpenSetId','priorFinalSequence'])assert.equal(request.anchor[k],r[k],'ROOT_BINDING');
 assert.equal(canonical(request.anchor.scope),canonical(request.scope),'ANCHOR_SCOPE');
 assert.notEqual(request.anchor.openSetId,r.priorOpenSetId,'REUSED_OPEN_SET');
 if(request.anchor.mode==='NEW_EPOCH') assert.notEqual(request.anchor.storageEpoch,r.priorStorageEpoch,'REUSED_EPOCH');
 else assert.equal(request.anchor.storageEpoch,r.priorStorageEpoch,'WRONG_EPOCH');
 // RECEIVED/FAILED commercial application does not invalidate technical identity.
 return 'BOUND_TO_FIXTURE_ROOT_NOT_AUTHENTICATED';
}
export function verify(b){
 assert.equal(b.exactZEligible,false);assert.equal(b.closeAuthorization,'NOT_GRANTED');
 let negatives=0;
 for(const c of b.commands){assert.equal(checkIntent(c.intent,b.artifacts),c.vector.sha256);assert.equal(canonical(c.intent),c.vector.canonicalUtf8);assert.equal(Buffer.from(c.vector.canonicalUtf8).toString('hex'),c.vector.utf8Hex);
 for(const mutate of [x=>{x.version=2},x=>{x.artifacts.pop()},x=>{x.activationId='extra'},x=>{x.artifacts[0].profileVersion='unknown'}]){const i=structuredClone(c.intent);mutate(i);assert.throws(()=>checkIntent(i,b.artifacts));negatives++;}
 const i=structuredClone(c.intent);i.preparedAt='2026-09-06T19:01:00.000Z';assert.notEqual(checkIntent(i,b.artifacts),c.vector.sha256);
 assert.equal(checkIntent(structuredClone(c.intent),b.artifacts),c.vector.sha256);
 }
 assert.equal(b.commands.length,Object.keys(spec.commands).length);
 assert.equal(checkAnchor(b.anchorRequest,b.fixtureRegistry),'BOUND_TO_FIXTURE_ROOT_NOT_AUTHENTICATED');
 for(const mutate of [q=>{q.registryId='not-known'},q=>{q.anchor.priorAcceptanceDigest='0'.repeat(64)},q=>{q.scope.companyId='different'},q=>{q.anchor.priorFinalSequence='999'}]){const q=structuredClone(b.anchorRequest);mutate(q);assert.throws(()=>checkAnchor(q,b.fixtureRegistry));negatives++;}
 for(const mutate of [r=>{r.retentionState='TOMBSTONE_ONLY'},r=>{r.technicalAcceptance='RECEIVED'}]){const registry=structuredClone(b.fixtureRegistry);mutate(registry[b.anchorRequest.registryId]);assert.throws(()=>checkAnchor(b.anchorRequest,registry));negatives++;}
 for(const c of b.commands){const arts=structuredClone(b.artifacts);arts[c.intent.artifacts[0].artifactHash].document.changed=true;assert.throws(()=>checkIntent(c.intent,arts));negatives++;}
 console.log(`PASS: ${b.commands.length} versioned intent bindings; ${negatives} negatives; fixture-root checks. No native-profile, authenticity or recoverability certification.`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href)verify(read('contract-vectors.json'));
