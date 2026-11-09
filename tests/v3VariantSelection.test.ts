import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {validateV3RestaurantSelection} from '../utils/v3RestaurantSelection';
import {validateV3PinnedLineSource} from '../services/sync/LargeMasterSyncV3LineSource';
import {resolveVariantSalesPrice} from '../utils/variantSalesPrice';
import type {ProductVariant} from '../types';

function fixture(price=120) {
 const variant:ProductVariant={id:'blue',sku:'BLUE',price,barcode:['BLUE-CODE'],attributeValues:{Color:'Azul',Talla:'M'}};
 const product:any={id:'shirt',type:'PRODUCT',product_type:'SIMPLE',price:100,isInventoriable:true,taxable:false,appliedTaxIds:[],v3SaleAuthority:{taxIncluded:false},variants:[variant]};
 const resolved=resolveVariantSalesPrice(variant,product.price);
 const line:any={...product,cartId:'line',quantity:1,price:resolved,originalPrice:resolved,variantId:variant.id,variantSku:variant.sku,modifiers:['Azul','M']};
 return {product,variant,line};
}

test('pinned variant labels survive saved-line JSON restore and own positive price',()=>{
 const {product,line}=fixture();
 const restored=JSON.parse(JSON.stringify(line));
 assert.equal(validateV3RestaurantSelection(restored,product),120);
 assert.doesNotThrow(()=>validateV3PinnedLineSource(restored,product,product.v3SaleAuthority));
});
test('zero-price variant inherits active tariff rather than becoming free',()=>{
 const {product,line}=fixture(0);assert.equal(validateV3RestaurantSelection(line,product),100);
});
for(const issue of ['unknown-id','wrong-sku','missing-identity','forged-label','orphan-label','forged-original-price','forged-price'] as const)test(`variant rejects ${issue}`,()=>{
 const {product,line}=fixture();
 if(issue==='unknown-id')line.variantId='other';
 if(issue==='wrong-sku')line.variantSku='OTHER';
 if(issue==='missing-identity'){delete line.variantId;delete line.variantSku;}
 if(issue==='forged-label')line.modifiers=['Rojo','M'];
 if(issue==='orphan-label')line.modifiers.push('Gratis');
 if(issue==='forged-original-price')line.originalPrice=1;
 if(issue==='forged-price')line.price=121;
 assert.throws(()=>validateV3RestaurantSelection(line,product));
});

// Execute the literal provisional validation block used by both card and scan callbacks.
function addValidation(product:any,price:number,modifiers:string[],selectedVariant:any) {
 const source=readFileSync(new URL('../components/POSInterface.tsx',import.meta.url),'utf8');
 const ast=ts.createSourceFile('POSInterface.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let block:ts.IfStatement|undefined;
 const visit=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='performAddToCart'){
   const call=n.initializer as ts.CallExpression,arrow=call.arguments[0] as ts.ArrowFunction;
   const walk=(node:ts.Node)=>{if(!block&&ts.isIfStatement(node)&&node.expression.getText(ast)==='v3Operational')block=node;ts.forEachChild(node,walk);};walk(arrow.body);
 }ts.forEachChild(n,visit);};visit(ast);assert.ok(block);
 let validated:any;
 const boundary={validate:async(lines:any[])=>{validated=lines[0];validateV3PinnedLineSource(validated,product,product.v3SaleAuthority);}};
 const deps:any={v3Operational:boundary,trackingData:undefined,consignmentPatch:undefined,product,quantity:1,priceOverride:price,modifiers,selectedVariant,variantInfo:undefined,note:undefined,restaurantConfig:undefined,latestAddCart:{current:[]},activeTable:undefined,activeDirectV3TicketId:undefined,activeV3Reservation:undefined,assertV3UIContext:()=>{},isCurrent:()=>true,resolveVariantSalesPrice,getProductPrice:(p:any)=>p.price};
 const js=ts.transpileModule(`async function invoke(){${block!.getText(ast)}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 return new Function(...Object.keys(deps),js+'return invoke;')(...Object.values(deps))().then(()=>validated);
}
test('actual card/scan provisional validation includes selected variant before checking labels',async()=>{
 const {product,variant,line}=fixture();
 const validated=await addValidation(product,120,line.modifiers,variant);
 assert.equal(validated.variantId,'blue');assert.equal(validated.variantSku,'BLUE');assert.equal(validated.originalPrice,120);
 assert.equal(validateV3RestaurantSelection(JSON.parse(JSON.stringify(validated)),product),120);
});

function callback(name:string,deps:Record<string,unknown>) {
 const source=readFileSync(new URL('../components/POSInterface.tsx',import.meta.url),'utf8');
 const ast=ts.createSourceFile('POSInterface.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let arrow:ts.Node|undefined;
 const visit=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===name&&n.initializer){arrow=ts.isCallExpression(n.initializer)?n.initializer.arguments[0]:n.initializer;}ts.forEachChild(n,visit);};visit(ast);assert.ok(arrow);
 const js=ts.transpileModule('const invoke='+arrow!.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 return new Function(...Object.keys(deps),js+';return invoke;')(...Object.values(deps));
}
test('literal variant card callback sends selected identity through actual provisional validation',async()=>{
 const {product,variant,line}=fixture();let pending:Promise<any>|undefined,closed=false;
 const invoke=callback('handleVariantConfirm',{rejectFormatQuickReturn:()=>false,articleFormatsEnabled:false,isReturnMode:false,setSelectedProductForVariants:()=>{closed=true;},addToCart:(p:any,_q:number,price:number,labels:string[],_tracking:any,v:any)=>{pending=addValidation(p,price,labels,v);}});
 invoke(product,line.modifiers,120,variant,'Color: Azul / Talla: M');
 assert.equal(closed,true);assert.ok(pending);assert.equal((await pending).variantId,'blue');
});
test('literal submitted barcode callback retains the selected variant through actual provisional validation',async()=>{
 const {product,variant,line}=fixture();let validated:any;
 const boundary={resolveCode:async()=>({product,quantity:1,price:120,modifiers:line.modifiers,selectedVariant:variant})};
 const invoke=callback('resolveSubmittedCode',{v3Operational:boundary,uiLifetime:{current:{capture:()=>()=>true}},presentationMasters:{},products:[],addContext:{current:boundary},scanQueue:{current:{run:(_guard:any,run:any)=>run()}},assertV3UIContext:(guard:any)=>assert.equal(guard(),true),isWeightedProduct:()=>false,productHasRestaurantConfiguration:()=>false,isReturnMode:false,addToCart:async(p:any,_q:number,price:number,labels:string[],_tracking:any,v:any)=>{validated=await addValidation(p,price,labels,v);return true;}});
 assert.equal((await invoke('BLUE-CODE')).added,true);assert.equal(validated.variantId,'blue');assert.equal(validated.originalPrice,120);
});
test('selector attribute order and barcode record order are both derived exclusively from pinned values',()=>{
 const {product,line}=fixture();
 product.variants.unshift({id:'red',sku:'RED',price:100,attributeValues:{Talla:'S',Color:'Rojo'}});
 line.modifiers=['M','Azul'];assert.equal(validateV3RestaurantSelection(line,product),120);
 line.modifiers=['Azul','M'];assert.equal(validateV3RestaurantSelection(line,product),120);
 line.modifiers=['Rojo','M'];assert.throws(()=>validateV3RestaurantSelection(line,product));
});
test('variant without attribute keys preserves selector SKU label and barcode empty labels',()=>{
 const {product,line}=fixture();product.variants[0].attributeValues={};
 for(const modifiers of [[],['BLUE']])assert.equal(validateV3RestaurantSelection({...line,modifiers},product),120);
 assert.throws(()=>validateV3RestaurantSelection({...line,modifiers:['OTHER']},product));
});

test('literal V3 barcode resolver inherits zero-price tariff and emits pinned labels before add',async()=>{
 const source=readFileSync(new URL('../components/LargeMasterSyncV3OperationalPOS.tsx',import.meta.url),'utf8');
 const ast=ts.createSourceFile('Boundary.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let arrow:ts.Node|undefined;
 const visit=(n:ts.Node)=>{if(ts.isPropertyAssignment(n)&&n.name.getText(ast)==='resolveCode'&&ts.isArrowFunction(n.initializer))arrow=n.initializer;ts.forEachChild(n,visit);};visit(ast);assert.ok(arrow);
 const {product,variant}=fixture(0);const catalog={findBarcode:async()=>({item:{product},variant})};
 const deps:any={assertContext:()=>{},contextSequence:{current:1},catalog:{current:catalog},session:{assertCurrent:async()=>{},withStock:async(p:any)=>p},warehouseId:'w',assertWeightedCodeInput:()=>{},remember:()=>{},resolveVariantSalesPrice};
 const js=ts.transpileModule('const invoke='+arrow!.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const result=await new Function(...Object.keys(deps),js+';return invoke;')(...Object.values(deps))('BLUE-CODE');
 assert.equal(result.price,100);assert.deepEqual(result.modifiers,['Azul','M']);
 assert.equal((await addValidation(result.product,result.price,result.modifiers,result.selectedVariant)).variantId,'blue');
});

test('variant source keeps explicitly authorized later reduction without allowing an invented surcharge',()=>{
 const {product,line}=fixture();line.price=110;
 assert.equal(validateV3RestaurantSelection(line,product),120);
 line.price=121;assert.throws(()=>validateV3RestaurantSelection(line,product));
});


test('unchanged saved legacy V3 barcode line keeps empty labels and base originalPrice through JSON restore',()=>{
 const {product,line}=fixture();
 for(const modifiers of [[],undefined,null]){
  const saved=JSON.parse(JSON.stringify({...line,modifiers,originalPrice:100}));
  assert.equal(validateV3RestaurantSelection(saved,product),120);
  assert.doesNotThrow(()=>validateV3PinnedLineSource(saved,product,product.v3SaleAuthority));
  assert.equal(saved.originalPrice,100);assert.equal(saved.modifiers,modifiers===undefined?undefined:modifiers===null?null:saved.modifiers);
  for(const patch of [{variantId:'foreign'},{variantSku:'FOREIGN'},{modifiers:['arbitrary']},{price:121},{originalPrice:1}])assert.throws(()=>validateV3RestaurantSelection({...saved,...patch},product));
 }
});

// Execute the selector's literal effect/resolution/confirm callbacks, then the
// existing POS callback and its actual provisional validation boundary.
function selector(product:any,onConfirm:(...args:any[])=>void) {
 const source=readFileSync(new URL('../components/ProductVariantSelector.tsx',import.meta.url),'utf8');
 const ast=ts.createSourceFile('ProductVariantSelector.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const names=['getVariantAttributeValue','handleSelect','calculateTotal','getSelectedVariant','buildVariantInfo','handleConfirmSelection'];
 const functions=new Map<string,string>();let effect:ts.Node|undefined;
 const visit=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&names.includes(n.name.getText(ast))&&n.initializer)functions.set(n.name.getText(ast),n.initializer.getText(ast));if(ts.isCallExpression(n)&&n.expression.getText(ast)==='useEffect')effect=n.arguments[0];ts.forEachChild(n,visit);};visit(ast);assert.ok(effect);assert.equal(functions.size,names.length);
 const js=ts.transpileModule(`let groups=[],selections={};const variants=product.variants.filter(Boolean),productSalesPrice=product.price,COLOR_MAP={};const setGroups=v=>groups=v,setSelections=v=>selections=typeof v==='function'?v(selections):v;${names.map(name=>`const ${name}=${functions.get(name)};`).join('\n')}(${effect!.getText(ast)})();return{get groups(){return groups;},select:handleSelect,confirm:handleConfirmSelection,selected:getSelectedVariant};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 return new Function('product','onConfirm','resolveVariantSalesPrice',js)(product,onConfirm,resolveVariantSalesPrice);
}
async function selectorToValidation(product:any,index:number) {
 let pending:Promise<any>|undefined,chosen:any;const invoke=callback('handleVariantConfirm',{rejectFormatQuickReturn:()=>false,articleFormatsEnabled:false,isReturnMode:false,setSelectedProductForVariants:()=>{},addToCart:(p:any,_q:number,price:number,labels:string[],_tracking:any,v:any)=>{chosen=v;pending=addValidation(p,price,labels,v);}});
 const ui=selector(product,invoke),group=ui.groups[0];assert.equal(new Set(group.options.map((o:any)=>o.id)).size,group.options.length,'selector IDs must be unique even when a SKU resembles a fallback ID');ui.select(group.id,group.options[index]);ui.confirm();assert.ok(pending);return{line:await pending,chosen,ui};
}
for(const sku of [undefined,''])test(`literal selector preserves an original variant with ${sku===undefined?'absent':'empty'} SKU through POS validation`,async()=>{
 const {product,variant}=fixture();variant.attributeValues={};if(sku===undefined)delete (variant as any).sku;else variant.sku=sku;
 const {line,chosen}=await selectorToValidation(product,0);assert.equal(chosen,variant);assert.equal(line.variantId,variant.id);assert.equal(line.originalPrice,120);assert.deepEqual(line.modifiers,['Variante 1']);assert.equal(validateV3RestaurantSelection(line,product),120);
});
test('literal selector keeps fallback-ID-shaped real SKU distinct from an absent SKU',async()=>{
 const {product,variant}=fixture();delete variant.sku;variant.attributeValues={};const second={id:'second',sku:'variant-0',price:150,attributeValues:{}};product.variants.push(second);
 for(const index of [0,1]){const {line,chosen}=await selectorToValidation(product,index);assert.equal(chosen,product.variants[index]);assert.equal(line.variantId,product.variants[index].id);assert.equal(line.originalPrice,index?150:120);assert.deepEqual(line.modifiers,index?['variant-0']:['Variante 1']);}
});
test('literal selector distinguishes two no-SKU variants and keeps their individual prices',async()=>{
 const {product,variant}=fixture();delete variant.sku;variant.attributeValues={};product.variants.push({id:'second',sku:'',price:175,attributeValues:{}});
 for(const index of [0,1]){const {line,chosen}=await selectorToValidation(product,index);assert.equal(chosen,product.variants[index]);assert.equal(line.variantId,product.variants[index].id);assert.equal(line.originalPrice,index?175:120);assert.deepEqual(line.modifiers,[`Variante ${index+1}`]);for(const patch of [{variantId:'foreign'},{variantSku:'foreign'},{modifiers:[`Variante ${2-index}`]},{modifiers:['invented']},{price:999},{originalPrice:1}])assert.throws(()=>validateV3RestaurantSelection({...line,...patch},product));}
});
test('literal selector retains SKU and attribute labels through the same real validation',async()=>{
 for(const attributes of [false,true]){const {product,variant}=fixture();if(!attributes)variant.attributeValues={};const {chosen,line}=await selectorToValidation(product,0);assert.equal(chosen,variant);assert.equal(line.variantId,'blue');assert.equal(line.originalPrice,120);assert.equal(validateV3RestaurantSelection(line,product),120);}
});
test('literal selector cannot confirm or select a zero-stock option',()=>{
 const {product,variant}=fixture();variant.attributeValues={};variant.initialStock=0;let calls=0;const ui=selector(product,()=>calls++);ui.select(ui.groups[0].id,ui.groups[0].options[0]);assert.equal(ui.selected(),undefined);ui.confirm();assert.equal(calls,0);
});

test('literal format callback still rejects a no-SKU variant before adding or choosing a format',()=>{
 const {product,variant}=fixture();delete variant.sku;variant.attributeValues={};product.article_formats={formats:[{id:'box'}]};let adds=0,formats=0,error='';
 const invoke=callback('handleVariantConfirm',{rejectFormatQuickReturn:()=>false,articleFormatsEnabled:true,isReturnMode:false,setSelectedProductForVariants:()=>{},setFormatSelection:()=>formats++,setErrorToast:(message:string)=>error=message,formatVariantForSku:()=>{throw Error('must not resolve a missing SKU');},activeTariffId:'base',addToCart:()=>adds++});
 invoke(product,['Variante 1'],120,variant);assert.match(error,/Selecciona una variante válida/);assert.equal(adds,0);assert.equal(formats,0);
});
