import { BusinessConfig } from '../types';

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
