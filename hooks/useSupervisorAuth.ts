import { buildAuthorizationLog, persistAuthorizationLog } from '../services/audit/PosOperationalAudit';
import { permissionService } from '../services/sync/PermissionService';
import { dbAdapter } from '../services/db';
import { canAuthorizeReturn, canCompleteReturnApproval, isReturnPermission, hasReturnRequestContext, readReturnSecurityContext, type ReturnSecurityContext } from '../services/sync/PosSecurityV2Runtime';
import { requiresTerminalPolicyPin } from '../utils/terminalAuthorizationPolicy';
import { useState, useCallback, useRef, useEffect } from 'react';
import { BusinessConfig, User, Permission, RoleDefinition, TerminalConfig } from '../types';
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
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; pendingRef.current?.resolve(false); pendingRef.current = null; };
    }, []);
    const authorizationInFlight = useRef(false);
    const authContextRef = useRef({ currentUser, roles, terminalSecurity });
    authContextRef.current = { currentUser, roles, terminalSecurity };
    const configRef = useRef(config);
    configRef.current = config;

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
                    await logAction(currentUser!, currentUser!, params);
                    if (!mountedRef.current || authContextRef.current.currentUser !== currentUser || authContextRef.current.roles !== roles || authContextRef.current.terminalSecurity !== terminalSecurity) { resolve(false); return; }
                    if (returnContext && !canCompleteReturnApproval(returnContext, await readReturnSecurityContext(dbAdapter, roles), currentUser, currentUser)) { resolve(false); return; }
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
        if (!request || authorizationInFlight.current) return;
        authorizationInFlight.current = true;
        try {
            if (request.returnContext) {
                const current = await readReturnSecurityContext(dbAdapter, roles);
                if (pendingRef.current !== request) return;
                if (!canCompleteReturnApproval(request.returnContext, current, supervisor, currentUser)) {
                    request.resolve(false); pendingRef.current = null; setPendingRequest(null); setIsModalOpen(false); return;
                }
            }
            if (pendingRef.current !== request) return;
            await logAction(currentUser || supervisor, supervisor, request.params);
            if (pendingRef.current !== request) return;
            if (!mountedRef.current || authContextRef.current.currentUser !== currentUser || authContextRef.current.roles !== roles || authContextRef.current.terminalSecurity !== terminalSecurity) { request.resolve(false); pendingRef.current = null; setPendingRequest(null); setIsModalOpen(false); return; }
            if (request.returnContext && !canCompleteReturnApproval(request.returnContext, await readReturnSecurityContext(dbAdapter, roles), supervisor, currentUser)) { request.resolve(false); pendingRef.current = null; setPendingRequest(null); setIsModalOpen(false); return; }
            if (pendingRef.current !== request) return;
            request.params.onAuthorized?.(supervisor);
            request.resolve(true); pendingRef.current = null; setPendingRequest(null); setIsModalOpen(false);
        } finally { authorizationInFlight.current = false; }
    };

    const handleClose = () => {
        pendingRef.current?.resolve(false); pendingRef.current = null;
        setPendingRequest(null); setIsModalOpen(false);
    };

    const logAction = async (cashier: User, supervisor: User, params: RequestApprovalParams) => {
        const newLog = buildAuthorizationLog(cashier, supervisor, params, permissionService.getTerminalId() || '');
        const warning = await persistAuthorizationLog(dbAdapter, configRef.current, newLog);
        const backup = warning ? await dbAdapter.getDocument<BusinessConfig>('config', 'current').catch(() => null) : null;
        const current = configRef.current;
        const logsById = new Map([...(backup?.auditLogs || []), ...(current.auditLogs || [])].map(log => [log.id, log]));
        logsById.set(newLog.id, newLog);
        const updated = { ...current, auditLogs: [...logsById.values()] };
        configRef.current = updated;
        try {
            const update = onUpdateConfig(updated);
            void Promise.resolve(update).catch(() => {
                if (typeof window !== 'undefined') window.alert('La copia local de auditoría no se pudo actualizar. Revisa los pendientes y el almacenamiento del POS.');
            });
        } catch {
            if (typeof window !== 'undefined') window.alert('No se pudo actualizar la copia local de auditoría. Revisa el almacenamiento del POS.');
        }
        if (warning && typeof window !== 'undefined') window.alert(warning);
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
