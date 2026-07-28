import { TerminalConfig, DocumentType } from '../types';
import {
    isDocumentSeriesCompatibleWithType,
    resolveEffectiveSeriesIdForDocumentType,
} from './documentSeriesIdentity';

/** Mensaje cuando el ERP / política deshabilitó cortes parciales (X). */
export const PARTIAL_X_REPORT_DISABLED_MESSAGE =
    'Los cortes parciales (Reporte X) están deshabilitados para esta terminal desde el ERP.\n\n' +
    'Activa “Permitir reporte X parcial” en Configuración de terminal (ERP) o pide a un administrador que lo habilite.';

export function isPartialXReportAllowed(terminalConfig: TerminalConfig | undefined): boolean {
    return terminalConfig?.workflow?.session?.allowPartialXReport !== false;
}

const getAssignmentSources = (terminalConfig: TerminalConfig): Array<Record<string, unknown>> => {
    const config = terminalConfig as any;
    const snapshot = config.erpSnapshot || {};
    return [
        config.documentAssignments,
        config.document_assignments,
        config.documents?.assignments,
        snapshot.resolved?.documents?.assignments,
        snapshot.config?.documents?.assignments,
        snapshot.terminal_config?.documents?.assignments,
        snapshot.terminalConfig?.documents?.assignments,
    ].filter((source) => source && typeof source === 'object');
};

const getSeriesSources = (terminalConfig: TerminalConfig): unknown[][] => {
    const config = terminalConfig as any;
    const snapshot = config.erpSnapshot || {};
    return [
        config.documentSeries,
        config.document_series,
        snapshot.resolved?.documents?.documentSeries,
        snapshot.resolved?.documents?.document_series,
        snapshot.terminal_config?.documentSeries,
        snapshot.terminal_config?.document_series,
    ].filter(Array.isArray);
};

export const resolveTerminalDocumentSeriesId = (
    terminalConfig: TerminalConfig | undefined,
    documentType: DocumentType
): string | undefined => {
    if (!terminalConfig) return undefined;

    const series = getSeriesSources(terminalConfig).flat() as any[];
    const assignment = getAssignmentSources(terminalConfig)
        .map((source) => source[documentType] ?? source[documentType.toLowerCase()])
        .find((value) => typeof value === 'string' && value.trim());

    if (typeof assignment === 'string' && assignment.trim()) {
        return resolveEffectiveSeriesIdForDocumentType(documentType, series, assignment.trim()) || assignment.trim();
    }

    const authoritativeMatch = series.find((candidate) => (
        String(candidate?.source || candidate?.syncSource || '').toUpperCase().includes('ERP') &&
        candidate?.active !== false &&
        candidate?.enabled !== false &&
        isDocumentSeriesCompatibleWithType(documentType, candidate)
    ));

    return typeof authoritativeMatch?.id === 'string' && authoritativeMatch.id.trim()
        ? authoritativeMatch.id.trim()
        : undefined;
};

/**
 * Validate if a terminal has a series assigned for a specific document type
 */
export function validateTerminalSeries(
    terminalConfig: TerminalConfig | undefined,
    documentType: DocumentType
): { isValid: boolean; message?: string } {
    if (!terminalConfig) {
        return {
            isValid: false,
            message: 'No se ha configurado esta terminal.'
        };
    }

    if (documentType === 'X_REPORT' && !isPartialXReportAllowed(terminalConfig)) {
        return { isValid: false, message: PARTIAL_X_REPORT_DISABLED_MESSAGE };
    }

    const assignedSeriesId = resolveTerminalDocumentSeriesId(terminalConfig, documentType);

    if (!assignedSeriesId) {
        const typeLabels: Record<DocumentType, string> = {
            // Ventas
            TICKET: 'Tickets de Venta',
            REFUND: 'Devoluciones',
            VOID: 'Anulaciones',

            // Inventario
            TRANSFER: 'Traspasos',
            ADJUSTMENT_IN: 'Ajustes Positivos',
            ADJUSTMENT_OUT: 'Ajustes Negativos',
            PURCHASE: 'Compras',
            PRODUCTION: 'Producción',

            // Efectivo
            CASH_IN: 'Entradas de Efectivo',
            CASH_OUT: 'Salidas de Efectivo',
            CASH_DEPOSIT: 'Depósitos Bancarios',
            CASH_WITHDRAWAL: 'Retiros',

            // Cierres
            Z_REPORT: 'Cierres de Caja',
            X_REPORT: 'Cortes Parciales',

            // Cuentas
            RECEIVABLE: 'Cuentas por Cobrar',
            PAYABLE: 'Cuentas por Pagar',
            PAYMENT_IN: 'Cobros',
            PAYMENT_OUT: 'Pagos'
        };

        const label = typeLabels[documentType] || documentType;

        return {
            isValid: false,
            message: `Esta terminal no tiene una serie asignada para ${label}.\n\nPor favor, ve a Configuración > Terminales > Documentos y asigna una serie.`
        };
    }

    return { isValid: true };
}

/**
 * Get user-friendly label for document type
 */
export function getDocumentTypeLabel(documentType: DocumentType): string {
    const labels: Record<DocumentType, string> = {
        TICKET: 'Ticket de Venta',
        REFUND: 'Devolución',
        VOID: 'Anulación',
        TRANSFER: 'Traspaso',
        ADJUSTMENT_IN: 'Ajuste Positivo',
        ADJUSTMENT_OUT: 'Ajuste Negativo',
        PURCHASE: 'Compra',
        PRODUCTION: 'Producción',
        CASH_IN: 'Entrada de Efectivo',
        CASH_OUT: 'Salida de Efectivo',
        CASH_DEPOSIT: 'Depósito Bancario',
        CASH_WITHDRAWAL: 'Retiro',
        Z_REPORT: 'Cierre de Caja',
        X_REPORT: 'Corte Parcial',
        RECEIVABLE: 'Cuenta por Cobrar',
        PAYABLE: 'Cuenta por Pagar',
        PAYMENT_IN: 'Cobro',
        PAYMENT_OUT: 'Pago'
    };

    return labels[documentType] || documentType;
}
