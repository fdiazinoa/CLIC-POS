import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {normalizeV3RestaurantSelection,validateV3RestaurantSelection} from '../utils/v3RestaurantSelection';
function fixture(product_type='SIMPLE') {
 const source:any={...normalizeV3RestaurantSelection({product_type,fraction_rule:{enabled:true,max_parts:2,pricing_rule:'HIGHEST_PRICE',options:[{id:'a',product_id:'a',name:'A',price:100},{id:'b',product_id:'b',name:'B',price:200}]}}),price:50};
 const line:any={quantity:1,price:50,originalPrice:50,restaurantConfig:{product_type,modifierGroups:{},comboGroups:{},fractions:[],selected_modifiers:[],selected_combo_items:[],selected_fraction_parts:[]},selected_modifiers:[],selected_combo_items:[],selected_fraction_parts:[]};return {source,line};
}
function isStepValid(productType:string,count:number,selectedFractions:object) {
 const source=readFileSync(new URL('../components/ModifierModal.tsx',import.meta.url),'utf8');
 const ast=ts.createSourceFile('Modal.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let arrow:ts.Node|undefined;
 const visit=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='isStepValid'&&n.initializer&&ts.isCallExpression(n.initializer))arrow=n.initializer.arguments[0];ts.forEachChild(n,visit);};visit(ast);assert.ok(arrow);
 const js=ts.transpileModule('const invoke='+arrow!.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 return new Function('productType','fractionSelectionCount','selectedFractions',js+';return invoke;')(productType,count,selectedFractions);
}
test('real modal permits absent optional fractions and persisted snapshot keeps unchanged base price',()=>{
 const {source,line}=fixture();assert.equal(isStepValid('SIMPLE',0,{})({kind:'fraction',partIndex:0}),true);
 for(const parts of [[],null,undefined]){
  const restored=JSON.parse(JSON.stringify({...line,selected_fraction_parts:parts,restaurantConfig:{...line.restaurantConfig,selected_fraction_parts:parts}}));
  assert.equal(validateV3RestaurantSelection(restored,source),50);
 }
});
test('required fraction never accepts zero parts and partial optional selection remains invalid',()=>{
 const {source,line}=fixture('FRACTIONABLE');assert.equal(isStepValid('FRACTIONABLE',0,{})({kind:'fraction',partIndex:0}),false);
 assert.throws(()=>validateV3RestaurantSelection(line,source));
 const optional=fixture();const part={id:'a',product_id:'a',name:'A',price:100,ratio:.5};
 optional.line.selected_fraction_parts=[part];optional.line.restaurantConfig.selected_fraction_parts=[part];
 assert.throws(()=>validateV3RestaurantSelection(optional.line,optional.source));
});
test('full optional fractions preserve source price and ratios, reject altered snapshots',()=>{
 const {source,line}=fixture();const parts=[{id:'a',product_id:'a',name:'A',price:100,ratio:.5},{id:'b',product_id:'b',name:'B',price:200,ratio:.5}];
 Object.assign(line,{price:200,originalPrice:200,selected_fraction_parts:parts});line.restaurantConfig.selected_fraction_parts=parts;
 assert.equal(validateV3RestaurantSelection(line,source),200);
 parts[0].price=1;assert.throws(()=>validateV3RestaurantSelection(line,source));
});
