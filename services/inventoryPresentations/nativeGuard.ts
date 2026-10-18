import {assertPresentationAdmission} from './admission';
import {requiresProductStockAvailability} from '../../utils/productStockPolicy';
import Decimal from 'decimal.js';
import type {CartItem,Transaction,BusinessConfig} from '../../types';
import type {PresentationCommitProof} from './runtime';
import {canonicalPresentationJson,inventoryPresentationRevision,validateInventoryPresentation} from './contract';
import {presentationAuthority} from './authority';
import {validatePresentationContext} from './client';
import {presentationInventoryQuantity} from './selection';

type Read=<T>(sql:string,values:(string|number|null)[])=>Promise<T[]>;
/** Called only inside the native financial BEGIN/shared write lock. No HTTP or nested adapter calls. */
export async function assertPresentationCommit(transaction:Transaction,proof:PresentationCommitProof|undefined,read:Read,requirements:{productId:string;warehouseId:string;quantity:number;quantityScale?:4}[]){
 const selected=transaction.items?.filter(line=>line.inventoryPresentation!==undefined)||[];
 if(!selected.length){if(transaction.inventoryPresentationContract!==undefined||proof)throw Error('INVENTORY_PRESENTATION_UNEXPECTED_PROOF');return;}
 if(transaction.documentType==='REFUND'||transaction.inventoryPresentationContract!==1||!proof)throw Error('INVENTORY_PRESENTATION_COMMIT_PROOF_REQUIRED');
 const configs=await read<{data:string}>("SELECT data FROM documents WHERE collection_name='config' AND doc_id='current'",[]);if(configs.length!==1)throw Error('INVENTORY_PRESENTATION_SCOPE_CHANGED');
 const config=JSON.parse(configs[0].data) as BusinessConfig;
 const retained=JSON.parse(proof.contextContent),authority=presentationAuthority(config,transaction.terminalId,retained.context.tariffIds,retained.context.categories);
 assertPresentationAdmission(authority);await validatePresentationContext(retained.context,authority);
 if(retained.origin!==authority.origin||proof.bindingKey!==await inventoryPresentationRevision({origin:authority.origin,scope:authority.scope})||proof.contextKey!==await inventoryPresentationRevision({origin:authority.origin,contextRevision:retained.context.contextRevision}))throw Error('INVENTORY_PRESENTATION_SCOPE_CHANGED');
 const availability=await read<{state:string;context_key:string}>('SELECT state,context_key FROM inventory_presentation_availability WHERE binding_key=?',[proof.bindingKey]);
 if(availability[0]?.state!=='READY'||availability[0]?.context_key!==proof.contextKey)throw Error('INVENTORY_PRESENTATION_ERP_DENIED');
 const contexts=await read<{content:string}>('SELECT content FROM inventory_presentation_contexts WHERE context_key=?',[proof.contextKey]);
 const sessions=await read<{state:string;context_key:string;binding_key:string}>('SELECT state,context_key,binding_key FROM inventory_presentation_sessions WHERE id=?',[proof.sessionId]);
 if(contexts[0]?.content!==proof.contextContent||sessions[0]?.state!=='COMPLETE'||sessions[0]?.context_key!==proof.contextKey||sessions[0]?.binding_key!==proof.bindingKey)throw Error('INVENTORY_PRESENTATION_COMMIT_PROOF_CHANGED');
 for(const line of selected){
  const descriptor=line.inventoryPresentation!,expected=proof.masters[descriptor.masterRevision];
  const rows=await read<{content:string}>('SELECT content FROM inventory_presentation_masters WHERE context_key=? AND master_revision=? AND item_id=?',[proof.contextKey,descriptor.masterRevision,line.id]);
  if(!expected||rows.length!==1||rows[0].content!==expected||line.quantity<=0||line.variantId||line.variantSku||descriptor.tariffId!==line.v3SaleAuthority?.tariffId||line.v3SaleAuthority?.warehouseId!==authority.scope.warehouseId)throw Error('INVENTORY_PRESENTATION_COMMIT_PROOF_CHANGED');
  const delivered=await read<{content:string}>("SELECT DISTINCT x.content FROM inventory_presentation_selection x JOIN inventory_presentation_sessions s ON s.id=x.session_id WHERE s.context_key=? AND s.binding_key=? AND s.state='COMPLETE' AND x.master_revision=? AND x.item_id=? LIMIT 2",[proof.contextKey,proof.bindingKey,descriptor.masterRevision,line.id]);
  if(delivered.length!==1||delivered[0].content!==expected)throw Error('INVENTORY_PRESENTATION_COMMIT_PROOF_CHANGED');
  await validateInventoryPresentation(line as CartItem&{inventoryPresentation:unknown},JSON.parse(expected));
 }
 for(const line of selected){if(line.type!=='SERVICE'&&line.isInventoriable===true&&requiresProductStockAvailability(line)&&!requirements.some(r=>r.productId===line.id&&r.warehouseId===authority.scope.warehouseId))throw Error('INVENTORY_PRESENTATION_BASE_DEMAND_REQUIRED');}
 for(const requirement of requirements){
  const matching=transaction.items.filter(line=>line.id===requirement.productId);
  if(!matching.some(line=>line.inventoryPresentation))continue;
  const base=matching.reduce((sum,line)=>sum.plus(presentationInventoryQuantity(line)),new Decimal(0));
  if(requirement.quantityScale!==4||!base.eq(requirement.quantity)||requirement.warehouseId!==authority.scope.warehouseId)throw Error('INVENTORY_PRESENTATION_BASE_MISMATCH');
 }
 assertPresentationAdmission(authority);
 // Re-read synchronous authority after hashing/queries, before the caller performs writes.
 if(canonicalPresentationJson(presentationAuthority(config,transaction.terminalId,retained.context.tariffIds,retained.context.categories))!==canonicalPresentationJson(authority))throw Error('INVENTORY_PRESENTATION_SCOPE_CHANGED');
}
