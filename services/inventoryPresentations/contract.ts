import Decimal from 'decimal.js';

export const INVENTORY_PRESENTATIONS_CONTRACT='INVENTORY_PRESENTATIONS_V1' as const;
export type PresentationPrice=number|string;
export interface PresentationFormatSnapshot {schemaVersion:1;id:string;variantId:null;name:string;abbreviation:string;factor:number;barcode:string}
export interface PresentationFormat extends PresentationFormatSnapshot {active:boolean;isBase:boolean;allowSale:boolean;allowPurchase:boolean;defaultSale:boolean;defaultPurchase:boolean;sortOrder:number;prices:{tariffId:string;price:PresentationPrice}[]}
export interface InventoryPresentationMaster {schemaVersion:1;contextRevision:string|null;itemId:string;sku:string;name:string;inventoryQuantityUnit:'BASE';formats:PresentationFormat[];basePrices:{tariffId:string;price:PresentationPrice;taxIncluded:boolean}[];masterRevision:string}
export interface InventoryPresentation {schemaVersion:1;itemId:string;variantId:null;format:PresentationFormatSnapshot;commercialQuantity:number;baseQuantity:number;tariffId:string;masterRevision:string}
const D=Decimal.clone({precision:40,rounding:Decimal.ROUND_HALF_UP});
const need=(ok:unknown,code:string):void=>{if(!ok)throw Error(code);};
const record=(value:unknown):value is Record<string,any>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const exact=(value:unknown,keys:string[]):value is Record<string,any>=>record(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.prototype.hasOwnProperty.call(value,k));
const text=(value:unknown):value is string=>typeof value==='string'&&value.length>0;
const snapshotKeys=['schemaVersion','id','variantId','name','abbreviation','factor','barcode'];
const masterKeys=['schemaVersion','contextRevision','itemId','sku','name','inventoryQuantityUnit','formats','basePrices','masterRevision'];
const formatKeys=[...snapshotKeys,'active','isBase','allowSale','allowPurchase','defaultSale','defaultPurchase','sortOrder','prices'];
const decimal=(value:unknown):Decimal=>{
 need((typeof value==='number'&&Number.isFinite(value))||(typeof value==='string'&&value.trim().length>0),'INVENTORY_PRESENTATION_NUMBER_INVALID');
 try{const n=new D(value as Decimal.Value);if(n.isFinite())return n;}catch{/* deny below */}
 throw Error('INVENTORY_PRESENTATION_NUMBER_INVALID');
};
const factor=(value:unknown):number=>{
 need(typeof value==='number','INVENTORY_PRESENTATION_FACTOR_INVALID');const n=decimal(value);
 need(n.gt(0)&&n.dp()<=4&&n.lte('99999999999'),'INVENTORY_PRESENTATION_FACTOR_INVALID');return n.toNumber();
};
const price=(value:unknown):void=>{const n=decimal(value);need(n.gte(0)&&n.dp()<=4,'INVENTORY_PRESENTATION_PRICE_INVALID');};
/** ERP canonical JSON: sorted object keys, original array order and numeric/string representation. */
export function canonicalPresentationJson(value:unknown):string{
 const canonical=(v:unknown):unknown=>{
  if(Array.isArray(v))return v.map(canonical);
  if(record(v))return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));
  need(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v),'INVENTORY_PRESENTATION_JSON_INVALID');return v;
 };
 return JSON.stringify(canonical(value));
}
export async function inventoryPresentationRevision(value:unknown):Promise<string>{
 const bytes=new TextEncoder().encode(canonicalPresentationJson(value));
 const hash=await globalThis.crypto.subtle.digest('SHA-256',bytes);
 return Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('');
}
export function presentationBaseQuantity(quantity:number,formatFactor:number):number{
 need(typeof quantity==='number'&&Number.isFinite(quantity)&&quantity>0,'INVENTORY_PRESENTATION_QUANTITY_INVALID');
 const base=decimal(quantity).times(factor(formatFactor));
 need(base.dp()<=4&&base.lte('99999999999.9999'),'INVENTORY_PRESENTATION_BASE_INVALID');return base.toNumber();
}
/** Calculation only: callers must validate the master and select its own retained format first. */
export function presentationUnitPrice(format:PresentationFormat,tariffId:string,master:InventoryPresentationMaster):number{
 const base=master.basePrices.find(p=>p.tariffId===tariffId);need(base,'INVENTORY_PRESENTATION_TARIFF_FORBIDDEN');
 const override=format.prices.find(p=>p.tariffId===tariffId);
 const value=override?decimal(override.price):new Decimal(base!.price).times(factor(format.factor));
 need(Number.isFinite(value.toNumber()),'INVENTORY_PRESENTATION_PRICE_INVALID');return value.toNumber();
}
function assertSnapshot(value:unknown):asserts value is PresentationFormatSnapshot{
 need(exact(value,snapshotKeys),'INVENTORY_PRESENTATION_SNAPSHOT_INVALID');const f=value as Record<string,any>;
 need(f.schemaVersion===1&&text(f.id)&&f.variantId===null&&text(f.name)&&typeof f.abbreviation==='string'&&typeof f.barcode==='string','INVENTORY_PRESENTATION_SNAPSHOT_INVALID');factor(f.factor);
}
export function presentationFormatSnapshot(format:PresentationFormat):PresentationFormatSnapshot{
 const snapshot=Object.fromEntries(snapshotKeys.map(k=>[k,(format as any)[k]]));assertSnapshot(snapshot);return snapshot;
}
export async function validateInventoryPresentationMaster(value:unknown,expected?:{itemId?:string;contextRevision?:string|null}):Promise<InventoryPresentationMaster>{
 need(exact(value,masterKeys),'INVENTORY_PRESENTATION_MASTER_INVALID');const m=JSON.parse(canonicalPresentationJson(value)) as Record<string,any>;
 need(m.schemaVersion===1&&(m.contextRevision===null||text(m.contextRevision))&&text(m.itemId)&&typeof m.sku==='string'&&typeof m.name==='string'&&m.inventoryQuantityUnit==='BASE'&&typeof m.masterRevision==='string'&&/^[a-f0-9]{64}$/.test(m.masterRevision),'INVENTORY_PRESENTATION_MASTER_INVALID');
 need(!expected||(!expected.itemId||expected.itemId===m.itemId)&&(!Object.prototype.hasOwnProperty.call(expected,'contextRevision')||expected.contextRevision===m.contextRevision),'INVENTORY_PRESENTATION_MASTER_CHANGED');
 need(Array.isArray(m.formats)&&m.formats.length>0&&Array.isArray(m.basePrices)&&m.basePrices.length>0,'INVENTORY_PRESENTATION_MASTER_INVALID');
 const tariffs=new Set<string>();
 for(const p of m.basePrices){need(exact(p,['tariffId','price','taxIncluded'])&&text(p.tariffId)&&typeof p.taxIncluded==='boolean'&&!tariffs.has(p.tariffId),'INVENTORY_PRESENTATION_MASTER_INVALID');tariffs.add(p.tariffId);price(p.price);}
 const ids=new Set<string>();
 for(const f of m.formats){
  need(exact(f,formatKeys),'INVENTORY_PRESENTATION_MASTER_INVALID');assertSnapshot(Object.fromEntries(snapshotKeys.map(k=>[k,f[k]])));
  need(!ids.has(f.id)&&['active','isBase','allowSale','allowPurchase','defaultSale','defaultPurchase'].every(k=>typeof f[k]==='boolean')&&typeof f.sortOrder==='number'&&Number.isFinite(f.sortOrder)&&Array.isArray(f.prices),'INVENTORY_PRESENTATION_MASTER_INVALID');ids.add(f.id);
  const prices=new Set<string>();for(const p of f.prices){need(exact(p,['tariffId','price'])&&tariffs.has(p.tariffId)&&!prices.has(p.tariffId),'INVENTORY_PRESENTATION_MASTER_INVALID');prices.add(p.tariffId);price(p.price);}
 }
 const {masterRevision,...body}=m;need(await inventoryPresentationRevision(body)===masterRevision,'INVENTORY_PRESENTATION_MASTER_HASH_INVALID');
 return JSON.parse(JSON.stringify(m)) as InventoryPresentationMaster;
}
export async function validateInventoryPresentation(line:{quantity:number;price:PresentationPrice;originalPrice?:PresentationPrice;inventoryPresentation:unknown},input:unknown):Promise<InventoryPresentation>{
 line={...line,inventoryPresentation:JSON.parse(canonicalPresentationJson(line.inventoryPresentation))};
 const master=await validateInventoryPresentationMaster(input),p=line.inventoryPresentation;
 need(exact(p,['schemaVersion','itemId','variantId','format','commercialQuantity','baseQuantity','tariffId','masterRevision']),'INVENTORY_PRESENTATION_INVALID');const descriptor=p as Record<string,any>;
 need(descriptor.schemaVersion===1&&descriptor.itemId===master.itemId&&descriptor.variantId===null&&descriptor.masterRevision===master.masterRevision,'INVENTORY_PRESENTATION_MASTER_CHANGED');
 assertSnapshot(descriptor.format);const format=master.formats.find(f=>f.id===descriptor.format.id&&f.variantId===descriptor.variantId);
 need(format?.active===true&&format.allowSale===true,'INVENTORY_PRESENTATION_SALE_NOT_ALLOWED');
 need(canonicalPresentationJson(descriptor.format)===canonicalPresentationJson(presentationFormatSnapshot(format!)),'INVENTORY_PRESENTATION_SNAPSHOT_INVALID');
 need(descriptor.commercialQuantity===line.quantity&&typeof descriptor.baseQuantity==='number'&&descriptor.baseQuantity===presentationBaseQuantity(line.quantity,format!.factor),'INVENTORY_PRESENTATION_BASE_MISMATCH');
 need(decimal(line.originalPrice??line.price).eq(presentationUnitPrice(format!,descriptor.tariffId,master)),'INVENTORY_PRESENTATION_PRICE_MISMATCH');
 return JSON.parse(JSON.stringify(descriptor)) as InventoryPresentation;
}
