import Decimal from 'decimal.js';
const D=Decimal.clone({precision:50});
const object=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const array=v=>Array.isArray(v)?v:[];
const text=v=>typeof v==='string'?v.trim():'';
const fail=code=>{throw Error(code);};
const decimal=(value,code)=>{let n;try{n=new D(String(value));}catch{fail(code);}if(!n.isFinite()||n.lte(0))fail(code);return n;};
/** Existing POS mode selection, kept pure so the new retained-source compiler and
 * the operational inventory engine agree without sharing legacy mutable reads. */
export function dispatchInventoryConsumptionMode(item){
 const mode=text(item?.kitInventoryMode).toUpperCase(),details=array(item?.recipeDetails),type=String(item?.type||'').trim().toUpperCase();
 if(mode==='FINISHED_GOOD')return'DIRECT';if(mode==='COMPONENT_CONSUMPTION')return'COMPONENTS';
 if(!details.length)return'DIRECT';if(type==='RECETA')return'COMPONENTS';if(type==='KIT')return item?.isInventoriable===false?'COMPONENTS':'DIRECT';return'COMPONENTS';
}
const unit=v=>{const s=text(v).toLowerCase();return({unidad:'un',unidades:'un',und:'un',ud:'un',unit:'un',units:'un',gramo:'gr',gramos:'gr',g:'gr',kilogramo:'kg',kilogramos:'kg',litro:'l',litros:'l',mililitro:'ml',mililitros:'ml'})[s]||s;};
const variants=raw=>array(object(raw.metadata).variants);
const stock=raw=>{const m=object(raw.metadata),f=object(m.operationalFlags||m.operational_flags);return!['SERVICE','SERVICIO'].includes(text(raw.type).toUpperCase())&&(m.isInventoriable??m.is_inventoriable)!==false&&f.trackInventory!==false;};
const tracking=raw=>{const m=object(raw.metadata),f=object(m.operationalFlags||m.operational_flags),o=object(m.operations);return f.usesSerial===true||f.usesSerialNumbers===true||o.tracks_serials===true||m.is_serialized===true?'SERIAL':f.usesLots===true||o.tracks_lots===true?'LOT':null;};
// Carry rational quantities through the entire graph. Decimal division at an
// intermediate recipe yield would round 1/3 before a later factor cancels it.
const gcd=(a,b)=>{while(b){const r=a%b;a=b;b=r;}return a;};
const fraction=n=>{if(n.e>18||n.e< -18||n.sd()>30)fail('DISPATCH_RECIPE_QUANTITY_RANGE');const parts=n.toFixed().split('.'),den=10n**BigInt(parts[1]?.length||0),num=BigInt(parts.join(''));const g=gcd(num,den);return{num:num/g,den:den/g};};
const multiply=(a,b)=>{const num=a.num*b.num,den=a.den*b.den,g=gcd(num,den);return{num:num/g,den:den/g};};
const divide=(a,b)=>multiply(a,{num:b.den,den:b.num});
const minor=n=>{const scaled=n.num*1000000n;if(scaled%n.den!==0n)fail('DISPATCH_DEMAND_NOT_BASE4_REPRESENTABLE');const value=scaled/n.den;if(value>BigInt(Number.MAX_SAFE_INTEGER)||value%100n!==0n)fail('DISPATCH_DEMAND_NOT_BASE4_REPRESENTABLE');return Number(value);};
/** Only issuer-retained raw records are accepted here. Never use sale-carried
 * recipeDetails or a generic operational lookup that hides nonsellable children.
 * The result contains physical quantities, not sale-time valuation. */
export function compileCompanyDispatchDemand(catalog,line){
 if(!catalog?.scope?.tenantId||!catalog.scope.companyId||!Array.isArray(catalog.items)||catalog.items.length>2000)fail('DISPATCH_CATALOG_GRAPH_REQUIRED');
 const nodes=new Map();for(const raw of catalog.items){if(!raw?.id||nodes.has(raw.id)||raw.tenant_id!==catalog.scope.tenantId||raw.company_id!==null&&raw.company_id!==catalog.scope.companyId)fail('DISPATCH_CATALOG_GRAPH_SCOPE');nodes.set(raw.id,raw);}
 const root=nodes.get(line.itemId);if(!root||root.is_active===false)fail('DISPATCH_COMMERCIAL_ITEM_NOT_ISSUED');
 const quantity=decimal(line.quantity,'DISPATCH_COMMERCIAL_QUANTITY_INVALID');if(quantity.dp()>4)fail('DISPATCH_COMMERCIAL_QUANTITY_PRECISION');
 const metadata=object(root.metadata),formats=metadata.articleFormats,snapshot=line.articleFormat;
 let factor=new D(1);
 if(snapshot){const format=array(formats).find(f=>f.id===snapshot.id);if(format){if(format.active!==true||format.allowSale!==true||String(format.variantId??'')!==String(snapshot.variantId??'')||!decimal(format.factor,'DISPATCH_FORMAT_FACTOR_INVALID').eq(snapshot.factor))fail('DISPATCH_FORMAT_SOURCE_MISMATCH');factor=decimal(format.factor,'DISPATCH_FORMAT_FACTOR_INVALID');}
 else if(formats!==undefined||snapshot.id!=='base:'+String(snapshot.variantId||'item')||!decimal(snapshot.factor,'DISPATCH_FORMAT_FACTOR_INVALID').eq(1))fail('DISPATCH_FORMAT_SOURCE_MISMATCH');
 if(String(snapshot.variantId||'')!==String(line.variantId||''))fail('DISPATCH_FORMAT_VARIANT_MISMATCH');}
 else if(formats!==undefined)fail('DISPATCH_FORMAT_SNAPSHOT_REQUIRED');
 const result=new Map();const visit=(raw,amount,path,variantId,isRoot)=>{
  if(path.includes(raw.id)||path.length>=32)fail('DISPATCH_RECIPE_CYCLE_OR_DEPTH');
  const m=object(raw.metadata),f=object(m.operationalFlags||m.operational_flags);if(raw.is_active===false)fail('DISPATCH_RECIPE_CHILD_INACTIVE');
  if(['SERVICE','SERVICIO'].includes(text(raw.type).toUpperCase()))return;
  const details=m.recipeDetails??m.recipe_details??[];if(!Array.isArray(details))fail('DISPATCH_RECIPE_DETAILS_INVALID');
  const inventoriable=(m.isInventoriable??m.is_inventoriable)!==false&&f.trackInventory!==false;
  const mode=dispatchInventoryConsumptionMode({type:raw.type,recipeDetails:details,isInventoriable:inventoriable,kitInventoryMode:m.kitInventoryMode||m.kit_inventory_mode});
  if(!inventoriable&&text(raw.type).toUpperCase()!=='KIT'){if(mode==='COMPONENTS')fail('DISPATCH_NON_INVENTORY_COMPONENT_CONTRACT_UNPROVEN');return;}
  if(mode==='COMPONENTS'){
   if(!details.length)fail('DISPATCH_RECIPE_DETAILS_REQUIRED');
   const yieldQuantity=decimal(m.batchYield??m.batch_yield??1,'DISPATCH_RECIPE_YIELD_INVALID');
   for(const detail of details){if(!detail||typeof detail!=='object'||['waste','wastePercent','wastePercentage','optional','isOptional','bomVariantId','variantId','variant_id'].some(k=>detail[k]!==undefined&&detail[k]!==false&&detail[k]!==0&&detail[k]!==null&&detail[k]!==''))fail('DISPATCH_RECIPE_SEMANTICS_UNPROVEN');
    const ref=text(detail.childItemId||detail.child_item_id||detail.productId||detail.product_id||detail.childSku||detail.child_sku),matches=[...nodes.values()].filter(n=>n.id===ref||n.sku===ref);if(!ref||matches.length!==1)fail('DISPATCH_RECIPE_CHILD_MISSING_OR_AMBIGUOUS');const child=matches[0],childMeta=object(child.metadata);
    if(variants(child).length)fail('DISPATCH_RECIPE_CHILD_VARIANT_UNPROVEN');
    let required=fraction(decimal(detail.quantity,'DISPATCH_RECIPE_QUANTITY_INVALID'));const conversion=decimal(detail.conversionFactor??detail.conversion_factor??1,'DISPATCH_RECIPE_CONVERSION_INVALID');
    const from=unit(detail.unit||detail.measurementUnit),original=unit(detail.originalUnit||detail.original_unit),target=unit(childMeta.measurementUnit||childMeta.measurement_unit||child.uom||'Unidad');
    if(original&&original!==from){if(original!==target||!from)fail('DISPATCH_RECIPE_UOM_UNPROVEN');required=multiply(required,fraction(conversion));}
    else if(!conversion.eq(1)||from&&from!==target)fail('DISPATCH_RECIPE_UOM_UNPROVEN');
    visit(child,divide(multiply(amount,required),fraction(yieldQuantity)),[...path,raw.id],'',false);
   }return;
  }
  if(!stock(raw))return;if(raw.company_id!==catalog.scope.companyId)fail('DISPATCH_SHARED_OR_FOREIGN_STOCK_ITEM');
  const choices=variants(raw);if(choices.length){if(!isRoot||!variantId||!choices.some(v=>String(v.id||v.variant_id||v.sku)===variantId))fail('DISPATCH_VARIANT_SELECTION_REQUIRED');}else if(variantId)fail('DISPATCH_VARIANT_NOT_ISSUED');
  const dimensions=variantId?{variantId}:{},key=raw.id+'|'+JSON.stringify(dimensions),previous=result.get(key),quantityMinor=minor(amount);if(quantityMinor<=0)fail('DISPATCH_DEMAND_QUANTITY_INVALID');const combined=(previous?.quantityMinor||0)+quantityMinor;if(!Number.isSafeInteger(combined))fail('DISPATCH_DEMAND_OVERFLOW');result.set(key,{itemId:raw.id,dimensions,quantityMinor:combined,trackingKind:tracking(raw),paths:[...(previous?.paths||[]),[...path,raw.id]]});
 };
 visit(root,multiply(fraction(quantity),fraction(factor)),[],line.variantId||'',true);
 return{schemaVersion:1,source:'ISSUED_RAW_GRAPH_BASE6_V1',commercialItemId:root.id,commercialQuantity:quantity.toNumber(),formatFactor:factor.toNumber(),demands:[...result.values()].sort((a,b)=>(a.itemId+'|'+JSON.stringify(a.dimensions)).localeCompare(b.itemId+'|'+JSON.stringify(b.dimensions))),nonStockReason:result.size?null:['SERVICE','SERVICIO'].includes(text(root.type).toUpperCase())?'CANONICAL_SERVICE':'CANONICAL_NON_STOCK_GRAPH'};
}
