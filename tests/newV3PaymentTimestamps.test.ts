import test from 'node:test';
import assert from 'node:assert/strict';
import {freezeNewV3PaymentTimestamps} from '../services/sync/NewV3PaymentTimestamps';
const input=(timestamp:any)=>({id:'new',payments:[{id:'p',method:'CASH',amount:100,timestamp}],extra:{date:new Date('2026-10-17T01:00:00Z')}} as any);
test('new-source helper copies only timestamps, preserves raw ISO literal and caller Date, rejects incompatible normalizer output',()=>{
 const date=new Date('2026-10-17T12:34:56.789Z'),source=input(date),original=input(date);const frozen=freezeNewV3PaymentTimestamps(source,original.payments);
 assert.equal(frozen.payments[0].timestamp,date.toISOString());assert.equal(original.payments[0].timestamp,date);assert.equal(source.payments[0].timestamp,date);assert.notEqual(frozen,source);assert.notEqual(frozen.payments,source.payments);assert.strictEqual((frozen as any).extra,source.extra);
 const raw='2026-10-17T08:34:56.789-04:00';assert.equal(freezeNewV3PaymentTimestamps(source,input(raw).payments).payments[0].timestamp,raw);
 assert.throws(()=>freezeNewV3PaymentTimestamps(source,input('2026-10-17T08:34:57.789-04:00').payments),/TIMESTAMP_INVALID/);
 for(const bad of [new Date(NaN),undefined,null,'','not-date','2026-10-17',123])assert.throws(()=>freezeNewV3PaymentTimestamps(source,input(bad).payments),/TIMESTAMP_INVALID/);
 assert.throws(()=>freezeNewV3PaymentTimestamps(source,[]),/TIMESTAMP_INVALID/);
});
