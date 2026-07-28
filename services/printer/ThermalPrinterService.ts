import { ZReport, BusinessConfig } from '../../types';
import { buildEscPosZReportPayload } from './EscPosFormatter';
import { generateZReportReceipt } from './templates/ZReportReceipt';
import { PrintRouterService } from './PrintRouterService';
import { shouldSuppressBrowserPrintFallback } from './PrintRuntime';

export const ThermalPrinterService = {
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
            const buildReceiptHtml = () => generateZReportReceipt(report, hiddenModules);

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

            doc.open();
            doc.write(receiptHtml);
            doc.close();

            // 3. Wait for content to load (images, fonts) then print with a timeout safety
            await new Promise<void>((resolve) => {
                const timeout = setTimeout(() => {
                    console.warn("⚠️ Print timeout reached, resolving anyway");
                    resolve();
                }, 3000);

                iframe.onload = () => {
                    setTimeout(() => {
                        try {
                            iframe.contentWindow?.focus();
                            iframe.contentWindow?.print();
                        } catch (e) {
                            console.error("Print error:", e);
                        }
                        clearTimeout(timeout);
                        resolve();
                    }, 500);
                };
            });

            // 4. Cleanup (remove iframe after a delay to allow print dialog to work)
            setTimeout(() => {
                document.body.removeChild(iframe);
            }, 5000);

            return true;
        } catch (error) {
            console.error("❌ Thermal Print Failed:", error);
            return false;
        }
    }
};
