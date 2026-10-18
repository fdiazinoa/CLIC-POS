import type {CartItem,Product,Transaction} from '../../types';
import {inventoryQuantity as legacyQuantity,resizeLine} from '../articleFormats/domain';
import {canonicalPresentationJson,presentationBaseQuantity,type InventoryPresentation,type InventoryPresentationMaster} from './contract';
export const hasInventoryPresentation=(value:{inventoryPresentation?:unknown})=>value.inventoryPresentation!==undefined;
export function assertInventoryPresentationReturnAllowed(value:Partial<Transaction>|Partial<CartItem>|Partial<Product>){
 if((value as any).inventoryPresentationContract!==undefined||(value as any).inventoryPresentation!==undefined||(value as any).inventoryPresentationMaster||(value as any).items?.some(hasInventoryPresentation))throw Error('INVENTORY_PRESENTATION_SOURCE_REQUIRED_NOT_YET_SUPPORTED');
}
export function resizeInventoryPresentationLine<T extends CartItem>(line:T,quantity:number):T{
 if(!line.inventoryPresentation)return resizeLine(line,quantity);
 return {...line,quantity,inventoryPresentation:{...line.inventoryPresentation,commercialQuantity:quantity,baseQuantity:presentationBaseQuantity(quantity,line.inventoryPresentation.format.factor)}};
}
export function normalizePresentationDraft(lines:CartItem[]):CartItem[]{
 let changed=false;const result=lines.map(line=>{
  if(!line.inventoryPresentation)return line;
  const p=line.inventoryPresentation,base=presentationBaseQuantity(line.quantity,p.format.factor);
  if(p.commercialQuantity===line.quantity&&p.baseQuantity===base)return line;
  changed=true;return resizeInventoryPresentationLine(line,line.quantity);
 });return changed?result:lines;
}
export function presentationInventoryQuantity(line:CartItem):number{
 const p=line.inventoryPresentation;if(!p)return legacyQuantity(line);
 const base=presentationBaseQuantity(line.quantity,p.format.factor);
 if(p.commercialQuantity!==line.quantity||p.baseQuantity!==base)throw Error('INVENTORY_PRESENTATION_BASE_MISMATCH');return base;
}
export const presentationIdentity=(itemId:string,p:InventoryPresentation,authority:unknown)=>canonicalPresentationJson([itemId,p.masterRevision,p.format,p.tariffId,authority]);
export function presentationSelectorDTO(master:InventoryPresentationMaster):import('../articleFormats/contract').ArticleFormatsDTO{
 return {schema_version:1,inventory_quantity_unit:'BASE',item_id:master.itemId,formats:master.formats.map(f=>({schemaVersion:1,id:f.id,variantId:null,name:f.name,abbreviation:f.abbreviation,factor:f.factor,barcode:f.barcode,active:f.active,is_base:f.isBase,allow_sale:f.allowSale,allow_purchase:f.allowPurchase,allow_transfer:false,default_sale:f.defaultSale,default_purchase:f.defaultPurchase,sort_order:f.sortOrder,prices:f.prices.map(p=>({tariffId:p.tariffId,price:Number(p.price)}))}))};
}
export function inventoryPresentationTicketLabel(item:Pick<CartItem,'inventoryPresentation'>):string{
 const p=item.inventoryPresentation;return p?`${p.format.name} · ${p.format.factor} base · ${p.baseQuantity} unidades`:'';
}
export const inventoryPresentationTicketHTML=(item:Pick<CartItem,'inventoryPresentation'>)=>inventoryPresentationTicketLabel(item).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
