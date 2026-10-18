import type {BusinessConfig} from '../../types';
import {capturePresentationAuth,type PresentationAuthority} from './client';
/** Uses the normalized terminal warehouse projection; a missing local identity is never guessed. */
export function presentationAuthority(config:BusinessConfig,terminalId:string,tariffIds:string[],categories:string[]=[]):PresentationAuthority{
 const auth=capturePresentationAuth(),terminal=config.terminals.find(t=>t.id===terminalId),binding=terminal?.config.erpBinding,inventory=terminal?.config.inventoryScope;
 if(!terminal||!inventory||!binding||binding.terminalId!==auth.scope.terminalId||binding.companyId!==auth.scope.companyId||binding.storeId!==auth.scope.storeId||binding.tenantId!==auth.scope.tenantId)throw Error('INVENTORY_PRESENTATION_SCOPE_CHANGED');
 const warehouseId=inventory.defaultSalesWarehouseId;
 const matches=[inventory.defaultWarehouse,...(inventory.warehouses||[])].filter(w=>w&&(w.id===warehouseId||w.erpWarehouseId===warehouseId));
 const locals=Array.from(new Set(matches.map(w=>w!.inventoryLocalId).filter(Boolean)));
 if(!warehouseId||locals.length!==1)throw Error('INVENTORY_PRESENTATION_LOCAL_REQUIRED');
 return {origin:auth.origin,scope:{...auth.scope,warehouseId,localId:locals[0]!},tariffIds:[...tariffIds],categories:[...categories]};
}
