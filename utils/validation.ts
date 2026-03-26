import { BusinessConfig, Product } from '../types';

export const validateTerminalDocument = (
    config: BusinessConfig,
    terminalId: string,
    role: 'TICKET' | 'REFUND' | 'TRANSFER'
): { isValid: boolean; error?: string } => {
    const terminal = (config.terminals || []).find(t => t.id === terminalId) || (config.terminals || [])[0];

    if (!terminal) {
        return { isValid: false, error: 'Terminal no encontrada.' };
    }

    const assignment = terminal.config.documentAssignments?.[role];

    if (!assignment) {
        const roleNames = {
            'TICKET': 'Ticket de Venta (POS)',
            'REFUND': 'Nota de Crédito (Devolución)',
            'TRANSFER': 'Nota de Traspaso'
        };
        return {
            isValid: false,
            error: `🚫 ACCIÓN DENEGADA\n\nEsta terminal (${terminal.id}) no tiene una serie de documentos asignada para: ${roleNames[role]}.\n\nPor favor, vaya a Ajustes > Terminales > Series / Documentos y asigne una secuencia.`
        };
    }

    return { isValid: true };
};

/**
 * Treat an empty or missing warehouse list as globally available.
 * Older catalogs and web imports often don't persist per-warehouse flags.
 */
export const isProductEnabledInWarehouse = (
    product: Product,
    warehouseId: string
): boolean => {
    if (!warehouseId) return true;

    const activeWarehouses = Array.isArray(product.activeInWarehouses)
        ? product.activeInWarehouses.filter(Boolean)
        : [];

    if (activeWarehouses.length === 0) return true;

    return activeWarehouses.includes(warehouseId);
};

/**
 * Validates if a product is explicitly enabled in a specific warehouse.
 * Centralized business rule for Strict Warehouse Mode.
 */
export const validateWarehouseAccess = (
    product: Product,
    warehouseId: string
): { isValid: boolean; error?: string } => {
    if (!warehouseId) return { isValid: true }; // Skip if no warehouse context provided

    const isEnabled = isProductEnabledInWarehouse(product, warehouseId);

    if (!isEnabled) {
        return {
            isValid: false,
            error: `Artículo no habilitado en este almacén.`
        };
    }

    return { isValid: true };
};
