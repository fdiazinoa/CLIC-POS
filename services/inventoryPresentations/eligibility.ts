import type {CartItem,Product} from '../../types';
type Candidate=Partial<Product>&Partial<CartItem>;
/** V1 ingress supports one direct physical product movement, never recipes, variants or traceability. */
export function isInventoryPresentationEligible(product:Candidate):boolean{
 if(product.type!=='PRODUCT'||product.isInventoriable!==true)return false;
 if(['isWeighted','usesLots','usesSerial'].some(key=>product.operationalFlags?.[key as 'isWeighted'|'usesLots'|'usesSerial']===true))return false;
 if(['variantId','variantSku','trackingId','trackingCode','consignmentId','consignmentDocumentNo','consignmentLineId'].some(key=>Boolean(product[key as keyof Candidate])))return false;
 const arrays=[product.recipeDetails,product.variants,product.trackingData,product.modifiers,product.selected_modifiers,product.selected_fraction_parts,product.selected_combo_items];
 if(arrays.some(value=>value!==undefined&&(!Array.isArray(value)||value.length>0)))return false;
 if(product.fraction_rule||product.fractionRule||product.restaurant?.fraction_rule||product.restaurant?.fractionRule)return false;
 return [product.product_type,product.restaurant?.product_type,product.restaurant?.productType].every(value=>value===undefined||value==='SIMPLE'||value==='PRODUCT');
}
export function assertInventoryPresentationEligible(product:Candidate):void{
 if(!isInventoryPresentationEligible(product))throw Error('INVENTORY_PRESENTATION_DIRECT_PRODUCT_REQUIRED');
}
