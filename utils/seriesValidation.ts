import { TerminalConfig, DocumentType } from '../types';

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

    const assignedSeriesId = terminalConfig.documentAssignments?.[documentType];

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
