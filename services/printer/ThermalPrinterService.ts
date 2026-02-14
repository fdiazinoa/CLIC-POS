import { ZReport, BusinessConfig } from '../../types';
import { generateZReportReceipt } from './templates/ZReportReceipt';
import { PrintRouterService } from './PrintRouterService';

export const ThermalPrinterService = {
    /**
     * Prints a Z-Report using the browser's print capability (or native plugin in future).
     * @param report The Z-Report data to print
     * @returns Promise<boolean> indicating success
     */
    printZReport: async (report: ZReport, hiddenModules: string[] = [], config?: BusinessConfig): Promise<boolean> => {
        try {
            console.log("🖨️ Starting Thermal Print Job for Z-Report:", report.sequenceNumber);

            // 1. Generate HTML Content for Thermal Paper (80mm width approx)
            const receiptHtml = generateZReportReceipt(report, hiddenModules);

            const printedSilently = await PrintRouterService.routeAndPrintHtml({
                config: config || ({ terminals: [], availablePrinters: [] } as BusinessConfig),
                html: receiptHtml,
                role: 'TICKET',
                terminalId: report.terminalId,
                jobType: 'Z_REPORT',
                referenceId: report.id,
            });

            if (printedSilently) return true;

            // 2. Create a hidden iframe to print without disrupting the UI
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
