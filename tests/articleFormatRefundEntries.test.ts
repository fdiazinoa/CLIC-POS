import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { assertOriginalSaleForFormatReturn, legacyMergeCandidate, addFormatLine } from '../services/articleFormats/cart';
import { toBaseQuantity, freezeLine } from '../services/articleFormats/domain';
import { formatsEnabled, ARTICLE_FORMATS_READINESS } from '../services/articleFormats/activation';
import type { Product, CartItem } from '../types';
import type { ArticleFormat } from '../services/articleFormats/contract';

// Run actual production callbacks with isolated effect ports. This does not assert GUI/APK E2E.
const source = readFileSync('components/POSInterface.tsx','utf8');
const ast = ts.createSourceFile('POSInterface.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function evaluate(expression: ts.Expression, bindings: Record<string,unknown>): (...args: any[]) => any {
  const javascript = ts.transpileModule(`const handler = ${expression.getText(ast)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  return new Function(...Object.keys(bindings),`${javascript}; return handler;`)(...Object.values(bindings));
}
function productionHandler(name: string, bindings: Record<string,unknown>) {
  let arrow: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer) {
      arrow = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer;
    }
    ts.forEachChild(node,visit);
  }
  visit(ast); assert.ok(arrow && ts.isArrowFunction(arrow),`Production arrow not found: ${name}`);
  return evaluate(arrow,bindings);
}
function productionProp(component: string, prop: string, bindings: Record<string,unknown>) {
  let expression: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(ast) === component) {
      for (const attribute of node.attributes.properties) {
        if (ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === prop && attribute.initializer && ts.isJsxExpression(attribute.initializer)) expression = attribute.initializer.expression;
      }
    }
    ts.forEachChild(node,visit);
  }
  visit(ast); assert.ok(expression,`Production JSX prop missing: ${component}.${prop}`);
  return ts.isIdentifier(expression) ? productionHandler(expression.text,bindings) : evaluate(expression,bindings);
}
const box: ArticleFormat = {schemaVersion:1,id:'fixture-box',variantId:null,name:'Caja24',abbreviation:'CJ24',factor:24,barcode:null,
  active:true,is_base:false,default_sale:true,default_purchase:false,allow_sale:true,allow_purchase:true,allow_transfer:true,sort_order:1,prices:[]};
const product = (formatted = true): Product => ({id:'fixture-item',name:'Fixture',price:10,category:'fixture',images:[],attributes:[],variants:[],tariffs:[],appliedTaxIds:[],
  ...(formatted ? {article_formats:{schema_version:1,inventory_quantity_unit:'BASE',item_id:'fixture-item',formats:[box]}} : {})});

function fixture(isReturnMode: boolean, articleFormatsEnabled: boolean, isMobile = false) {
  const effects: {name:string;value:unknown}[]=[];
  let cart: CartItem[]=[];
  const effect = (name:string) => (value:unknown) => effects.push({name,value});
  const common: Record<string,unknown> = {isReturnMode,articleFormatsEnabled,isMobile,defaultSalesWarehouseId:'fixture-wh',activeTariffId:'retail',
    setErrorToast:effect('error'),setSelectedProductForVariants:effect('variants'),setFormatSelection:effect('formats'),setPendingProductToAdd:effect('pending'),
    setShowMobileConfigModal:effect('mobile'),setProductForScale:effect('scale'),setPendingTrackingProduct:effect('tracking'),setLastAddedCartId:effect('highlight'),
    assertOriginalSaleForFormatReturn,legacyMergeCandidate,addFormatLine,toBaseQuantity,crypto:{randomUUID:() => 'fixture-format-line'},cart,
    canAddItemToCart:() => { effects.push({name:'stock',value:true}); return true; },getProductPrice:(p:Product) => p.price,
    onUpdateCart:(update:(previous:CartItem[]) => CartItem[]) => { effects.push({name:'cart',value:true});cart=update(cart); }};
  common.rejectFormatQuickReturn=productionHandler('rejectFormatQuickReturn',common);
  common.addToCart=productionHandler('addToCart',common);
  common.addSelectedFormat=productionHandler('addSelectedFormat',common);
  return {effects,common,get cart() {return cart;}};
}

for (const enabled of [false,true]) for (const mobile of [false,true]) {
  for (const withVariant of [false,true]) test(`grid format return requires original sale before effects; enabled=${enabled}, mobile=${mobile}, variant=${withVariant}`,() => {
    const f=fixture(true,enabled,mobile);
    const p=product();if (withVariant) p.attributes=[{id:'fixture-color',name:'Color',options:['Red'],optionCodes:['R']}];
    productionHandler('handleProductClick',f.common)(p);
    assert.deepEqual(f.effects.map(effect => effect.name),['error']);assert.equal(f.cart.length,0);
    assert.match(String(f.effects[0].value),/ticket original/);
  });
  test(`actual variant modal confirmation rejects format return; enabled=${enabled}, mobile=${mobile}`,() => {
    const f=fixture(true,enabled,mobile);
    productionProp('ProductVariantSelector','onConfirm',f.common)(product(),['Red'],240,'red-SKU');
    assert.deepEqual(f.effects.map(effect => effect.name),['error','variants']);
    assert.equal(f.effects[1].value,null);assert.equal(f.cart.length,0);
  });
}
test('format selector opened for sale cannot add positive quantity after switching to return mode',() => {
  const p=product(),f=fixture(true,true);
  productionProp('ArticleFormatSelector','onSelect',{...f.common,formatSelection:{product:p,modifiers:[]}})(box,240);
  assert.deepEqual(f.effects.map(effect => effect.name),['error','formats']);assert.equal(f.cart.length,0);
});
test('direct negative formatted entry and tracking resume cannot bypass original-sale requirement',() => {
  const f=fixture(false,false);
  productionHandler('addToCart',f.common)(product(),-1,240,[],[{id:'fixture-lot'}]);
  assert.deepEqual(f.effects.map(effect => effect.name),['error']);assert.equal(f.cart.length,0);
});
test('legacy grid and variant returns remain base Unit x1 and variant quantity is negative',() => {
  for (const entry of ['grid','variant']) {
    const f=fixture(true,false),p=product(false);
    if (entry === 'grid') productionHandler('handleProductClick',f.common)(p);
    else productionProp('ProductVariantSelector','onConfirm',f.common)(p,['Red'],12,'red-SKU');
    assert.equal(f.cart.length,1);assert.equal(f.cart[0].quantity,-1);
    assert.equal(f.cart[0].articleFormat,undefined);assert.equal(f.cart[0].baseQuantity,undefined);
    assert.equal(f.cart[0].price,entry === 'grid' ? 10 : 12);
  }
});
test('legacy variant sale remains positive and real format sale callback keeps its snapshot',() => {
  const legacy=fixture(false,false);
  productionProp('ProductVariantSelector','onConfirm',legacy.common)(product(false),['Red'],12,'red-SKU');
  assert.equal(legacy.cart[0].quantity,1);
  const p=product(),formatted=fixture(false,true);
  productionProp('ArticleFormatSelector','onSelect',{...formatted.common,formatSelection:{product:p,modifiers:[]}})(box,240);
  assert.equal(formatted.cart[0].quantity,1);assert.equal(formatted.cart[0].baseQuantity,24);assert.equal(formatted.cart[0].articleFormat?.id,box.id);
});
test('historical snapshots require original sale even after formats disappear or flag switches off',() => {
  const historical=freezeLine({...product(false),cartId:'original-line',quantity:2,price:240},box);
  assert.throws(() => assertOriginalSaleForFormatReturn(historical,true),/ORIGINAL_SALE_REQUIRED/);
  assert.equal(historical.quantity,2);assert.equal(historical.baseQuantity,48);assert.equal(historical.articleFormat.factor,24);
});
test('runtime activation is still closed with company flag and terminal capability set',() => {
  assert.equal(formatsEnabled({featureFlags:{ARTICLE_FORMATS:true}},{capabilities:{article_formats:1}}),false);
  assert.ok(Object.values(ARTICLE_FORMATS_READINESS).every(value => value === false));
});
