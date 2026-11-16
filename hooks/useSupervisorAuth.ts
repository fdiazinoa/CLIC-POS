import { dbAdapter } from '../services/db';
import { canAuthorizeReturn, canCompleteReturnApproval, isReturnPermission, hasReturnRequestContext, readReturnSecurityContext, type ReturnSecurityContext } from '../services/sync/PosSecurityV2Runtime';
import { requiresTerminalPolicyPin } from '../utils/terminalAuthorizationPolicy';
import { useState, useCallback, useRef } from 'react';
import { BusinessConfig, User, Permission, AuditLogEntry, RoleDefinition, TerminalConfig } from '../types';
import { canGrantDiscountPercent } from '../utils/userSalesPolicy';

interface UseSupervisorAuthProps {
    config: BusinessConfig;
    terminalSecurity?: TerminalConfig['security'];
    currentUser: User | null;
    roles: RoleDefinition[];
    onUpdateConfig: (newConfig: BusinessConfig) => void;
}

interface RequestApprovalParams {
    permission: Permission;
    actionDescription: string;
    onAuthorized?: (supervisor: User) => void;
    context?: {
        ticketId?: string;
        itemId?: string;
        originalValue?: number;
        newValue?: number;
        reason?: string;
    };
}

export const useSupervisorAuth = ({ config, currentUser, roles, onUpdateConfig, terminalSecurity }: UseSupervisorAuthProps) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [pendingRequest, setPendingRequest] = useState<{
        resolve: (value: boolean) => void;
        params: RequestApprovalParams;
        returnContext?: ReturnSecurityContext;
    } | null>(null);

    const pendingRef = useRef(pendingRequest);

    const requestApproval = useCallback((params: RequestApprovalParams): Promise<boolean> => {
        return new Promise((resolve) => {
          void (async () => {
            const returnContext = isReturnPermission(params.permission) ? await readReturnSecurityContext(dbAdapter, roles) : undefined;
            if (returnContext && !hasReturnRequestContext(returnContext, currentUser)) { resolve(false); return; }
            // 1. Check if current user has permission
            const userRole = roles?.find(r => r.id === currentUser?.roleId) ||
                roles?.find(r => r.id === currentUser?.role);

            if (userRole || returnContext?.mode === 'V2') {
                const hasPermission = returnContext ? canAuthorizeReturn(returnContext, currentUser) : userRole!.permissions.includes('ALL') || userRole!.permissions.includes(params.permission);

                // Check limits (e.g., max discount)
                let withinLimits = true;
                if (params.permission === 'POS_DISCOUNT' && params.context?.newValue !== undefined) {
                    const discountPercent = params.context.newValue;
                    if (!canGrantDiscountPercent(currentUser, roles, discountPercent)) {
                        withinLimits = false;
                    }
                }

                if (hasPermission && withinLimits && !requiresTerminalPolicyPin(terminalSecurity, params.permission)) {
                    // Log self-authorization
                    logAction(currentUser!, currentUser!, params);
                    params.onAuthorized?.(currentUser!);
                    resolve(true);
                    return;
                }
            }

            // 2. If not, open modal
            pendingRef.current?.resolve(false);
            pendingRef.current = { resolve, params, returnContext };
            setPendingRequest(pendingRef.current);
            setIsModalOpen(true);
          })().catch(() => resolve(false));
        });
    }, [config, currentUser, roles, terminalSecurity]);

    const handleAuthorize = async (supervisor: User) => {
        const request = pendingRef.current;
        if (!request) return;
        if (request.returnContext) {
            const current = await readReturnSecurityContext(dbAdapter, roles);
            if (pendingRef.current !== request) return;
            if (!canCompleteReturnApproval(request.returnContext, current, supervisor, currentUser)) {
                request.resolve(false); pendingRef.current = null; setPendingRequest(null); setIsModalOpen(false); return;
            }
        }
        if (pendingRef.current !== request) return;
        logAction(currentUser || supervisor, supervisor, request.params);
        request.params.onAuthorized?.(supervisor);
        request.resolve(true); pendingRef.current = null; setPendingRequest(null); setIsModalOpen(false);
    };

    const handleClose = () => {
        pendingRef.current?.resolve(false); pendingRef.current = null;
        setPendingRequest(null); setIsModalOpen(false);
    };

    const logAction = (cashier: User, supervisor: User, params: RequestApprovalParams) => {
        const newLog: AuditLogEntry = {
            id: `LOG-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            timestamp: new Date().toISOString(),
            actionType: params.permission,
            actionDescription: params.actionDescription,
            cashierId: cashier.id,
            supervisorId: supervisor.id,
            terminalId: 'current-terminal', // In a real app, pass this from context
            ticketId: params.context?.ticketId,
            itemId: params.context?.itemId,
            originalValue: params.context?.originalValue,
            newValue: params.context?.newValue,
            reason: params.context?.reason,
            details: [
                params.actionDescription,
                params.context?.reason,
                params.context?.ticketId ? `Ticket: ${params.context.ticketId}` : '',
                params.context?.itemId ? `Item: ${params.context.itemId}` : ''
            ].filter(Boolean).join(' | '),
            hash: 'simulated-hash'
        };

        const updatedLogs = [...(config.auditLogs || []), newLog];
        onUpdateConfig({ ...config, auditLogs: updatedLogs });
    };

    return {
        requestApproval,
        supervisorModalProps: {
            isOpen: isModalOpen,
            onClose: handleClose,
            onAuthorize: handleAuthorize,
            requiredPermission: pendingRequest?.params.permission || 'SETTINGS_ACCESS',
            actionDescription: pendingRequest?.params.actionDescription || '',
            config,
            roles,
            requestedDiscountPercent: pendingRequest?.params.permission === 'POS_DISCOUNT'
                ? pendingRequest.params.context?.newValue
                : undefined
        }
    };
};
