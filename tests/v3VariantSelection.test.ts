import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {validateV3RestaurantSelection} from '../utils/v3RestaurantSelection';
import {validateV3PinnedLineSource} from '../services/sync/LargeMasterSyncV3LineSource';
import {resolveVariantSalesPrice} from '../utils/variantSalesPrice';

function fixture(price=120) {
 const variant={id:'blue',sku:'BLUE',price,barcode:['BLUE-CODE'],attributeValues:{Color:'Azul',Talla:'M'}};
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
