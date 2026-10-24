import type { Product, CartItem, ComboGroup, ModifierGroup, ProductFractionRule } from '../types';
import { resolveRestaurantProductConfig } from './restaurantProductConfig';
import { resolveVariantSalesPrice } from './variantSalesPrice';
const need=(ok:unknown):void=>{if(!ok)throw Error('SYNC_V3_RESTAURANT_SELECTION_INVALID');};
const record=(v:unknown):Record<string,any>=>{need(v&&typeof v==='object'&&!Array.isArray(v));return v as Record<string,any>;};
const text=(v:unknown,max=256):string=>{need(typeof v==='string'&&v.trim().length>0&&v.length<=max);return v as string;};
const amount=(v:unknown):number=>{need(typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=100000000);return v as number;};
const count=(v:unknown,fallback:number):number=>{if(v==null)return fallback;need(Number.isSafeInteger(v)&&Number(v)>=0&&Number(v)<=100);return Number(v);};
const list=(v:unknown):any[]=>{if(v==null)return [];need(Array.isArray(v)&&v.length<=100);return v as any[];};
const unique=(rows:any[],key:(row:any)=>string)=>{const ids=rows.map(key);need(new Set(ids).size===ids.length);};

/** Versioned immutable selection authority. Inactive editor defaults have no sale semantics. */
export function normalizeV3RestaurantSelection(value:unknown):Pick<Product,'product_type'|'production_area_id'|'combo_groups'|'modifier_groups'|'fraction_rule'|'note_presets'> {
 const source=record(value),type=String(source.product_type||'SIMPLE');need(['SIMPLE','SERVICE','COMBO','FRACTIONABLE'].includes(type));
 const group=(raw:any,kind:'items'|'modifiers')=>{
  const g=record(raw);need((g.active===undefined||typeof g.active==='boolean')&&(g.required===undefined||typeof g.required==='boolean')&&(g.selection_type===undefined||['SINGLE','MULTIPLE'].includes(g.selection_type)));need(Object.keys(g).every(k=>['id','name','active','required','min_select','max_select','free_quantity','sort_order','selection_type',kind].includes(k)));
  const rows=list(g[kind]).filter(row=>record(row).active!==false).map(rawOption=>{
   const o=record(rawOption);need((o.active===undefined||typeof o.active==='boolean')&&(o.affects_price===undefined||typeof o.affects_price==='boolean'));need(Object.keys(o).every(k=>['id','name','active','sort_order','product_id','price','price_delta','affects_price','modifier_type'].includes(k)));text(o.id||o.product_id,128);text(o.name);amount(o.price_delta??o.price??0);
   if(kind==='items')text(o.product_id,128);
   if(kind==='modifiers')need(!o.modifier_type||['ADD','REMOVE','NOTE_PRESET'].includes(o.modifier_type));
   return {...o};
  });unique(rows,o=>String(o.id||o.product_id));
  const minimum=count(g.min_select,g.required?1:0),maximum=count(g.max_select,kind==='modifiers'&&g.selection_type==='SINGLE'?1:100);
  need(minimum<=maximum&&minimum<=rows.length&&(!g.required||minimum>=1));text(g.id,128);text(g.name);
  return {...g,[kind]:rows,min_select:minimum,max_select:g.max_select==null?null:maximum,free_quantity:count(g.free_quantity,0)};
 };
 const combos=list(source.combo_groups).filter(g=>record(g).active!==false).map(g=>group(g,'items')) as unknown as ComboGroup[];
 const modifiers=list(source.modifier_groups).filter(g=>record(g).active!==false).map(g=>group(g,'modifiers')) as unknown as ModifierGroup[];
 unique(combos,g=>g.id);unique(modifiers,g=>g.id);
 let fraction:ProductFractionRule|undefined;
 if(source.fraction_rule&&record(source.fraction_rule).enabled!==false){
  const f=record(source.fraction_rule),options=list(f.options).filter(o=>record(o).active!==false);
  if(options.length){need(['HIGHEST_PRICE','AVERAGE_PRICE','SUM_PARTS','BASE_PLUS_DIFF'].includes(f.pricing_rule));const parts=count(f.max_parts,2);need(parts>=2&&parts<=16);options.forEach(o=>{text(o.option_product_id||o.product_id||o.id,128);text(o.name);amount(o.price_override??o.price);});unique(options,o=>String(o.option_product_id||o.product_id||o.id));fraction={...f,options,max_parts:parts};}
 }
 if(type==='FRACTIONABLE')need(fraction);
 const notes=list(source.note_presets);notes.forEach(n=>text(n,1000));
 if(source.production_area_id!=null)text(source.production_area_id,128);
 return {product_type:type as Product['product_type'],...(source.production_area_id?{production_area_id:source.production_area_id}:{}),combo_groups:combos,modifier_groups:modifiers,...(fraction?{fraction_rule:fraction}:{}),note_presets:notes};
}

/** Derive price and persisted option snapshots only from the pinned source, never client deltas. */
export function validateV3RestaurantSelection(line:CartItem,product:Product):number {
 const source=resolveRestaurantProductConfig(product),selected=line.restaurantConfig;
 let variantPrice=product.price,variantLabels:string[][]|undefined;
 if(line.variantId||line.variantSku){
  const variants=product.variants||[];
  const matches=variants.filter(variant=>line.variantId?variant.id===line.variantId:variant.sku===line.variantSku);
  need(matches.length===1&&(!line.variantSku||matches[0].sku===line.variantSku));
  const variant=matches[0],values=variant.attributeValues||{};
  // Scanner uses the selected record's order; the selector uses the pinned union of attribute keys.
  const keys=Array.from(new Set(variants.flatMap(row=>Object.keys(row.attributeValues||{}))));
  variantLabels=[Object.values(values).map(String),keys.map(key=>values[key]||values[key.toLowerCase()]||values[key.toUpperCase()]).filter(Boolean)];
  if(!keys.length)variantLabels.push([variant.sku]);
  variantPrice=resolveVariantSalesPrice(variant,product.price);
 }
 const advanced=source.combo_groups.length||source.modifier_groups.length||source.fraction_rule?.options?.length||source.note_presets.length;
 if (!advanced) {
  const simpleRoute = source.product_type === 'SIMPLE' || source.product_type === 'SERVICE';
  const emptyArray = (value: unknown) => value === undefined || value === null && simpleRoute || Array.isArray(value) && value.length === 0;
  const emptyMap = (value: unknown) => value === undefined || value === null && simpleRoute || Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
  need(emptyArray(line.selected_combo_items) && emptyArray(line.selected_modifiers)
   && emptyArray(line.selected_fraction_parts));
  // Existing V3 barcode lines had no display labels; their pinned identity still selects the variant.
  const legacyVariantLabels = Boolean(variantLabels && emptyArray(line.modifiers));
  need(variantLabels?legacyVariantLabels||Array.isArray(line.modifiers)&&variantLabels.some(labels=>JSON.stringify(labels)===JSON.stringify(line.modifiers)):emptyArray(line.modifiers));
  need(selected !== null || simpleRoute);
  if (selected != null) {
   const s = record(selected);
   need(Object.keys(s).every(key => ['product_type', 'production_area_id', 'comboGroups', 'modifierGroups',
    'fractions', 'selected_combo_items', 'selected_modifiers', 'selected_fraction_parts', 'note'].includes(key)));
   need((s.product_type === undefined && simpleRoute || s.product_type === source.product_type)
    && s.production_area_id === source.production_area_id);
   need(emptyMap(s.comboGroups) && emptyMap(s.modifierGroups) && emptyArray(s.fractions)
    && emptyArray(s.selected_combo_items) && emptyArray(s.selected_modifiers) && emptyArray(s.selected_fraction_parts));
   need(s.note === undefined || typeof s.note === 'string' && s.note.length <= 2000 && s.note === line.note);
  }
  if(variantLabels)need(Number.isFinite(line.price)&&line.price>=0&&line.price<=variantPrice+.01
   &&(Math.abs(Number(line.originalPrice??line.price)-variantPrice)<.02
    ||legacyVariantLabels&&Math.abs(Number(line.originalPrice??line.price)-product.price)<.02));
  return variantPrice;
 }
 need(selected);const s=record(selected);need(Object.keys(s).every(k=>['modifierGroups','comboGroups','fractions','selected_modifiers','selected_fraction_parts','selected_combo_items','product_type','production_area_id','note'].includes(k)));let extra=0;
 const pick=(groups:any[],mapping:unknown,kind:'items'|'modifiers')=>{
  const map=mapping==null?{}:record(mapping);need(Object.keys(map).every(id=>groups.some(g=>g.id===id)));
  return groups.flatMap(g=>{
   const ids=list(map[g.id]);need(ids.every(id=>typeof id==='string')&&new Set(ids).size===ids.length);
   need(ids.length>=Math.max(g.required?1:0,g.min_select||0)&&ids.length<=(g.max_select??(g.selection_type==='SINGLE'?1:100)));
   let free=g.free_quantity||0;
   return ids.map(id=>{const matches=g[kind].filter((o:any)=>String(o.id||o.product_id)===id);need(matches.length===1);const o=matches[0];
    if(kind==='items'){extra+=Number(o.price_delta||0);return {group_id:g.id,group_name:g.name,item_id:o.id||o.product_id,product_id:o.product_id,name:o.name||o.product_id,price_delta:Number(o.price_delta||0)};}
    if(o.modifier_type!=='REMOVE'&&o.affects_price!==false){if(free>0)free--;else extra+=Number(o.price_delta??o.price??0);}
    return {group_id:g.id,group_name:g.name,modifier_id:o.id,product_id:o.product_id,name:o.name,modifier_type:o.modifier_type||'ADD',affects_price:o.affects_price!==false,price_delta:Number(o.price_delta??o.price??0)};
   });
  });
 };
 const combos=pick(source.combo_groups,s.comboGroups,'items'),modifiers=pick(source.modifier_groups,s.modifierGroups,'modifiers');
 const canonical=(v:unknown):string=>JSON.stringify(v,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
 need(canonical(s.selected_combo_items||[])===canonical(combos)&&canonical(s.selected_modifiers||[])===canonical(modifiers));
 need(canonical(line.selected_combo_items||[])===canonical(combos)&&canonical(line.selected_modifiers||[])===canonical(modifiers));
 let base=variantPrice;
 const rule=source.fraction_rule;
 if(rule?.options?.length){
  const parts=list(s.selected_fraction_parts);need(parts.length===rule.max_parts||source.product_type!=='FRACTIONABLE'&&parts.length===0);const prices=parts.map(part=>{const o=rule.options!.find(option=>String(option.option_product_id||option.product_id||option.id)===part.id);need(o);const price=Number(o!.price_override??o!.price);need(part.ratio===1/parts.length&&part.price===price&&part.product_id===(o!.product_id||o!.option_product_id)&&part.name===(o!.name||part.id));return price;});
  need(canonical(line.selected_fraction_parts||[])===canonical(parts));
  if(parts.length)base=['AVERAGE_PRICE','SUM_PARTS'].includes(String(rule.pricing_rule))?prices.reduce((sum,p)=>sum+p,0)/parts.length:rule.pricing_rule==='BASE_PLUS_DIFF'?Math.max(product.price,...prices):Math.max(...prices);
 }else need(!list(s.selected_fraction_parts).length&&!line.selected_fraction_parts?.length);
 need(s.product_type===source.product_type&&s.production_area_id===source.production_area_id);
 need(!s.note||typeof s.note==='string'&&s.note.length<=2000);need((line.note||undefined)===(s.note||undefined));
 const price=Math.round((base+extra)*100)/100;
 // Existing price/discount authorizations still own explicit reductions; surcharge source remains pinned.
 need(Number.isFinite(line.price)&&line.price>=0&&Math.abs(Number(line.originalPrice??line.price)-price)<.02&&line.price<=price+.01);
 return price;
}
