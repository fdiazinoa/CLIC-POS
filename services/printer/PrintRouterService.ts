import { BusinessConfig, PrinterDevice } from '../../types';
import { LocalPrintAgentService } from './LocalPrintAgentService';
import { nativePrintBridge } from './NativePrintBridge';

export type PrinterRole = 'TICKET' | 'LABEL' | 'KITCHEN' | 'LOGISTICS';

interface RouteAndPrintParams {
    config: BusinessConfig;
    html: string;
    role: PrinterRole;
    terminalId?: string;
    jobType?: string;
    referenceId?: string;
    copies?: number;
    preferredPrinterId?: string;
}

interface RouteAndPrintEscPosParams {
    config: BusinessConfig;
    escPosBase64: string;
    role: PrinterRole;
    terminalId?: string;
    jobType?: string;
    referenceId?: string;
    copies?: number;
    preferredPrinterId?: string;
}

const resolveTerminalPrinter = (
    config: BusinessConfig,
    role: PrinterRole,
    terminalId?: string,
    preferredPrinterId?: string
): PrinterDevice | undefined => {
    if (preferredPrinterId) {
        const preferred = (config.availablePrinters || []).find(p => p.id === preferredPrinterId);
        if (preferred) return preferred;
    }

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
        preferredPrinterId,
    }: RouteAndPrintParams): Promise<boolean> => {
        const printer = resolveTerminalPrinter(config, role, terminalId, preferredPrinterId);
        if (!printer) return false;

        if (nativePrintBridge.isAvailable()) {
            const nativePrinted = await nativePrintBridge.printHtml({
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
            if (nativePrinted) return true;
        }

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

    routeAndPrintEscPos: async ({
        config,
        escPosBase64,
        role,
        terminalId,
        jobType,
        referenceId,
        copies = 1,
        preferredPrinterId,
    }: RouteAndPrintEscPosParams): Promise<boolean> => {
        const printer = resolveTerminalPrinter(config, role, terminalId, preferredPrinterId);
        if (!printer) return false;

        if (nativePrintBridge.isAvailable()) {
            const nativePrinted = await nativePrintBridge.printEscPos({
                dataBase64: escPosBase64,
                printerId: printer.id,
                printerName: printer.name,
                printerAddress: printer.address,
                connection: printer.connection,
                role,
                jobType,
                referenceId,
                copies,
            });

            if (nativePrinted) return true;
        }

        return LocalPrintAgentService.sendEscPosJob({
            dataBase64: escPosBase64,
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
