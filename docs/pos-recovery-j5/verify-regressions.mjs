// Independent adversarial fixture copies; no runtime imports or business execution.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {checkSemantics} from '../pos-recovery-j4/verify-semantics.mjs';
const canonical=x=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(canonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
const hash=x=>createHash('sha256').update(canonical(x)).digest('hex');
const bundle=JSON.parse(readFileSync(new URL('../pos-recovery-j4/semantic-vectors.json',import.meta.url)));
const copy=cmd=>structuredClone(bundle.cases.find(c=>c.intent.command===cmd));
function mutate(c,role,fn){const ref=c.intent.artifacts.find(r=>r.role===role),artifact=structuredClone(c.artifacts[ref.artifactHash]);fn(artifact.document);ref.artifactHash=hash(artifact);c.artifacts[ref.artifactHash]=artifact; c.vector={canonicalUtf8:canonical(c.intent),sha256:hash(c.intent)};}
let negatives=0,positives=0;
function run(c,error){assert.equal(hash(c.intent),c.vector.sha256);for(const ref of c.intent.artifacts)assert.equal(hash(c.artifacts[ref.artifactHash]),ref.artifactHash);const bytes=canonical(c);if(error){assert.throws(()=>checkSemantics(c.intent,c.artifacts),e=>e.message.includes(error));negatives++;}else{assert.equal(checkSemantics(c.intent,c.artifacts).intentHash,c.vector.sha256);positives++;}assert.equal(canonical(c),bytes,'NO_IMPORT_MUTATION');}
for(const c of bundle.cases)run(c);
function split(a,b){const c=copy('REFUND_CREATE');mutate(c,'refundDraft',x=>{const line=x.items[0];x.items=[{...line,quantity:a},{...line,cartId:'LINE-SPLIT',quantity:b}];x.total=x.netAmount=(a+b)*line.price;x.payments[0].amount=x.payments[0].appliedAmountBase=x.total;});return c;}
run(split(2,2),'REFUND_AGGREGATE_LIMIT');run(split(1,1));run(split(1,2),'REFUND_AGGREGATE_LIMIT');
for(const cmd of ['SALE_CREATE','REFUND_CREATE'])for(const delta of [999,-1,1,0]){const c=copy(cmd);mutate(c,'executionContext',x=>{x.inventoryMode='TRACKED'});mutate(c,'inventoryPlan',x=>{x.mode='TRACKED';x.lines=[{cartId:'LINE-1',productId:'PRODUCT-1',warehouseId:'W',unit:'UNIT',delta}]});run(c,'UNSUPPORTED_TRACKED_INVENTORY_PROFILE');}
for(const cmd of ['SALE_CREATE','REFUND_CREATE'])for(const currency of ['USD',undefined,null,'','dop','DOP']){const c=copy(cmd);mutate(c,cmd==='SALE_CREATE'?'saleDraft':'refundDraft',x=>{x.payments[0].amount=x.payments[0].appliedAmountBase+10;x.payments[0].changeAmount=10;if(currency===undefined)delete x.payments[0].changeCurrencyCode;else x.payments[0].changeCurrencyCode=currency;});run(c,currency==='DOP'?undefined:'UNSUPPORTED_CHANGE_CURRENCY');}
console.log(`PASS: ${negatives} independent rehashed negatives; ${positives} positives; aggregate 2+2/2 rejected, 1+1/2 accepted; TRACKED blocked; explicit DOP change. Legacy UNKNOWN, exactZEligible=false, closeAuthorization=NOT_GRANTED.`);
