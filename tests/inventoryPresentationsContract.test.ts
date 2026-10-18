import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {buildInventoryPresentationMaster,validateInventoryPresentation as erpValidate,presentationRevision} from './fixtures/inventoryPresentations/erp/server/services/inventoryPresentations.js';
import {snapshotArticleFormat} from './fixtures/inventoryPresentations/erp/shared/articleFormats.js';
import {validateInventoryPresentationMaster,validateInventoryPresentation,inventoryPresentationRevision,canonicalPresentationJson,presentationBaseQuantity,presentationUnitPrice} from '../services/inventoryPresentations/contract';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tariff=id(2),itemId='a9c3a44f-4049-468a-8278-d937d8057fa6';
function fixture(contextRevision:string|null=null){
 const unit={id:id(3),variantId:null,name:'Unidad',abbreviation:'UN',factor:1,barcode:'',active:true,isBase:true,allowSale:true,allowPurchase:false,defaultSale:false,defaultPurchase:false,sortOrder:0,prices:[{tariffId:tariff,price:85}]};
 const pack={...unit,id:'3d0be41c-3b24-4cda-9b18-b4824738f9b3',name:'Pack',abbreviation:'PK',factor:12,isBase:false,defaultSale:true,sortOrder:1,prices:[{tariffId:tariff,price:250}]};
 const item={id:itemId,sku:'BEB-003',nombre:'Agua',precio_venta:85,metadata:{articleFormats:[unit,pack]}};
 const master=buildInventoryPresentationMaster(item,[{id:tariff,tax_included:false}],{contextRevision});
 const line=(index=1,quantity=1)=>({quantity,price:index===0?85:250,inventoryPresentation:{schemaVersion:1,itemId,variantId:null,format:snapshotArticleFormat(master.formats[index]),commercialQuantity:quantity,baseQuantity:quantity*master.formats[index].factor,tariffId:tariff,masterRevision:master.masterRevision}});
 return {master,line,item};
}
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
const rehash=(m:any)=>{const {masterRevision:_,...body}=m;m.masterRevision=presentationRevision(body);return m;};
test('fixture is pinned to exact real ERP producer source; no wrappers or runtime imports',()=>{
 for(const [path,hash]of [['erp/server/services/inventoryPresentations.js','4baa53d303f2daa677a4b7c7ab9c84bb8ab4cc5d739dfd5c0f1265b4b1900950'],['erp/shared/articleFormats.js','9294c30a9d27d63ea5c3ac2db2f66ada780fbc5867b6115e3d50771590bc9b39']]){
  assert.equal(createHash('sha256').update(readFileSync(new URL('./fixtures/inventoryPresentations/'+path,import.meta.url))).digest('hex'),hash);
 }
});
for(const contextRevision of [null,'c'.repeat(64)])test(`real producer master and line validate with contextRevision=${contextRevision===null?'null':'bound'}`,async()=>{
 const f=fixture(contextRevision),before=JSON.stringify(f);
 const master=await validateInventoryPresentationMaster(f.master,{itemId,contextRevision});assert.deepEqual(master,f.master);
 for(const index of [0,1]){const line=f.line(index);assert.deepEqual(await validateInventoryPresentation(line,master),erpValidate(line,f.master));}
 assert.equal(JSON.stringify(f),before);
});
test('canonical hash preserves array order and number/string values, sorts nested object keys and excludes only masterRevision at master boundary',async()=>{
 const f=fixture();const {masterRevision,...body}=f.master;
 assert.equal(await inventoryPresentationRevision(body),masterRevision);
 assert.equal(await inventoryPresentationRevision(body),presentationRevision(body));
 const reversed=Object.fromEntries(Object.entries(body).reverse());assert.equal(await inventoryPresentationRevision(reversed),masterRevision);
 const ordered=clone(f.master);ordered.formats.reverse();await assert.rejects(validateInventoryPresentationMaster(ordered),/HASH/);
 const changed=clone(f.master);changed.formats[0].prices[0].price='85' as any;await assert.rejects(validateInventoryPresentationMaster(changed),/HASH/);
 rehash(changed);const parsed=await validateInventoryPresentationMaster(changed);assert.equal(typeof parsed.formats[0].prices[0].price,'string');
 assert.notEqual(await inventoryPresentationRevision({...body,contextRevision:'changed'}),masterRevision);
 assert.notEqual(await inventoryPresentationRevision(f.master),masterRevision);
 assert.notEqual(canonicalPresentationJson([85,'85']),canonicalPresentationJson(['85',85]));
});
test('commercial Unit85 plus Pack250 preserves1+1 quantities and335 subtotal with13BASE;2Packs=500/24BASE',async()=>{
 const f=fixture(),master=await validateInventoryPresentationMaster(f.master);let base=0,total=0;
 for(const index of [0,1]){const line=f.line(index),p=await validateInventoryPresentation(line,master);base+=p.baseQuantity;total+=line.price*line.quantity;assert.equal(p.commercialQuantity,1);}
 assert.equal(base,13);assert.equal(total,335);assert.equal(presentationUnitPrice(master.formats[1],tariff,master),250);assert.notEqual(presentationUnitPrice(master.formats[1],tariff,master),1020);
 const two=f.line(1,2);assert.equal((await validateInventoryPresentation(two,master)).baseQuantity,24);assert.equal(two.quantity*two.price,500);
});
test('tariff-specific zero/override win; actual producer fallback uses base price times factor',async()=>{
 for(const override of [0,'250.0000',undefined]){
  const f=fixture();f.item.metadata.articleFormats[1].prices=override===undefined?[]:[{tariffId:tariff,price:override as any}];const master=buildInventoryPresentationMaster(f.item,[{id:tariff,tax_included:false}]);
  const expected=override===undefined?1020:Number(override),line={...f.line(),price:expected,inventoryPresentation:{...f.line().inventoryPresentation,masterRevision:master.masterRevision}};
  assert.equal(presentationUnitPrice(master.formats[1],tariff,await validateInventoryPresentationMaster(master)),expected);
  assert.deepEqual(await validateInventoryPresentation(line,master),erpValidate(line,master));
 }
});
for(const [name,mutate]of Object.entries({missing:(m:any)=>{delete m.contextRevision;},extra:(m:any)=>{m.capability=true;},schema:(m:any)=>{m.schemaVersion=2;},unit:(m:any)=>{m.inventoryQuantityUnit='PACK';},context:(m:any)=>{m.contextRevision=17;},formatExtra:(m:any)=>{m.formats[0].allowTransfer=true;},formatMissing:(m:any)=>{delete m.formats[0].barcode;},variant:(m:any)=>{m.formats[1].variantId=id(90);},duplicate:(m:any)=>{m.formats.push(clone(m.formats[0]));},priceExtra:(m:any)=>{m.basePrices[0].currency='DOP';},priceNegative:(m:any)=>{m.formats[1].prices[0].price=-1;},pricePrecision:(m:any)=>{m.basePrices[0].price='0.00001';},factorZero:(m:any)=>{m.formats[1].factor=0;},factorPrecision:(m:any)=>{m.formats[1].factor=.00001;},factorOverflow:(m:any)=>{m.formats[1].factor=1e11;},priceForeignTariff:(m:any)=>{m.formats[1].prices[0].tariffId=id(90);}}))test(`master ${name} denied even with a recomputed hash`,async()=>{
 const m=fixture().master;mutate(m);rehash(m);await assert.rejects(validateInventoryPresentationMaster(m));
});
for(const [name,mutate]of Object.entries({extra:(l:any)=>{l.inventoryPresentation.other=true;},missing:(l:any)=>{delete l.inventoryPresentation.baseQuantity;},schema:(l:any)=>{l.inventoryPresentation.schemaVersion=2;},item:(l:any)=>{l.inventoryPresentation.itemId=id(99);},revision:(l:any)=>{l.inventoryPresentation.masterRevision='d'.repeat(64);},variant:(l:any)=>{l.inventoryPresentation.variantId=id(90);},formatExtra:(l:any)=>{l.inventoryPresentation.format.active=true;},factor:(l:any)=>{l.inventoryPresentation.format.factor=1;},id:(l:any)=>{l.inventoryPresentation.format.id='invented';},base:(l:any)=>{l.inventoryPresentation.baseQuantity=1;},commercial:(l:any)=>{l.inventoryPresentation.commercialQuantity=12;},tariff:(l:any)=>{l.inventoryPresentation.tariffId=id(99);},wrongPrice:(l:any)=>{l.price=1020;},negative:(l:any)=>{l.quantity=-1;},nonfinite:(l:any)=>{l.quantity=Infinity;},zero:(l:any)=>{l.quantity=0;}}))test(`line ${name} fails closed and does not mutate the original`,async()=>{
 const f=fixture(),line=f.line();mutate(line);const before=JSON.stringify(line);await assert.rejects(validateInventoryPresentation(line,f.master));assert.equal(JSON.stringify(line),before);
});
test('inactive/non-sale format, foreign expected identity/context and precision/overflow are denied without rounding',async()=>{
 for(const key of ['active','allowSale']){const f=fixture();(f.master.formats[1] as any)[key]=false;rehash(f.master);const line=f.line();await assert.rejects(validateInventoryPresentation(line,f.master),/SALE_NOT_ALLOWED/);}
 const f=fixture();await assert.rejects(validateInventoryPresentationMaster(f.master,{itemId:id(99)}),/MASTER_CHANGED/);await assert.rejects(validateInventoryPresentationMaster(f.master,{contextRevision:'foreign'}),/MASTER_CHANGED/);
 assert.equal(presentationBaseQuantity(.125,12),1.5);assert.equal(presentationBaseQuantity(.0001,1),.0001);
 for(const [quantity,factor]of [[.0001,.0001],[1,0],[1,-1],[1,.00001],[1,1e11],[1e11,1],[1,-Infinity]])assert.throws(()=>presentationBaseQuantity(quantity,factor));
});
test('pending hash validation cannot return caller mutations as validated source',async()=>{
 const f=fixture(),pending=validateInventoryPresentationMaster(f.master);f.master.formats[1].factor=99;const retained=await pending;assert.equal(retained.formats[1].factor,12);
 const g=fixture(),line=g.line(),validation=validateInventoryPresentation(line,g.master);line.inventoryPresentation.baseQuantity=999;assert.equal((await validation).baseQuantity,12);
});
