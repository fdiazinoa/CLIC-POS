import { runPrintTask } from './PrintFeedback';
import { notifyBrowserPrint } from './BrowserPrint';
import { ZReport, BusinessConfig } from '../../types';
import { buildEscPosZReportPayload } from './EscPosFormatter';
import { generateZReportReceipt } from './templates/ZReportReceipt';
import { PrintRouterService } from './PrintRouterService';
import { shouldSuppressBrowserPrintFallback } from './PrintRuntime';
import { resolveConfiguredPrintCopies } from '../../utils/printCopies';

const ThermalPrinterServiceInternal = {
    /**
     * Prints a Z-Report using the browser's print capability (or native plugin in future).
     * @param report The Z-Report data to print
     * @returns Promise<boolean> indicating success
     */
    printZReport: async (
        report: ZReport,
        hiddenModules: string[] = [],
        config?: BusinessConfig,
        options?: { terminalId?: string; preferredPrinterId?: string; jobType?: string }
    ): Promise<boolean> => {
        try {
            console.log("🖨️ Starting Thermal Print Job for Z-Report:", report.sequenceNumber);

            // 1. Generate native ESC/POS first. Legacy saved Z reports may contain
            // non-ISO currency symbols in baseCurrency, so HTML fallback must never
            // block the native thermal payload.
            const runtimeConfig = config || ({ terminals: [], availablePrinters: [] } as BusinessConfig);
            const escPosBase64 = buildEscPosZReportPayload(report, hiddenModules, config);
            const isXReport = (report as any).reportType === 'X';
            const copies = resolveConfiguredPrintCopies(runtimeConfig, isXReport ? 'xReport' : 'zReport');
            const buildReceiptHtml = () => generateZReportReceipt(report, hiddenModules, config);

            let printedSilently = false;

            if (escPosBase64) {
                printedSilently = await PrintRouterService.routeAndPrintEscPos({
                    config: runtimeConfig,
                    escPosBase64,
                    role: 'TICKET',
                    terminalId: options?.terminalId || report.terminalId,
                    jobType: options?.jobType || 'Z_REPORT',
                    referenceId: report.id,
                    preferredPrinterId: options?.preferredPrinterId,
                    copies,
                });
            }

            if (!printedSilently && !shouldSuppressBrowserPrintFallback()) {
                printedSilently = await PrintRouterService.routeAndPrintHtml({
                    config: runtimeConfig,
                    html: buildReceiptHtml(),
                    role: 'TICKET',
                    terminalId: options?.terminalId || report.terminalId,
                    jobType: options?.jobType || 'Z_REPORT',
                    referenceId: report.id,
                    preferredPrinterId: options?.preferredPrinterId,
                    copies,
                });
            }

            if (printedSilently) return true;

            if (shouldSuppressBrowserPrintFallback()) {
                console.warn('Silent native Z report print failed; browser print fallback suppressed.');
                return false;
            }

            // 2. Create a hidden iframe to print without disrupting the UI
            const receiptHtml = buildReceiptHtml();
            const iframe = document.createElement('iframe');
            iframe.style.position = 'fixed';
            iframe.style.right = '0';
            iframe.style.bottom = '0';
            iframe.style.width = '0';
            iframe.style.height = '0';
            iframe.style.border = '0';
            document.body.appendChild(iframe);

            const doc = iframe.contentWindow?.document;
            if (!doc) throw new Error("Could not create print frame");

            // Register onload before writing; a timeout or print exception is failure.
            try {
                await new Promise<void>((resolve, reject) => {
                    let settled = false;
                    let printTimer: ReturnType<typeof setTimeout>;
                    const finish = (error?: Error) => {
                        if (settled) return;
                        settled = true;
                        clearTimeout(timeout);
                        clearTimeout(printTimer);
                        iframe.onload = null;
                        error ? reject(error) : resolve();
                    };
                    const timeout = setTimeout(() => finish(new Error('PRINT_FRAME_TIMEOUT')), 3000);
                    iframe.onload = () => {
                        printTimer = setTimeout(() => {
                            if (settled) return;
                            try {
                                if (!iframe.contentWindow) throw new Error('PRINT_FRAME_UNAVAILABLE');
                                iframe.contentWindow.focus();
                                iframe.contentWindow.print();
                                finish();
                            } catch (error) {
                                finish(error instanceof Error ? error : new Error('PRINT_FRAME_FAILED'));
                            }
                        }, 500);
                    };
                    doc.open();
                    doc.write(receiptHtml);
                    doc.close();
                });
                notifyBrowserPrint();
                return true;
            } finally {
                setTimeout(() => iframe.remove(), 5000);
            }
        } catch (error) {
            console.error("❌ Thermal Print Failed:", error);
            throw error;
        }
    }
};

export const ThermalPrinterService = {
    printZReport: (...args: Parameters<typeof ThermalPrinterServiceInternal.printZReport>): Promise<boolean> =>
        runPrintTask(`report:${args[0].id}`, (args[0] as any).reportType === 'X' ? 'Cierre X' : 'Cierre Z', () => ThermalPrinterServiceInternal.printZReport(...args)),
};
