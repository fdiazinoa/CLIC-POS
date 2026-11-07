import test from 'node:test';import assert from 'node:assert/strict';
import {effectiveDispatchDiscountLimit,dispatchOperatorHasPermission,type DispatchOperatorPolicy} from '../services/dispatch/DispatchOperatorPolicy';
const policy:DispatchOperatorPolicy={userId:'user',erpPosUserId:'erp-user',roleId:'CASHIER',roleVersion:2,permissions:['POS_DISCOUNT'],userOverride:null,limitSource:'ERP_ASSIGNED_ROLE',discountLimit:{kind:'PERCENT',value:10}};
test('emitted ERP discount maximum is never enlarged by a local-only cache override',()=>{
 assert.equal(effectiveDispatchDiscountLimit(policy,90),10);assert.equal(effectiveDispatchDiscountLimit(policy,5),5);assert.equal(effectiveDispatchDiscountLimit(policy,0),0);assert.equal(effectiveDispatchDiscountLimit(policy),10);
});
test('undefined and zero retain their explicit role semantics and invalid local policy cannot erase a cap',()=>{
 const unlimited={...policy,discountLimit:{kind:'UNLIMITED' as const}};assert.equal(effectiveDispatchDiscountLimit(unlimited),undefined);assert.equal(effectiveDispatchDiscountLimit(unlimited,5),5);
 for(const value of [NaN,Infinity,-1,101])assert.throws(()=>effectiveDispatchDiscountLimit(policy,value),/POLICY_INVALID/);
});
test('credit authority does not grant price override or discount permission',()=>{
 const credit={...policy,permissions:['CREDIT_OVERRIDE']};assert.equal(dispatchOperatorHasPermission(credit,'POS_PRICE_OVERRIDE'),false);assert.equal(dispatchOperatorHasPermission(credit,'POS_DISCOUNT'),false);assert.equal(dispatchOperatorHasPermission(credit,'CREDIT_OVERRIDE'),true);
});
