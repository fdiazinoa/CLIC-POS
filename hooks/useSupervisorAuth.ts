import { useState, useCallback } from 'react';
import { BusinessConfig, User, Permission, AuditLogEntry, RoleDefinition } from '../types';

interface UseSupervisorAuthProps {
    config: BusinessConfig;
    currentUser: User | null;
    roles: RoleDefinition[];
    onUpdateConfig: (newConfig: BusinessConfig) => void;
}

interface RequestApprovalParams {
    permission: Permission;
    actionDescription: string;
    context?: {
        ticketId?: string;
        itemId?: string;
        originalValue?: number;
        newValue?: number;
        reason?: string;
    };
}

export const useSupervisorAuth = ({ config, currentUser, roles, onUpdateConfig }: UseSupervisorAuthProps) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [pendingRequest, setPendingRequest] = useState<{
        resolve: (value: boolean) => void;
        params: RequestApprovalParams;
    } | null>(null);

    const requestApproval = useCallback((params: RequestApprovalParams): Promise<boolean> => {
        return new Promise((resolve) => {
            // 1. Check if current user has permission
            const userRole = roles?.find(r => r.id === currentUser?.roleId) ||
                roles?.find(r => r.id === currentUser?.role);

            if (userRole) {
                const hasPermission = userRole.permissions.includes('ALL') || userRole.permissions.includes(params.permission);

                // Check limits (e.g., max discount)
                let withinLimits = true;
                if (params.permission === 'POS_DISCOUNT' && params.context?.newValue) {
                    const discountPercent = params.context.newValue;
                    if (userRole.maxDiscountPercent !== undefined && discountPercent > userRole.maxDiscountPercent) {
                        withinLimits = false;
                    }
                }

                if (hasPermission && withinLimits) {
                    // Log self-authorization
                    logAction(currentUser!, currentUser!, params);
                    resolve(true);
                    return;
                }
            }

            // 2. If not, open modal
            setPendingRequest({ resolve, params });
            setIsModalOpen(true);
        });
    }, [config, currentUser, roles]);

    const handleAuthorize = (supervisor: User) => {
        if (pendingRequest) {
            logAction(pendingRequest.params.context?.ticketId ? currentUser! : supervisor, supervisor, pendingRequest.params);
            pendingRequest.resolve(true);
            setPendingRequest(null);
            setIsModalOpen(false);
        }
    };

    const handleClose = () => {
        if (pendingRequest) {
            pendingRequest.resolve(false);
            setPendingRequest(null);
            setIsModalOpen(false);
        }
    };

    const logAction = (cashier: User, supervisor: User, params: RequestApprovalParams) => {
        const newLog: AuditLogEntry = {
            id: `LOG-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            timestamp: new Date().toISOString(),
            actionType: params.permission,
            cashierId: cashier.id,
            supervisorId: supervisor.id,
            terminalId: 'current-terminal', // In a real app, pass this from context
            ticketId: params.context?.ticketId,
            itemId: params.context?.itemId,
            originalValue: params.context?.originalValue,
            newValue: params.context?.newValue,
            reason: params.context?.reason,
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
            roles // Pass roles to modal
        }
    };
};
