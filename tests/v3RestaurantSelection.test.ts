import type {Node} from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeV3RestaurantSelection,validateV3RestaurantSelection} from '../utils/v3RestaurantSelection';
import {v3RestaurantContract} from '../utils/v3RestaurantContract';
import {validateV3PinnedLineSource} from '../services/sync/LargeMasterSyncV3LineSource';
import {v3RetainedLineFingerprint} from '../services/sync/LargeMasterSyncV3StockAuthority';
const raw={product_type:'COMBO',production_area_id:'CAJA_4',combo_groups:[{id:'drink',name:'Bebida',active:true,required:true,min_select:1,max_select:1,items:[{id:'water',product_id:'water-product',name:'Agua con Gas',active:true,price_delta:0},{id:'unused',product_id:'',name:'',active:false}]},{id:'side',name:'Acompañante',active:false,required:true,min_select:1,max_select:1,items:[]}],modifier_groups:[{id:'extras',name:'Extras',active:true,min_select:0,max_select:null,free_quantity:0,selection_type:'MULTIPLE',modifiers:[{id:'bacon',name:'Bacon',price_delta:60},{id:'cheese',name:'Extra queso',price_delta:30},{id:'tomato',name:'Sin tomate',modifier_type:'REMOVE',affects_price:false,price_delta:0}]}],fraction_rule:{enabled:false,options:[]},note_presets:['Sin hielo']};
function fixture(){
 const source:any={...normalizeV3RestaurantSelection(raw),id:'burger',type:'PRODUCT',price:550,isInventoriable:true,taxable:true,appliedTaxIds:['vat'],v3SaleAuthority:{taxIncluded:false}};
 const selected:any={product_type:'COMBO',production_area_id:'CAJA_4',comboGroups:{drink:['water']},modifierGroups:{extras:['bacon','cheese','tomato']},selected_combo_items:[{group_id:'drink',group_name:'Bebida',item_id:'water',product_id:'water-product',name:'Agua con Gas',price_delta:0}],selected_modifiers:[{group_id:'extras',group_name:'Extras',modifier_id:'bacon',name:'Bacon',modifier_type:'ADD',affects_price:true,price_delta:60},{group_id:'extras',group_name:'Extras',modifier_id:'cheese',name:'Extra queso',modifier_type:'ADD',affects_price:true,price_delta:30},{group_id:'extras',group_name:'Extras',modifier_id:'tomato',name:'Sin tomate',modifier_type:'REMOVE',affects_price:false,price_delta:0}],selected_fraction_parts:[]};
 const line:any={...source,cartId:'line',quantity:1,price:640,originalPrice:640,restaurantConfig:selected,selected_combo_items:selected.selected_combo_items,selected_modifiers:selected.selected_modifiers,selected_fraction_parts:[]};return {source,line};
}
test('bounded combo contract preserves actual322 semantics and derives550+60+30, no inactive required side',()=>{
 const {source,line}=fixture();assert.equal(source.combo_groups.length,1);assert.equal(source.combo_groups[0].items.length,1);assert.equal(source.fraction_rule,undefined);
 assert.equal(validateV3RestaurantSelection(line,source),640);assert.doesNotThrow(()=>validateV3PinnedLineSource(line,source,source.v3SaleAuthority));
 assert.equal(v3RestaurantContract({...raw,restaurant_contract_version:1,restaurant_inventory_policy:'PARENT',restaurant_unsupported:false}).product_type,'COMBO');
 assert.throws(()=>v3RestaurantContract({...raw,restaurant_unsupported:false}),/avanzada/);
});
for(const problem of ['missing-required','duplicate','foreign','forged-delta','forged-name','changed-route','unconfigured-price','unknown-group','missing-snapshot'] as const)test(`combo source rejects ${problem}`,()=>{
 const {source,line}=fixture(),s=line.restaurantConfig;
 if(problem==='missing-required')s.comboGroups.drink=[];
 if(problem==='duplicate')s.comboGroups.drink=['water','water'];
 if(problem==='foreign')s.comboGroups.drink=['foreign'];
 if(problem==='forged-delta')s.selected_modifiers[0].price_delta=0;
 if(problem==='forged-name')s.selected_combo_items[0].name='Foreign';
 if(problem==='changed-route')s.production_area_id='FOREIGN';
 if(problem==='unconfigured-price')line.price=line.originalPrice=550;
 if(problem==='unknown-group')s.modifierGroups.foreign=[];
 if(problem==='missing-snapshot')line.selected_combo_items=[];
 assert.throws(()=>validateV3RestaurantSelection(line,source),/SELECTION_INVALID/);
});
test('retained account identity covers options and production note',()=>{const {line}=fixture();const before=v3RetainedLineFingerprint(line);line.restaurantConfig.comboGroups.drink=[];assert.notEqual(v3RetainedLineFingerprint(line),before);});
test('fraction prices and equal parts come from source rule',()=>{
 const source:any={...normalizeV3RestaurantSelection({product_type:'FRACTIONABLE',fraction_rule:{enabled:true,max_parts:2,pricing_rule:'AVERAGE_PRICE',options:[{id:'a',product_id:'a',name:'A',price:100},{id:'b',product_id:'b',name:'B',price:200}]}}),price:50};
 const parts=[{id:'a',product_id:'a',name:'A',price:100,ratio:.5},{id:'b',product_id:'b',name:'B',price:200,ratio:.5}];
 const line:any={price:150,originalPrice:150,quantity:1,restaurantConfig:{product_type:'FRACTIONABLE',modifierGroups:{},comboGroups:{},selected_modifiers:[],selected_combo_items:[],selected_fraction_parts:parts},selected_modifiers:[],selected_combo_items:[],selected_fraction_parts:parts};
 assert.equal(validateV3RestaurantSelection(line,source),150);parts[0].price=1;assert.throws(()=>validateV3RestaurantSelection(line,source));
});

test('actual barcode callback opens restaurant configuration before any cart mutation',async()=>{
 const {readFileSync}=await import('node:fs'),ts=(await import('typescript')).default;
 const text=readFileSync(new URL('../components/POSInterface.tsx',import.meta.url),'utf8'),ast=ts.createSourceFile('POSInterface.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let callback:Node|undefined;
 const visit=(n:Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='resolveSubmittedCode'&&n.initializer&&ts.isCallExpression(n.initializer))callback=n.initializer.arguments[0];ts.forEachChild(n,visit);};visit(ast);assert.ok(callback);
 const {source}=fixture();let adds=0,opened:unknown;
 const boundary={resolveCode:async()=>({product:source,quantity:1,price:550,modifiers:[]})};
 const {productHasRestaurantConfiguration}=await import('../utils/restaurantProductConfig');
 const dependencies:any={v3Operational:boundary,uiLifetime:{current:{capture:()=>()=>true}},presentationMasters:{},products:[],addContext:{current:boundary},scanQueue:{current:{run:(_guard:any,run:any)=>run()}},assertV3UIContext:(guard:any)=>assert.equal(guard(),true),isWeightedProduct:()=>false,productHasRestaurantConfiguration,handleProductClick:(product:any)=>{opened=product;},addToCart:()=>{adds++;return true;},isReturnMode:false};
 const code=ts.transpileModule('const invoke='+callback.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const invoke=new Function(...Object.keys(dependencies),code+';return invoke;')(...Object.values(dependencies));
 const result=await invoke('322');assert.equal(result.added,true);assert.strictEqual(opened,source);assert.equal(adds,0);
});


test('saved simple KDS routing survives JSON park/restore without a commercial type snapshot', () => {
 for (const product_type of ['SIMPLE', 'SERVICE']) {
  const product: any = {id:'water', type:'PRODUCT', product_type, production_area_id:'CAJA_4', price:85};
  const line: any = {...product, quantity:1, restaurantConfig:{production_area_id:'CAJA_4'}};
  for (const restaurantConfig of [undefined, null, line.restaurantConfig, {...line.restaurantConfig, product_type},
   {...line.restaurantConfig, comboGroups:{}, modifierGroups:{}, fractions:[], selected_combo_items:[], selected_modifiers:[], selected_fraction_parts:[]},
   {...line.restaurantConfig, comboGroups:null, modifierGroups:null, fractions:null, selected_combo_items:null, selected_modifiers:null, selected_fraction_parts:null}]) {
   const restored = JSON.parse(JSON.stringify({...line, restaurantConfig}));
   assert.equal(validateV3RestaurantSelection(restored, product), 85);
  }
  for (const patch of [{product_type:null}, {product_type:'COMBO'}, {production_area_id:'OTHER'},
   {comboGroups:[]}, {modifierGroups:1}, {selected_modifiers:[{}]}, {fractions:[{}]}, {unknown:true}, {note:'different'}]) {
   assert.throws(() => validateV3RestaurantSelection({...line, restaurantConfig:{...line.restaurantConfig,...patch}}, product));
  }
  for (const patch of [{selected_modifiers:{}}, {selected_combo_items:'bad'}, {modifiers:'bad'}, {selected_fraction_parts:[{}]}]) {
   assert.throws(() => validateV3RestaurantSelection({...line,...patch}, product));
  }
 }
 for (const product_type of ['COMBO','FRACTIONABLE']) {
  const product:any = {product_type, price:85, production_area_id:'CAJA_4'};
  assert.throws(() => validateV3RestaurantSelection({price:85,restaurantConfig:{production_area_id:'CAJA_4'}} as any, product));
  assert.throws(() => validateV3RestaurantSelection({price:85,restaurantConfig:null} as any, product));
 }
});

test('actual kitchen dispatch preserves genuine selections and does not synthesize commercial routing config', async () => {
 const {readFileSync} = await import('node:fs');
 const ts = await import('typescript');
 const text = readFileSync(new URL('../components/POSInterface.tsx',import.meta.url),'utf8');
 const start = text.indexOf('         const updatedCart = cart.map(item => {', text.indexOf('// 3. Mark items as dispatched'));
 const end = text.indexOf('         if (!options.backgroundTableExit)',start);
 assert.ok(start > 0 && end > start);
 const js = ts.transpileModule(text.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const dispatch = new Function('cart','getCartDispatchKey','dispatchMetaByCartId','dispatchedCartIds','orderNumber','activeTableContext','queuedCartIds','sentCartIds','resolveProductionAreaId',js+'return updatedCart;');
 const {source, line} = fixture();
 const simple:any = {id:'water',cartId:'simple',type:'PRODUCT',product_type:'SIMPLE',price:85,quantity:1,production_area_id:'CAJA_4'};
 const restored = JSON.parse(JSON.stringify(dispatch([simple,line],(item:any)=>item.cartId,new Map(),new Set(['simple',line.cartId]),'order',{},new Set(),new Set(),(item:any)=>item.production_area_id)));
 assert.equal(restored[0].restaurantConfig,undefined);
 const nullLine = {...simple, restaurantConfig:null, selected_modifiers:null, selected_combo_items:null, selected_fraction_parts:null, modifiers:null};
 const nullRestored = JSON.parse(JSON.stringify(dispatch([nullLine],(item:any)=>item.cartId,new Map(),new Set(['simple']),'order',{},new Set(),new Set(),(item:any)=>item.production_area_id)))[0];
 assert.equal(nullRestored.restaurantConfig,null);
 assert.doesNotThrow(()=>validateV3PinnedLineSource(nullRestored,simple,{taxIncluded:undefined} as any));
 assert.doesNotThrow(()=>validateV3RestaurantSelection(restored[0],simple));
 assert.doesNotThrow(()=>validateV3PinnedLineSource(restored[0],simple,{taxIncluded:undefined} as any));
 assert.deepEqual(restored[1].restaurantConfig,line.restaurantConfig);
 assert.equal(validateV3RestaurantSelection(restored[1],source),640);
 restored[1].price++;
 assert.throws(()=>validateV3RestaurantSelection(restored[1],source));
});
