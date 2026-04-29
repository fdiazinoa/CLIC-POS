/**
 * Device Role Configuration Helpers
 * 
 * Default configurations and helper functions for different terminal device roles
 */

import { DeviceRole, AuthLevel, DeviceRoleConfig } from '../types';

const normalizeRoleKey = (value: unknown): string => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const data = value as Record<string, unknown>;
        return normalizeRoleKey(
            data.role ??
            data.deviceRole ??
            data.device_role ??
            data.deviceRoleCode ??
            data.device_role_code ??
            data.roleCode ??
            data.role_code ??
            data.value ??
            data.code ??
            data.label ??
            data.roleName ??
            data.role_name ??
            data.name
        );
    }

    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
};

const normalizeKnownDeviceRole = (normalized: string): DeviceRole | null => {
    switch (normalized) {
        case 'SELF_CHECKOUT':
        case 'SELF_CHECK_OUT':
        case 'SELFCHECKOUT':
        case 'SELFCHECK_OUT':
        case 'SELF_SERVICE':
        case 'SELFSERVICE':
        case 'KIOSK':
        case 'AUTOCHECKOUT':
        case 'AUTO_CHECKOUT':
        case 'AUTO_CHECK_OUT':
        case 'AUTOPAGO':
        case 'AUTO_PAGO':
        case 'AUTOSERVICIO':
        case 'AUTO_SERVICIO':
            return DeviceRole.SELF_CHECKOUT;

        case 'PRICE_CHECKER':
        case 'PRICECHECKER':
        case 'CHECKER':
        case 'VERIFICADOR_PRECIO':
        case 'VERIFICADOR_DE_PRECIO':
        case 'CONSULTA_PRECIOS':
            return DeviceRole.PRICE_CHECKER;

        case 'HANDHELD_INVENTORY':
        case 'HANDHELDINVENTORY':
        case 'INVENTORY_HANDHELD':
        case 'PDA':
        case 'MOBILE_INVENTORY':
        case 'INVENTARIO_MOVIL':
            return DeviceRole.HANDHELD_INVENTORY;

        case 'KITCHEN_DISPLAY':
        case 'KITCHENDISPLAY':
        case 'KDS':
        case 'COCINA':
        case 'PANTALLA_COCINA':
            return DeviceRole.KITCHEN_DISPLAY;

        case 'STANDARD_POS':
        case 'STANDARDPOS':
        case 'POS':
        case 'CAJA':
        case 'CAJERO':
        case 'CASHIER':
        case 'STANDARD':
            return DeviceRole.STANDARD_POS;

        default:
            return null;
    }
};

export function normalizeDeviceRoleValue(value: unknown, fallback: DeviceRole = DeviceRole.STANDARD_POS): DeviceRole {
    return normalizeKnownDeviceRole(normalizeRoleKey(value)) || fallback;
}

export function resolveDeviceRoleValue(values: unknown[]): DeviceRole | undefined;
export function resolveDeviceRoleValue(values: unknown[], fallback: DeviceRole): DeviceRole;
export function resolveDeviceRoleValue(values: unknown[], fallback?: DeviceRole): DeviceRole | undefined {
    for (const value of values) {
        const role = normalizeKnownDeviceRole(normalizeRoleKey(value));
        if (role) return role;
    }

    return fallback;
}

/**
 * Get default configuration for a device role
 */
export function getDefaultRoleConfig(role: DeviceRole): DeviceRoleConfig {
    const configs: Record<DeviceRole, DeviceRoleConfig> = {
        [DeviceRole.STANDARD_POS]: {
            role: DeviceRole.STANDARD_POS,
            authLevel: AuthLevel.USER_REQUIRED,
            allowedModules: ['*'], // All modules
            uiSettings: {
                fullscreenForced: false,
                touchTargetSize: 44,
                navigationLocked: false,
                escapeHatch: {
                    enabled: false,
                    gesture: '',
                    requirePin: false
                }
            },
            hardwareConfig: {
                disablePrinter: false,
                disableCashDrawer: false,
                disableScanner: false
            }
        },

        [DeviceRole.SELF_CHECKOUT]: {
            role: DeviceRole.SELF_CHECKOUT,
            authLevel: AuthLevel.HEADLESS,
            defaultRoute: '/kiosk/welcome',
            allowedModules: ['kiosk', 'auth'],
            uiSettings: {
                fullscreenForced: true,
                touchTargetSize: 64, // Large touch targets for customers
                navigationLocked: true, // Prevent going back
                escapeHatch: {
                    enabled: true,
                    gesture: 'logo-press-5s',
                    requirePin: true,
                    adminPin: '1234' // Default PIN
                }
            },
            hardwareConfig: {
                disablePrinter: false, // Keep for receipt printing
                disableCashDrawer: true, // No cash in self-checkout
                disableScanner: false
            }
        },

        [DeviceRole.PRICE_CHECKER]: {
            role: DeviceRole.PRICE_CHECKER,
            authLevel: AuthLevel.HEADLESS,
            defaultRoute: '/checker/scan',
            allowedModules: ['price_checker'],
            uiSettings: {
                fullscreenForced: true,
                touchTargetSize: 52,
                navigationLocked: true,
                escapeHatch: {
                    enabled: true,
                    gesture: 'logo-press-5s',
                    requirePin: true,
                    adminPin: '1234'
                }
            },
            hardwareConfig: {
                disablePrinter: true, // No printing
                disableCashDrawer: true, // No cash drawer
                disableScanner: false // Scanner is essential
            }
        },

        [DeviceRole.HANDHELD_INVENTORY]: {
            role: DeviceRole.HANDHELD_INVENTORY,
            authLevel: AuthLevel.USER_REQUIRED, // Employee must log in
            defaultRoute: '/inventory/home',
            allowedModules: ['inventory', 'auth', 'settings'],
            uiSettings: {
                fullscreenForced: false,
                touchTargetSize: 48, // Medium-sized for mobile
                navigationLocked: false, // Free navigation within allowed modules
                escapeHatch: {
                    enabled: false,
                    gesture: '',
                    requirePin: false
                }
            },
            hardwareConfig: {
                disablePrinter: false, // Keep for label printing
                disableCashDrawer: true, // No sales
                disableScanner: false // Essential for inventory
            }
        },

        [DeviceRole.KITCHEN_DISPLAY]: {
            role: DeviceRole.KITCHEN_DISPLAY,
            authLevel: AuthLevel.HEADLESS,
            defaultRoute: '/kitchen/orders',
            allowedModules: ['kitchen'],
            uiSettings: {
                fullscreenForced: true,
                touchTargetSize: 56,
                navigationLocked: true,
                escapeHatch: {
                    enabled: true,
                    gesture: 'logo-press-5s',
                    requirePin: true,
                    adminPin: '1234'
                }
            },
            hardwareConfig: {
                disablePrinter: false, // Can print kitchen tickets
                disableCashDrawer: true,
                disableScanner: true
            }
        }
    };

    return configs[role];
}

/**
 * Get display info for a device role
 */
export function getRoleDisplayInfo(role: DeviceRole) {
    const info: Record<DeviceRole, { icon: string; label: string; description: string }> = {
        [DeviceRole.STANDARD_POS]: {
            icon: '🖥️',
            label: 'POS Estándar',
            description: 'Punto de venta completo con todas las funcionalidades'
        },
        [DeviceRole.SELF_CHECKOUT]: {
            icon: '🛒',
            label: 'Auto-Pago',
            description: 'Kiosco de autoservicio para clientes'
        },
        [DeviceRole.PRICE_CHECKER]: {
            icon: '🔍',
            label: 'Verificador de Precios',
            description: 'Solo consulta de precios y promociones'
        },
        [DeviceRole.HANDHELD_INVENTORY]: {
            icon: '📱',
            label: 'Inventario Móvil',
            description: 'Conteo, recepción y etiquetado desde dispositivo móvil'
        },
        [DeviceRole.KITCHEN_DISPLAY]: {
            icon: '👨‍🍳',
            label: 'Pantalla en cocina',
            description: 'Display de órdenes para preparación'
        }
    };

    return info[role];
}

/**
 * Get all available modules
 */
export function getAllModules() {
    return [
        { value: '*', label: 'Todos los módulos', description: 'Acceso completo' },
        { value: 'sales', label: 'Ventas (POS)', description: 'Operaciones de venta' },
        { value: 'kiosk', label: 'Kiosco', description: 'Auto-pago de clientes' },
        { value: 'price_checker', label: 'Verificador de Precios', description: 'Consulta de precios' },
        { value: 'inventory', label: 'Inventario', description: 'Conteo y recepción' },
        { value: 'kitchen', label: 'Cocina', description: 'Display de órdenes' },
        { value: 'customers', label: 'Clientes', description: 'Gestión de clientes' },
        { value: 'history', label: 'Historial', description: 'Transacciones pasadas' },
        { value: 'finance', label: 'Finanzas', description: 'Dashboard financiero' },
        { value: 'reports', label: 'Reportes', description: 'Z Reports y análisis' },
        { value: 'supply_chain', label: 'Cadena de Suministro', description: 'Compras y proveedores' },
        { value: 'settings', label: 'Configuración', description: 'Ajustes del sistema' },
        { value: 'auth', label: 'Autenticación', description: 'Login y seguridad' }
    ];
}

/**
 * Validate role configuration
 */
export function validateRoleConfig(config: DeviceRoleConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check required fields
    if (!config.role) {
        errors.push('Rol de dispositivo es requerido');
    }

    if (!config.authLevel) {
        errors.push('Nivel de autenticación es requerido');
    }

    if (!config.allowedModules || config.allowedModules.length === 0) {
        errors.push('Debe especificar al menos un módulo permitido');
    }

    // Validate headless config
    if (config.authLevel === AuthLevel.HEADLESS) {
        if (!config.defaultRoute) {
            errors.push('Ruta por defecto es requerida para terminales headless');
        }
    }

    // Validate escape hatch
    if (config.uiSettings.escapeHatch?.enabled && config.uiSettings.escapeHatch.requirePin) {
        if (!config.uiSettings.escapeHatch.adminPin) {
            errors.push('PIN de administrador es requerido cuando escape hatch requiere PIN');
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}
