import { BusinessConfig, Product, Warehouse } from '../types';
import { isProductWarehouseActive } from './masterIdentity';
import { isDocumentSeriesCompatibleWithType } from './documentSeriesIdentity';

type ConfiguredTerminal = BusinessConfig['terminals'][number];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizeTerminalKey = (value: unknown): string =>
    typeof value === 'string' ? value.trim().toLowerCase() : '';

const getTerminalKeys = (terminal: ConfiguredTerminal): string[] => {
    const rawConfig = terminal.config as any;
    return [
        terminal.id,
        (terminal as any).name,
        rawConfig?.terminalName,
        rawConfig?.stationNumber,
        rawConfig?.erpTerminalId,
        rawConfig?.erpBinding?.terminalId,
        rawConfig?.erpBinding?.terminalName,
        rawConfig?.erpBinding?.stationNumber,
    ].map(normalizeTerminalKey).filter(Boolean);
};

const resolveTerminal = (config: BusinessConfig, terminalId: string): ConfiguredTerminal | undefined => {
    const terminals = Array.isArray(config.terminals) ? config.terminals : [];
    const requestedKey = normalizeTerminalKey(terminalId);
    if (!requestedKey) return terminals.length === 1 ? terminals[0] : undefined;
    return terminals.find((terminal) => getTerminalKeys(terminal).includes(requestedKey));
};

const resolveTerminalLabel = (terminal: ConfiguredTerminal): string => {
    const rawConfig = terminal.config as any;
    const candidates = [
        rawConfig?.terminalName,
        rawConfig?.erpBinding?.terminalName,
        rawConfig?.stationNumber,
        rawConfig?.erpBinding?.stationNumber,
        (terminal as any).name,
        terminal.id,
    ];
    const label = candidates.find((value) => {
        const normalized = typeof value === 'string' ? value.trim() : '';
        return normalized && !UUID_PATTERN.test(normalized);
    });
    return typeof label === 'string' ? label.trim() : 'activa';
};

const resolveDocumentAssignment = (terminal: ConfiguredTerminal, role: string): string => {
    const rawConfig = terminal.config as any;
    const snapshot = rawConfig?.erpSnapshot || {};
    const assignmentSources = [
        rawConfig?.documentAssignments,
        rawConfig?.document_assignments,
        rawConfig?.documents?.assignments,
        snapshot?.resolved?.documents?.assignments,
        snapshot?.config?.documents?.assignments,
        snapshot?.terminal_config?.documents?.assignments,
        snapshot?.terminalConfig?.documents?.assignments,
    ];

    for (const assignments of assignmentSources) {
        if (!assignments || typeof assignments !== 'object') continue;
        const value = assignments[role] ?? assignments[role.toLowerCase()];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }

    return '';
};

const hasAuthoritativeSeries = (terminal: ConfiguredTerminal, role: string): boolean => {
    const rawConfig = terminal.config as any;
    const snapshot = rawConfig?.erpSnapshot || {};
    const seriesSources = [
        rawConfig?.documentSeries,
        rawConfig?.document_series,
        snapshot?.resolved?.documents?.documentSeries,
        snapshot?.resolved?.documents?.document_series,
        snapshot?.terminal_config?.documentSeries,
        snapshot?.terminal_config?.document_series,
    ];

    return seriesSources.some((source) => Array.isArray(source) && source.some((series) => (
        String(series?.source || series?.syncSource || '').toUpperCase().includes('ERP') &&
        series?.active !== false &&
        series?.enabled !== false &&
        isDocumentSeriesCompatibleWithType(role, series)
    )));
};

export const validateTerminalDocument = (
    config: BusinessConfig,
    terminalId: string,
    role: 'TICKET' | 'REFUND' | 'TRANSFER'
): { isValid: boolean; error?: string } => {
    const terminal = resolveTerminal(config, terminalId);

    if (!terminal) {
        return { isValid: false, error: 'No se pudo identificar la terminal activa. Vuelva a seleccionarla e intente nuevamente.' };
    }

    const assignment = resolveDocumentAssignment(terminal, role);

    if (!assignment && !hasAuthoritativeSeries(terminal, role)) {
        const roleNames = {
            'TICKET': 'Ticket de Venta (POS)',
            'REFUND': 'Nota de Crédito (Devolución)',
            'TRANSFER': 'Nota de Traspaso'
        };
        const terminalLabel = resolveTerminalLabel(terminal);
        return {
            isValid: false,
            error: `ACCIÓN DENEGADA\n\nLa terminal ${terminalLabel} no tiene una serie de documentos asignada para: ${roleNames[role]}.\n\nPor favor, vaya a Ajustes > Terminales > Series / Documentos y asigne una secuencia.`
        };
    }

    return { isValid: true };
};

/**
 * Validates if a product is explicitly enabled in a specific warehouse.
 * Centralized business rule for Strict Warehouse Mode.
 */
export const validateWarehouseAccess = (
    product: Product,
    warehouseId: string,
    warehouses: Warehouse[] = []
): { isValid: boolean; error?: string } => {
    if (!warehouseId) return { isValid: true }; // Skip if no warehouse context provided

    const isEnabled = isProductWarehouseActive(product, warehouseId, warehouses);

    if (!isEnabled) {
        return {
            isValid: false,
            error: `Artículo no habilitado en este almacén.`
        };
    }

    return { isValid: true };
};
