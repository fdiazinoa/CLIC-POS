import {freezeLine,snapshot as issuedFormatSnapshot} from '../articleFormats/domain';
import type {CartItem} from '../../types';
/** Derive only a canonical issued BASE snapshot; never edit the cart or reprice. */
export function issuedBaseLine(line:CartItem,catalog:any):CartItem{
 if(line.articleFormat!=null)return line;
 const master=catalog.commercialItem,formats=master.metadata?.articleFormats,variants=master.metadata?.variants||[];
 if(!Array.isArray(formats)||formats.length===0)return line;
 const variantId=line.variantId??null;
 if(variantId!==null&&(!Array.isArray(variants)||variants.filter((v:any)=>String(v.id||v.variant_id||v.sku)===variantId).length!==1))return line;
 try{
  const snapshots=formats.map((format:any)=>{
   if(!format||format.factor!==1||format.isBase===false)throw Error('NOT_CANONICAL_BASE');
   const value=issuedFormatSnapshot({schemaVersion:1,...format});
   if(value.id!=='base:'+String(value.variantId||'item')||value.variantId!==null&&(!Array.isArray(variants)||!variants.some((v:any)=>String(v.id||v.variant_id||v.sku)===value.variantId)))throw Error('NOT_CANONICAL_BASE');
   return value;
  });
  if(new Set(snapshots.map(value=>value.id)).size!==snapshots.length)return line;
  const matches=formats.map((format:any,index:number)=>({format,value:snapshots[index]})).filter(({format,value})=>value.variantId===variantId&&format.active===true&&format.allowSale===true);
  return matches.length===1?freezeLine(line,matches[0].value):line;
 }catch{return line;}
}
