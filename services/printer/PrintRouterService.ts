import { BusinessConfig, PrinterDevice } from '../../types';
import { LocalPrintAgentService } from './LocalPrintAgentService';

export type PrinterRole = 'TICKET' | 'LABEL' | 'KITCHEN' | 'LOGISTICS';

interface RouteAndPrintParams {
    config: BusinessConfig;
    html: string;
    role: PrinterRole;
    terminalId?: string;
    jobType?: string;
    referenceId?: string;
    copies?: number;
}

const resolveTerminalPrinter = (
    config: BusinessConfig,
    role: PrinterRole,
    terminalId?: string
): PrinterDevice | undefined => {
    const terminal = (config.terminals || []).find(t => t.id === terminalId);
    const assignments = terminal?.config?.hardware?.printerAssignments || {};

    const assignedPrinterId =
        assignments[role] ||
        (role === 'TICKET' ? terminal?.config?.hardware?.receiptPrinterId : undefined);

    if (assignedPrinterId) {
        const assigned = (config.availablePrinters || []).find(p => p.id === assignedPrinterId);
        if (assigned) return assigned;
    }

    const byType = (config.availablePrinters || []).find(p => p.type === role);
    if (byType) return byType;

    if (role !== 'TICKET') {
        return (config.availablePrinters || []).find(p => p.type === 'TICKET');
    }

    return (config.availablePrinters || [])[0];
};

export const PrintRouterService = {
    routeAndPrintHtml: async ({
        config,
        html,
        role,
        terminalId,
        jobType,
        referenceId,
        copies = 1,
    }: RouteAndPrintParams): Promise<boolean> => {
        const printer = resolveTerminalPrinter(config, role, terminalId);
        if (!printer) return false;

        return LocalPrintAgentService.sendHtmlJob({
            html,
            printerId: printer.id,
            printerName: printer.name,
            printerAddress: printer.address,
            connection: printer.connection,
            role,
            jobType,
            referenceId,
            copies,
        });
    },
};
