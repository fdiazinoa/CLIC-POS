import type {Permission,RoleDefinition,User} from '../types';

/** The effective role is authoritative; a role name or legacy user label never grants access. */
export function hasTicketRolePermission(user:User|null|undefined,roles:readonly RoleDefinition[],permission:Permission):boolean {
 if(!user||user.isActive===false)return false;
 const role=roles.find(candidate=>candidate.id===(user.roleId||user.role));
 return Boolean(role&&role.isActive!==false&&Array.isArray(role.permissions)
  &&(role.permissions.includes('ALL')||role.permissions.includes(permission)));
}
export const canViewTicketHistory=(user:User|null|undefined,roles:readonly RoleDefinition[]):boolean=>
 hasTicketRolePermission(user,roles,'POS_VIEW_TICKET_HISTORY');
export const canReprintTicketHistory=(user:User|null|undefined,roles:readonly RoleDefinition[]):boolean=>
 canViewTicketHistory(user,roles)&&hasTicketRolePermission(user,roles,'POS_REPRINT_RECEIPT');
