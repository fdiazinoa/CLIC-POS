// Independent adversarial copies: all changed artifacts AND intents are rehashed.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {hash} from '../pos-recovery-journal/verify-vectors.mjs';
import {checkIntent,checkAnchor,assignedDraftFields} from '../pos-recovery-j3/verify-contract.mjs';
import {checkSemantics} from './verify-semantics.mjs';
const read=n=>JSON.parse(readFileSync(new URL(n,import.meta.url),'utf8'));
const old=read('../pos-recovery-j3/contract-vectors.json'),modern=read('semantic-vectors.json');
let count=0;
function reject(fn,code){assert.throws(fn,e=>e.message.includes(code));count++;}
function rebind(c,role,mutate){const r=c.intent.artifacts.find(r=>r.role===role);const a=structuredClone(c.artifacts[r.artifactHash]);mutate(a);r.artifactHash=hash(a);c.artifacts[r.artifactHash]=a;hash(c.intent);}
for(const fixture of old.commands){
 for(const date of ['2026-02-30T12:00:00.000Z','2026-02-29T12:00:00.000Z','2026-04-31T12:00:00.000Z']){const i=structuredClone(fixture.intent);i.preparedAt=date;hash(i);reject(()=>checkIntent(i,old.artifacts),'PREPARED_AT_CALENDAR');}
 for(const reservationId of ['', '   ']){const i=structuredClone(fixture.intent);i.expectedSeries=[{seriesId:'SERIES-X',reservationId,expectedRevision:'1',expectedNext:'1'}];hash(i);reject(()=>checkIntent(i,old.artifacts),'EMPTY_RESERVATION');}
 const c={intent:structuredClone(fixture.intent),artifacts:structuredClone(old.artifacts)};
 rebind(c,c.intent.artifacts[0].role,a=>{a.extra=true});reject(()=>checkIntent(c.intent,c.artifacts),'ARTIFACT_ENVELOPE');
 const draft=fixture.intent.artifacts.find(r=>r.role.endsWith('Draft'));
 if(draft)for(const field of assignedDraftFields){const c={intent:structuredClone(fixture.intent),artifacts:structuredClone(old.artifacts)};rebind(c,draft.role,a=>{a.document[field]='assigned'});reject(()=>checkIntent(c.intent,c.artifacts),'ASSIGNED_FIELD_IN_DRAFT');}
 const leap=structuredClone(fixture.intent);leap.preparedAt='2024-02-29T12:00:00.000Z';assert(checkIntent(leap,old.artifacts));
}
const nested={intent:structuredClone(old.commands[0].intent),artifacts:structuredClone(old.artifacts)};rebind(nested,'saleDraft',a=>{a.document.metadata={newRevision:'1'}});reject(()=>checkIntent(nested.intent,nested.artifacts),'ASSIGNED_FIELD_IN_DRAFT');
const hist=old.commands.find(c=>c.intent.command==='FISCAL_REVISION');const historical={intent:structuredClone(hist.intent),artifacts:structuredClone(old.artifacts)};rebind(historical,'originalBefore',a=>{a.document.seriesNumber=77;a.document.closedAt='2025-01-01T00:00:00.000Z';});assert(checkIntent(historical.intent,historical.artifacts));
for(const [field,value,code] of [['domain','bad','ANCHOR_DOMAIN'],['mode','bad','ANCHOR_MODE'],['storageEpoch',old.anchorRequest.anchor.priorStorageEpoch,'REUSED_EPOCH'],['openSetId',old.anchorRequest.anchor.priorOpenSetId,'REUSED_OPEN_SET']]){const q=structuredClone(old.anchorRequest);q.anchor[field]=value;hash(q);reject(()=>checkAnchor(q,old.fixtureRegistry),code);}
function fail(command,role,mutate,code){const c=structuredClone(modern.cases.find(c=>c.intent.command===command));if(role)rebind(c,role,a=>mutate(a.document));else {mutate(c.intent);hash(c.intent);}reject(()=>checkSemantics(c.intent,c.artifacts),code);}
for(const cmd of ['SALE_CREATE','REFUND_CREATE','COLLECTION_CREATE','CLOSE_SET'])fail(cmd,null,i=>{i.expectedSeries=[]},'SERIES_REQUIRED');
fail('CASH_CREATE',null,i=>{i.expectedSeries=[{seriesId:'S',reservationId:null,expectedRevision:'1',expectedNext:'1'}]},'SERIES_FORBIDDEN');
fail('CLOSE_SET','executionContext',x=>{x.numbering.allocations[0].mode='RESERVED'},'SERIES_MODE');
fail('CLOSE_SET','executionContext',x=>{x.numbering.allocations[0].end='10'},'SERIES_LIMIT');
fail('CLOSE_SET','executionContext',x=>{x.numbering.allocations[0].scope.companyId='wrong'},'SERIES_SCOPE');
for(const k of ['closeId','closeEventId','nextOpenSetId']){const c=structuredClone(modern.cases.find(c=>c.intent.command==='CLOSE_SET'));const before=checkSemantics(c.intent,c.artifacts).intentHash;rebind(c,'closeControl',a=>{a.document[k]='23232323-2323-4323-8323-232323232323'});assert.notEqual(checkSemantics(c.intent,c.artifacts).intentHash,before);}
fail('CLOSE_SET','closeControl',x=>{x.closeEventId=x.closeId},'CLOSE_CONTROL_COLLISION');
fail('CLOSE_SET','closeControl',x=>{x.nextOpenSetId=modern.cases[0].intent.openSetId},'CLOSE_SET_REUSE');
fail('SALE_CREATE','saleDraft',x=>{x.items.push(x.items[0])},'LINE_DUPLICATE');
fail('SALE_CREATE','paymentEvidence',x=>{x.paymentIds=[]},'PAYMENT_LINK');
fail('REFUND_CREATE','refundEvidence',x=>{x.method='CASH'},'REFUND_METHOD_UNVERIFIED');
fail('REFUND_CREATE','refundDraft',x=>{x.items[0].quantity=3},'REFUND_LIMIT');
fail('COLLECTION_CREATE','collectionDraft',x=>{x.allocations[0].transactionId='MISSING'},'ALLOCATION_PLAN');
fail('COLLECTION_CREATE','collectionDraft',x=>{x.unappliedAmountBase=10},'COLLECTION_BALANCE');
fail('COLLECTION_CREATE','documentsBefore',x=>{x.heads=[]},'HEAD_COVERAGE');
fail('BOOKING_ADVANCE_CREATE','collectionDraft',x=>{x.bookingActivityId='MISSING'},'BOOKING_LINK');
fail('CASH_CREATE','cashDraft',x=>{x.amount=-1},'CASH_AMOUNT');
fail('WALLET_POST','walletDraft',x=>{x.amount=20},'WALLET_SIGN');
fail('WALLET_POST','walletDraft',x=>{x.referenceId='MISSING'},'WALLET_LINK');
fail('FISCAL_REVISION','fiscalResult',x=>{x.patch.total=999},'FISCAL_PATCH');
fail('CLOSE_SET','configuration',x=>{delete x.blocks.taxes},'CONFIG_BLOCKS');
fail('CLOSE_SET','declaration',x=>{x.denominationBreakdown.DOP[0].count=2},'DENOMINATION_TOTAL');
fail('SALE_CREATE','saleDraft',x=>{x.payments[0].appliedAmountBase=99},'PAYMENT_BALANCE');
fail('SALE_CREATE','saleDraft',x=>{x.taxAmount=10},'UNSUPPORTED_TAX_DISCOUNT_PROFILE');
fail('SALE_CREATE','saleDraft',x=>{x.payments[0].currencyCode='USD'},'UNSUPPORTED_PAYMENT_FX_PROFILE');
fail('CLOSE_SET','configuration',x=>{x.blocks.resumeAnchor={state:'ABSENT',value:{fake:true}}},'CONFIG_ABSENCE');
for(const command of ['WALLET_POST','FISCAL_REVISION'])fail(command,null,i=>{i.expectedSeries=[{seriesId:'S',reservationId:null,expectedRevision:'1',expectedNext:'1'}]},'SERIES_FORBIDDEN');
const reserved=structuredClone(modern.cases.find(c=>c.intent.command==='CLOSE_SET'));
reserved.intent.expectedSeries[0].reservationId='RESERVATION-FIXTURE';
rebind(reserved,'executionContext',a=>{a.document.numbering.allocations[0].reservationId='RESERVATION-FIXTURE';a.document.numbering.allocations[0].mode='RESERVED';});
checkSemantics(reserved.intent,reserved.artifacts);
const numberedAdvance=structuredClone(modern.cases.find(c=>c.intent.command==='BOOKING_ADVANCE_CREATE'));
numberedAdvance.intent.expectedSeries=structuredClone(reserved.intent.expectedSeries);
const ctx=reserved.artifacts[reserved.intent.artifacts.find(r=>r.role==='executionContext').artifactHash].document;
rebind(numberedAdvance,'executionContext',a=>{a.document.numbering=structuredClone(ctx.numbering);a.document.numbering.allocations[0].purpose='ADVANCE_RECEIPT';});
checkSemantics(numberedAdvance.intent,numberedAdvance.artifacts);
console.log(`PASS: ${count} independent rehashed negatives; leap-date and historical-number positives; close IDs bound to intentHash. No operational authorization.`);
