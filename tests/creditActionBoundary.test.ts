import test from 'node:test';
import assert from 'node:assert/strict';
import {createCreditActionBoundary} from '../utils/creditActionBoundary';
test('late response belongs to its durable operation but cannot overwrite a different invoice or scope screen',async()=>{
 const boundary=createCreditActionBoundary();boundary.bind('invoiceA/scope1');let resolve!:(receipt:string)=>void;
 const response=new Promise<string>(r=>resolve=r),current=boundary.capture(),shown:string[]=[];
 const work=(async()=>{const receipt=await response;if(current())shown.push(receipt);})();
 boundary.bind('invoiceB/scope1');resolve('receiptA');await work;assert.deepEqual(shown,[]);
 const oldScope=boundary.capture();boundary.bind('invoiceB/scope2');assert.equal(oldScope(),false);
 const closed=boundary.capture();boundary.close('invoiceB/scope2');assert.equal(closed(),false);boundary.open('invoiceB/scope2');assert.equal(closed(),false);assert.equal(boundary.capture()(),true);
});
