import type { DatabaseAdapter } from '../db/DatabaseAdapter';
import type { Permission, RoleDefinition, User } from '../../types';
import { readPosSecurityRecords, type PosSecurityRecord } from './PosSecurityV2Consumer';
import { sameSecurityValue, type SecurityBinding } from './PosSecurityV2Contract';

export interface ReturnSecurityContext { mode: 'CURRENT' | 'V2' | 'BLOCKED'; token: string; roles: RoleDefinition[]; users: User[] }
// Future integration supplies authenticated context. No transport, announcement or activation occurs here.
let authorizedContext: (() => Promise<SecurityBinding | null>) | null = null;
export const configureReturnSecurityContext = (provider: (() => Promise<SecurityBinding | null>) | null): void => { authorizedContext = provider; };
const matchesApplied = (record: PosSecurityRecord, binding: SecurityBinding): boolean => {
  const ref = record.appliedReference, offer = record.control.negotiation.offer;
  return !!ref && !!offer && !record.localBlock && record.control.negotiation.status === 'ACTIVE' && record.protocolFloor === 2
    && record.control.selection.mode === 'V2' && sameSecurityValue(record.control.negotiation.binding, binding)
    && sameSecurityValue(ref.binding, binding) && ref.agreementId === offer.agreementId && ref.contractDigest === offer.contractDigest;
};
export async function readReturnSecurityContext(adapter: DatabaseAdapter, legacyRoles: RoleDefinition[], legacyUsers: User[] = [], provider = authorizedContext): Promise<ReturnSecurityContext> {
  try {
    const records = await readPosSecurityRecords(adapter);
    const floors = records.filter(record => record.protocolFloor === 2);
    if (!floors.length) return { mode: 'CURRENT', token: 'CURRENT', roles: legacyRoles, users: legacyUsers };
    const binding = provider ? await provider() : null;
    if (!binding) return { mode: 'BLOCKED', token: 'BLOCKED', roles: [], users: [] };
    const record = floors.find(row => row.tenantId === binding.tenantId && row.terminalId === binding.terminalId);
    if (!record || !matchesApplied(record, binding)) return { mode: 'BLOCKED', token: 'BLOCKED', roles: [], users: [] };
    const roles = await adapter.getCollection<RoleDefinition>('roles'), users = await adapter.getCollection<User>('users');
    if (!Array.isArray(roles) || !Array.isArray(users) || roles.some(role => role.permissionContractVersion !== 2) || users.some(user => user.permissionContractVersion !== 2)) return { mode: 'BLOCKED', token: 'BLOCKED', roles: [], users: [] };
    const confirmed = (await readPosSecurityRecords(adapter)).find(row => row.id === record.id);
    if (!confirmed || !sameSecurityValue(confirmed, record) || !sameSecurityValue(provider ? await provider() : null, binding)) return { mode: 'BLOCKED', token: 'BLOCKED', roles: [], users: [] };
    return { mode: 'V2', token: JSON.stringify([record.control.negotiation.stateRevision, record.appliedReference]), roles, users };
  } catch { return { mode: 'BLOCKED', token: 'BLOCKED', roles: [], users: [] }; }
}
export const isReturnPermission = (permission: Permission): boolean => permission === 'CAN_REFUND' || permission === 'POS_RETURNS';
export function hasReturnRequestContext(context: ReturnSecurityContext, user: User | null): boolean {
  if (!user || context.mode === 'BLOCKED') return false;
  if (context.mode === 'CURRENT') return true;
  const member = context.users.find(candidate => candidate.id === user.id);
  return !!member && member.isActive !== false && context.roles.some(role => role.id === member.roleId && role.isActive !== false);
}
export function canAuthorizeReturn(context: ReturnSecurityContext, user: User | null): boolean {
  if (!hasReturnRequestContext(context, user) || !user) return false;
  const effective = context.mode === 'V2' ? context.users.find(candidate => candidate.id === user.id)! : user;
  const role = context.mode === 'V2' ? context.roles.find(candidate => candidate.id === effective.roleId)
    : context.roles.find(candidate => candidate.id === effective.roleId) || context.roles.find(candidate => candidate.id === effective.role);
  if (!role || (context.mode === 'V2' && role.isActive === false)) return false;
  return role.permissions.includes('ALL') || role.permissions.includes(context.mode === 'V2' ? 'POS_RETURNS' : 'CAN_REFUND');
}
/** The pending context must still be current when a PIN callback completes. */
export function canCompleteReturnApproval(start: ReturnSecurityContext, current: ReturnSecurityContext, approver: User, requester?: User | null): boolean {
  return (requester === undefined || hasReturnRequestContext(current, requester)) && start.mode === current.mode && start.token === current.token && canAuthorizeReturn(current, approver);
}
