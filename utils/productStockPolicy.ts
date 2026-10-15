/** Product checkbox policy only; terminal/global defaults cannot override an article's choice. */
export function requiresProductStockAvailability(product:{operationalFlags?:{trackInventory?:boolean;allowNegativeStock?:boolean}}):boolean {
 return product.operationalFlags?.trackInventory===true&&product.operationalFlags?.allowNegativeStock!==true;
}
