/** Convert the explicit lab catalog tax definitions to the actual V3 article wire shape. */
export function labArticleRecord(sale:any):any {
 if(!Array.isArray(sale.taxes)||sale.taxes.some((tax:any)=>!tax||typeof tax.id!=='string'))throw Error('LAB_CATALOG_TAX_INPUT_REQUIRED');
 return {...sale.article,taxIds:sale.taxes.map((tax:any)=>tax.id),active:true,sellable:true};
}
