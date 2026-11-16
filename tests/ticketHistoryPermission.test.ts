import test from 'node:test';
import assert from 'node:assert/strict';
import type {RoleDefinition,User,Permission} from '../types';
import {canViewTicketHistory,canReprintTicketHistory} from '../utils/ticketHistoryPermission';
const user={id:'cashier',role:'SUPERVISOR',roleId:'CUSTOM',isActive:true} as User;
const role=(permissions:Permission[],extra:Partial<RoleDefinition>={}):RoleDefinition=>({id:'CUSTOM',name:'Administrador',permissions,...extra});
test('effective role permissions control history, never user labels or role names',()=>{
 assert.equal(canViewTicketHistory(user,[role([])]),false);
 assert.equal(canViewTicketHistory(user,[role(['POS_REPRINT_RECEIPT'])]),false);
 assert.equal(canViewTicketHistory(user,[role(['POS_VIEW_TICKET_HISTORY'])]),true);
 assert.equal(canViewTicketHistory(user,[role(['ALL'])]),true);
 assert.equal(canViewTicketHistory({...user,roleId:'missing'},[role(['ALL'])]),false);
});
test('inactive/missing user and role fail closed',()=>{
 for(const current of [null,undefined,{...user,isActive:false}])assert.equal(canViewTicketHistory(current,[role(['ALL'])]),false);
 assert.equal(canViewTicketHistory(user,[]),false);
 assert.equal(canViewTicketHistory(user,[role(['ALL'],{isActive:false})]),false);
});
test('reprint requires both history and the existing independent role permission',()=>{
 assert.equal(canReprintTicketHistory(user,[role(['POS_VIEW_TICKET_HISTORY'])]),false);
 assert.equal(canReprintTicketHistory(user,[role(['POS_REPRINT_RECEIPT'])]),false);
 assert.equal(canReprintTicketHistory(user,[role(['POS_VIEW_TICKET_HISTORY','POS_REPRINT_RECEIPT'])]),true);
 assert.equal(canReprintTicketHistory(user,[role(['ALL'])]),true);
 assert.equal(canViewTicketHistory(user,[role(['POS_VIEW_TICKET_HISTORY'])]),true);
 assert.equal(canViewTicketHistory(user,[role([])]),false,'role revocation is authoritative');
});
