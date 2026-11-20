import type { RoleDefinition, TerminalConfig, User } from '../types';
import { requiresTerminalPolicyPin } from './terminalAuthorizationPolicy';

export function paidReturnAuthorizationKey(
    terminalId: string, user: User | null, roles: RoleDefinition[], security: TerminalConfig['security'] | undefined,
): string {
    const rolePermissions = roles.map(role => JSON.stringify([
        role.id, role.isActive, role.permissionContractVersion, [...role.permissions].sort(),
    ])).sort();
    return JSON.stringify([
        terminalId, user?.id, user?.roleId, user?.role, user?.isActive, user?.permissionContractVersion,
        security?.deviceBindingToken, requiresTerminalPolicyPin(security, 'POS_VOID_PAID_TICKET'), rolePermissions,
    ]);
}

/** Final asynchronous permission read must not outlive its requester/context.
 * Callers also check isCurrent immediately before invoking a business callback. */
export async function confirmCurrentAuthorization<T>({ isCurrent, readFinalContext, acceptsFinalContext }: {
    isCurrent: () => boolean;
    readFinalContext?: () => Promise<T>;
    acceptsFinalContext?: (context: T) => boolean;
}): Promise<boolean> {
    if (!isCurrent()) return false;
    const context = readFinalContext ? await readFinalContext() : undefined;
    return isCurrent() && (!acceptsFinalContext || acceptsFinalContext(context as T));
}
