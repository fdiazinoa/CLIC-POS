import type { BusinessConfig } from '../../types';
import type { PosReportDocument } from './PosReportDocument';
import { buildQueryReportEscPos, buildQueryReportHtml, QUERY_THERMAL_80MM, type QueryThermalProfile } from './PosReportThermalLayout';
import { PrintRouterService } from './PrintRouterService';
import { runPrintTask } from './PrintFeedback';
import { shouldSuppressBrowserPrintFallback } from './PrintRuntime';
import { notifyBrowserPrint } from './BrowserPrint';

export const posReportHtml = buildQueryReportHtml;

export const printPosReport = (report: PosReportDocument, config: BusinessConfig, terminalId?: string, profile: QueryThermalProfile = QUERY_THERMAL_80MM): Promise<boolean> =>
  runPrintTask(`pos-report:${terminalId || 'local'}`, 'Informe POS', async () => {
    const params = { config, role: 'TICKET' as const, terminalId, jobType: 'TICKET', copies: 1 };
    // Native Android writes ESC/POS bytes. The local desktop agent in this repo
    // spools HTML and does not consume dataBase64: do not submit an empty raw job.
    if (shouldSuppressBrowserPrintFallback()) {
      const escPosBase64 = buildQueryReportEscPos(report, profile);
      return PrintRouterService.routeAndPrintEscPos({ ...params, escPosBase64 });
    }
    const html = posReportHtml(report, profile);
    if (await PrintRouterService.routeAndPrintHtml({ ...params, html })) return true;
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;width:0;height:0;border:0';
    document.body.appendChild(iframe);
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('PRINT_FRAME_TIMEOUT')), 3000);
        iframe.onload = () => {
          clearTimeout(timeout);
          try {
            if (!iframe.contentWindow) throw new Error('PRINT_FRAME_UNAVAILABLE');
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
            resolve();
          } catch (error) { reject(error); }
        };
        iframe.srcdoc = html;
      });
      notifyBrowserPrint();
      return true;
    } finally { setTimeout(() => iframe.remove(), 5000); }
  });
