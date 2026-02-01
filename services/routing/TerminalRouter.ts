/**
 * TerminalRouter
 * 
 * Route guard service that evaluates terminal role and controls navigation.
 * Handles permission checking, route restrictions, and navigation locking for kiosk modes.
 */

import { BusinessConfig, DeviceRole, DeviceRoleConfig, ViewState } from '../../types';
import { authLevelService } from '../auth/AuthLevelService';

export interface NavigationDecision {
    allowed: boolean;
    redirect?: string;
    message?: string;
}

// ViewState to route mapping
const VIEW_TO_MODULE_MAP: Record<string, string> = {
    'LOGIN': 'auth',
    'POS': 'sales',
    'SETTINGS': 'settings',
    'SETTINGS_SYNC': 'settings',
    'CUSTOMERS': 'customers',
    'HISTORY': 'history',
    'FINANCE': 'finance',
    'Z_REPORT': 'reports',
    'SUPPLY_CHAIN': 'supply_chain',
    'FRANCHISE': 'franchise',
    'TERMINAL_BINDING': 'terminal_setup',

    // New kiosk routes
    'KIOSK_WELCOME': 'kiosk',
    'KIOSK_BROWSER': 'kiosk',
    'KIOSK_CART': 'kiosk',
    'KIOSK_PAYMENT': 'kiosk',

    // Price checker routes
    'CHECKER_SCAN': 'price_checker',

    // Handheld inventory routes
    'INVENTORY_HOME': 'inventory',
    'INVENTORY_COUNT': 'inventory',
    'INVENTORY_RECEPTION': 'inventory',
    'INVENTORY_LABELS': 'inventory',

    // Kitchen display routes
    'KITCHEN_ORDERS': 'kitchen'
};

class TerminalRouter {
    private config: BusinessConfig | null = null;
    private currentTerminalId: string | null = null;
    private roleConfig: DeviceRoleConfig | null = null;
    private currentUser: any = null;
    private navigationHistory: string[] = [];

    /**
     * Initialize the router with terminal configuration
     */
    init(config: BusinessConfig, terminalId: string, roleConfig: DeviceRoleConfig | null): void {
        this.config = config;
        this.currentTerminalId = terminalId;
        this.roleConfig = roleConfig;

        console.log(`🛣️ TerminalRouter initialized for: ${terminalId}`, {
            role: roleConfig?.role || DeviceRole.STANDARD_POS,
            authLevel: roleConfig?.authLevel
        });
    }

    /**
     * Set current authenticated user
     */
    setCurrentUser(user: any): void {
        this.currentUser = user;
    }

    /**
     * Main navigation guard - called before any view change
     */
    beforeNavigate(targetView: string, fromView?: string): NavigationDecision {
        // Track navigation history
        if (fromView) {
            this.navigationHistory.push(fromView);
        }

        const role = this.roleConfig?.role || DeviceRole.STANDARD_POS;

        // 1. Check authentication requirements
        const authCheck = this.checkAuthentication(targetView, role);
        if (!authCheck.allowed) {
            return authCheck;
        }

        // 2. Check module permissions
        const moduleCheck = this.checkModulePermission(targetView, role);
        if (!moduleCheck.allowed) {
            return moduleCheck;
        }

        // 3. Check navigation locking (kiosk mode)
        const lockCheck = this.checkNavigationLock(targetView, fromView, role);
        if (!lockCheck.allowed) {
            return lockCheck;
        }

        // 4. All checks passed
        return { allowed: true };
    }

    /**
     * Check if user authentication is satisfied
     */
    private checkAuthentication(targetView: string, role: DeviceRole): NavigationDecision {
        // Login screen is always accessible
        if (targetView === 'LOGIN') {
            return { allowed: true };
        }

        // Check if user login is required
        const requiresUser = authLevelService.shouldRequireUserLogin();

        if (requiresUser && !this.currentUser) {
            return {
                allowed: false,
                redirect: 'LOGIN',
                message: 'Autenticación requerida'
            };
        }

        return { allowed: true };
    }

    /**
     * Check if module is allowed for this terminal role
     */
    private checkModulePermission(targetView: string, role: DeviceRole): NavigationDecision {
        const moduleName = VIEW_TO_MODULE_MAP[targetView] || 'unknown';

        // Check if module is allowed
        if (!authLevelService.isModuleAllowed(moduleName)) {
            console.warn(`🚫 Module '${moduleName}' not allowed for role: ${role}`);

            return {
                allowed: false,
                message: `El módulo "${moduleName}" no está disponible en este terminal`,
                redirect: authLevelService.getDefaultRoute()
            };
        }

        return { allowed: true };
    }

    /**
     * Check navigation locking (prevent back navigation in kiosk)
     */
    private checkNavigationLock(targetView: string, fromView: string | undefined, role: DeviceRole): NavigationDecision {
        const uiSettings = authLevelService.getUISettings();

        if (!uiSettings.navigationLocked) {
            return { allowed: true };
        }

        // Determine if this is back navigation
        const isBackNavigation = this.isBackwardNavigation(targetView, fromView);

        if (isBackNavigation) {
            console.warn(`🔒 Navigation locked - cannot go back in kiosk mode`);

            return {
                allowed: false,
                message: 'Navegación bloqueada en modo kiosco'
            };
        }

        return { allowed: true };
    }

    /**
     * Determine if navigation is backward (going to a previous view)
     */
    private isBackwardNavigation(targetView: string, fromView: string | undefined): boolean {
        if (!fromView) return false;

        // Define flow sequences for different roles
        const flows: Record<DeviceRole, string[]> = {
            [DeviceRole.STANDARD_POS]: [],  // No restrictions
            [DeviceRole.SELF_CHECKOUT]: [
                'KIOSK_WELCOME',
                'KIOSK_BROWSER',
                'KIOSK_CART',
                'KIOSK_PAYMENT'
            ],
            [DeviceRole.PRICE_CHECKER]: ['CHECKER_SCAN'],  // Single screen loop
            [DeviceRole.HANDHELD_INVENTORY]: [],  // Free navigation
            [DeviceRole.KITCHEN_DISPLAY]: ['KITCHEN_ORDERS']  // Single screen
        };

        const role = this.roleConfig?.role || DeviceRole.STANDARD_POS;
        const flow = flows[role];

        if (!flow || flow.length === 0) {
            return false;
        }

        const fromIndex = flow.indexOf(fromView);
        const toIndex = flow.indexOf(targetView);

        // Special case: Allow resetting to start after completion
        // (e.g., KIOSK_PAYMENT → KIOSK_WELCOME after successful payment)
        const isResetToStart = toIndex === 0 && fromIndex === flow.length - 1;
        if (isResetToStart) {
            return false; // Allow this transition
        }

        // If going to an earlier step in the flow, it's backward navigation
        return fromIndex !== -1 && toIndex !== -1 && toIndex < fromIndex;
    }

    /**
     * Get allowed views for current terminal role
     */
    getAllowedViews(): ViewState[] {
        const role = this.roleConfig?.role || DeviceRole.STANDARD_POS;
        const allowedModules = authLevelService.getAllowedModules();

        // If all modules allowed
        if (allowedModules.includes('*')) {
            return this.getAllViewStates();
        }

        // Filter views by allowed modules
        const allViews = this.getAllViewStates();
        return allViews.filter(view => {
            const module = VIEW_TO_MODULE_MAP[view];
            return allowedModules.includes(module);
        });
    }

    /**
     * Get all possible view states
     */
    private getAllViewStates(): ViewState[] {
        return Object.keys(VIEW_TO_MODULE_MAP) as ViewState[];
    }

    /**
     * Clear navigation history
     */
    clearHistory(): void {
        this.navigationHistory = [];
    }

    /**
     * Get navigation history
     */
    getHistory(): string[] {
        return [...this.navigationHistory];
    }

    /**
     * Check if router is initialized
     */
    isInitialized(): boolean {
        return this.config !== null && this.currentTerminalId !== null;
    }
}

// Singleton export
export const terminalRouter = new TerminalRouter();
