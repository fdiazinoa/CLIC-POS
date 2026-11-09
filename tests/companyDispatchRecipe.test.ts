import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {compileCompanyDispatchDemand,dispatchInventoryConsumptionMode} from '../services/dispatch/companyDispatchDemand.js';
const scope={tenantId:'tenant',companyId:'company'};
const item=(id:string,type='PRODUCT',metadata:Record<string,unknown>={})=>({id,type,tenant_id:scope.tenantId,company_id:scope.companyId,metadata,is_active:true});
describe('native retained recipe quantities / pure source, no bridge claim',()=>{
 it('preserves mode selection for direct products, recipes and both KIT profiles',()=>{
  for(const [source,expected] of [[{type:'PRODUCT'},'DIRECT'],[{type:'RECETA',recipeDetails:[{}]},'COMPONENTS'],[{type:'KIT',recipeDetails:[{}],isInventoriable:false},'COMPONENTS'],[{type:'KIT',recipeDetails:[{}]},'DIRECT'],[{type:'RECETA',recipeDetails:[{}],kitInventoryMode:'FINISHED_GOOD'},'DIRECT']] as const)assert.equal(dispatchInventoryConsumptionMode(source),expected);
 });
 it('computes decimal yield from nonsellable retained children and leaves source unchanged',()=>{
  const catalog={scope,items:[item('recipe','RECETA',{batchYield:3,recipeDetails:[{childItemId:'child',quantity:6,unit:'kg'}]}),{...item('child','PRODUCT',{measurementUnit:'kg'}),sellable:false}]};
  const before=JSON.stringify(catalog);
  assert.equal(compileCompanyDispatchDemand(catalog,{itemId:'recipe',quantity:0.1}).demands[0].quantityMinor,200000);
  assert.equal(JSON.stringify(catalog),before);
 });
 it('retains rational intermediate yield until a later component cancels it',()=>{
  const catalog={scope,items:[item('recipe','RECETA',{batchYield:3,recipeDetails:[{childItemId:'middle',quantity:1}]}),item('middle','RECETA',{recipeDetails:[{childItemId:'child',quantity:3}]}),item('child')]};
  assert.equal(compileCompanyDispatchDemand(catalog,{itemId:'recipe',quantity:1}).demands[0].quantityMinor,1000000);
 });
 it('never rounds repeating physical quantities or invents a missing ingredient',()=>{
  assert.throws(()=>compileCompanyDispatchDemand({scope,items:[item('recipe','RECETA',{batchYield:3,recipeDetails:[{childItemId:'child',quantity:1}]}),item('child')]},{itemId:'recipe',quantity:1}),/NOT_BASE4_REPRESENTABLE/);
  assert.throws(()=>compileCompanyDispatchDemand({scope,items:[item('recipe','RECETA',{recipeDetails:[{childItemId:'missing',quantity:1}]})]},{itemId:'recipe',quantity:1}),/CHILD_MISSING/);
 });
});

describe('SERVICE retained semantic proof vectors',()=>{
 it('proves a direct canonical service has no physical demand',()=>{const result=compileCompanyDispatchDemand({scope,items:[item('service','SERVICE')]},{itemId:'service',quantity:2});assert.deepEqual(result.demands,[]);assert.equal(result.nonStockReason,'CANONICAL_SERVICE');});
 it('finances every leaf of SERVICE COMPONENTS without inventing stock for the parent',()=>{const items=[item('service','SERVICE',{isInventoriable:false,kitInventoryMode:'COMPONENT_CONSUMPTION',recipeDetails:[{childItemId:'child',quantity:2}]}),item('child')];const result=compileCompanyDispatchDemand({scope,items},{itemId:'service',quantity:3});assert.equal(result.demands.length,1);assert.equal(result.demands[0].itemId,'child');assert.equal(result.demands[0].quantityMinor,6000000);assert.equal(result.nonStockReason,null);});
 it('rejects ambiguous SERVICE FINISHED_GOOD plus recipe before declaring it no-stock',()=>{const items=[item('service','SERVICE',{kitInventoryMode:'FINISHED_GOOD',recipeDetails:[{childItemId:'child',quantity:2}]}),item('child')];assert.throws(()=>compileCompanyDispatchDemand({scope,items},{itemId:'service',quantity:1}),/DISPATCH_SERVICE_RECIPE_MODE_UNPROVEN/);});
});
