/**
 * AuthLevelService
 * 
 * Manages multi-level authentication for different terminal device roles.
 * 
 * - Level A (USER_REQUIRED): Standard POS and Handheld terminals require user login
 * - Level B (HEADLESS): Self-Checkout, Price Checker, and KDS auto-authenticate via API token
 */

import { BusinessConfig, DeviceRole, AuthLevel, DeviceRoleConfig } from '../../types';

class AuthLevelService {
    private config: BusinessConfig | null = null;
    private currentTerminalId: string | null = null;
    private headlessToken: string | null = null;

    /**
     * Initialize the service with config and terminal ID
     */
    init(config: BusinessConfig, terminalId: string): void {
        this.config = config;
        this.currentTerminalId = terminalId;
        console.log(`🔐 AuthLevelService initialized for terminal: ${terminalId}`);
    }

    /**
     * Get the current terminal's role configuration
     */
    private getCurrentRoleConfig(): DeviceRoleConfig | null {
        if (!this.config || !this.currentTerminalId) return null;

        const terminal = (this.config.terminals || []).find(t => t.id === this.currentTerminalId);
        return terminal?.config.deviceRole || null;
    }

    /**
     * Determine if user login is required for this terminal
     */
    shouldRequireUserLogin(): boolean {
        const roleConfig = this.getCurrentRoleConfig();

        if (!roleConfig) {
            // Default behavior: require user login
            return true;
        }

        return roleConfig.authLevel === AuthLevel.USER_REQUIRED;
    }

    /**
     * Authenticate headless terminal automatically
     * Returns token for API calls
     */
    async authenticateHeadless(): Promise<{ success: boolean; token?: string; error?: string }> {
        const roleConfig = this.getCurrentRoleConfig();

        if (!roleConfig || roleConfig.authLevel !== AuthLevel.HEADLESS) {
            return {
                success: false,
                error: 'Terminal is not configured for headless authentication'
            };
        }

        // Use existing API token or generate new one
        const token = roleConfig.apiToken || this.generateAPIToken();

        // Store in memory
        this.headlessToken = token;

        // If no token was configured, save the generated one
        if (!roleConfig.apiToken && this.config && this.currentTerminalId) {
            const terminal = (this.config.terminals || []).find(t => t.id === this.currentTerminalId);
            if (terminal && terminal.config.deviceRole) {
                terminal.config.deviceRole.apiToken = token;
            }
        }

        console.log(`✅ Headless authentication successful for terminal: ${this.currentTerminalId}`);

        return {
            success: true,
            token
        };
    }

    /**
     * Generate a secure API token for headless terminals
     */
    generateAPIToken(): string {
        const timestamp = Date.now();
        const randomPart = Math.random().toString(36).substring(2, 15);
        const terminalPart = this.currentTerminalId?.substring(0, 8) || 'UNKNOWN';

        return `TK-${terminalPart}-${timestamp}-${randomPart}`.toUpperCase();
    }

    /**
     * Validate escape hatch PIN for kiosk mode
     */
    validateEscapeHatch(pin: string): boolean {
        const roleConfig = this.getCurrentRoleConfig();
        console.log('🔐 Validating Escape Hatch PIN', {
            inputPin: pin,
            roleConfigExists: !!roleConfig,
            escapeHatchEnabled: roleConfig?.uiSettings.escapeHatch?.enabled,
            requirePin: roleConfig?.uiSettings.escapeHatch?.requirePin,
            configuredPin: roleConfig?.uiSettings.escapeHatch?.adminPin
        });

        if (!roleConfig?.uiSettings.escapeHatch?.enabled) {
            console.warn('❌ Escape hatch disabled in config');
            return false;
        }

        if (!roleConfig.uiSettings.escapeHatch.requirePin) {
            // No PIN required, allow escape
            return true;
        }

        const configuredPin = String(roleConfig.uiSettings.escapeHatch.adminPin).trim();

        if (!configuredPin) {
            // No PIN configured but required - use default
            console.warn('⚠️ Escape hatch requires PIN but none configured. Using default: 1234');
            return pin === '1234';
        }

        const isValid = pin === configuredPin;
        console.log(`🔐 PIN Validation Result: ${isValid ? 'SUCCESS' : 'FAILURE'} (Expected: ${configuredPin}, Got: ${pin})`);
        return isValid;
    }

    /**
     * Get the default route for the current terminal role
     */
    getDefaultRoute(): string {
        const roleConfig = this.getCurrentRoleConfig();

        if (!roleConfig) {
            return '/pos'; // Standard POS
        }

        // If custom route is configured, use it
        if (roleConfig.defaultRoute) {
            return roleConfig.defaultRoute;
        }

        // Default routes by role
        switch (roleConfig.role) {
            case DeviceRole.STANDARD_POS:
                return '/pos';
            case DeviceRole.SELF_CHECKOUT:
                return '/kiosk/welcome';
            case DeviceRole.PRICE_CHECKER:
                return '/checker/scan';
            case DeviceRole.HANDHELD_INVENTORY:
                return '/inventory/home';
            case DeviceRole.KITCHEN_DISPLAY:
                return '/kitchen/orders';
            default:
                return '/pos';
        }
    }

    /**
     * Get allowed modules for the current terminal
     */
    getAllowedModules(): string[] {
        const roleConfig = this.getCurrentRoleConfig();

        if (!roleConfig) {
            // Default: all modules allowed
            return ['*'];
        }

        return roleConfig.allowedModules;
    }

    /**
     * Check if a specific module is allowed
     */
    isModuleAllowed(moduleName: string): boolean {
        const allowedModules = this.getAllowedModules();

        // Wildcard means all modules allowed
        if (allowedModules.includes('*')) {
            return true;
        }

        return allowedModules.includes(moduleName);
    }

    /**
     * Get current terminal role
     */
    getCurrentRole(): DeviceRole {
        const roleConfig = this.getCurrentRoleConfig();
        return roleConfig?.role || DeviceRole.STANDARD_POS;
    }

    /**
     * Get role display label
     */
    getRoleLabel(): string {
        const role = this.getCurrentRole();

        const labels: Record<DeviceRole, string> = {
            [DeviceRole.STANDARD_POS]: '🖥️ POS Estándar',
            [DeviceRole.SELF_CHECKOUT]: '🛒 Auto-Pago',
            [DeviceRole.PRICE_CHECKER]: '🔍 Verificador de Precios',
            [DeviceRole.HANDHELD_INVENTORY]: '📱 Inventario Móvil',
            [DeviceRole.KITCHEN_DISPLAY]: '👨‍🍳 Pantalla Cocina'
        };

        return labels[role] || 'Terminal';
    }

    /**
     * Get UI settings for current role
     */
    getUISettings() {
        const roleConfig = this.getCurrentRoleConfig();

        return {
            fullscreenForced: roleConfig?.uiSettings.fullscreenForced || false,
            touchTargetSize: roleConfig?.uiSettings.touchTargetSize || 44,
            navigationLocked: roleConfig?.uiSettings.navigationLocked || false,
            escapeHatchEnabled: roleConfig?.uiSettings.escapeHatch?.enabled || false
        };
    }

    /**
     * Get hardware configuration for current role
     */
    getHardwareConfig() {
        const roleConfig = this.getCurrentRoleConfig();

        return {
            printerEnabled: !roleConfig?.hardwareConfig?.disablePrinter,
            cashDrawerEnabled: !roleConfig?.hardwareConfig?.disableCashDrawer,
            scannerEnabled: !roleConfig?.hardwareConfig?.disableScanner
        };
    }

    /**
     * Check if service is initialized
     */
    isInitialized(): boolean {
        return this.config !== null && this.currentTerminalId !== null;
    }
}

// Singleton export
export const authLevelService = new AuthLevelService();
