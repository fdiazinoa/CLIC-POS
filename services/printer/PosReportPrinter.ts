import type { BusinessConfig } from '../../types';
import { buildEscPosVoucherPayload } from './EscPosFormatter';
import { PrintRouterService } from './PrintRouterService';
import { runPrintTask } from './PrintFeedback';
import { shouldSuppressBrowserPrintFallback } from './PrintRuntime';
import { notifyBrowserPrint } from './BrowserPrint';

export const posReportHtml = (text: string): string => {
  const escaped = text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
  return `<!doctype html><html><head><meta charset="utf-8"><title>Informe POS</title><style>@page{margin:3mm}body{margin:0;width:48mm;font:11px monospace}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><pre>${escaped}</pre></body></html>`;
};

export const printPosReport = (text: string, config: BusinessConfig, terminalId?: string): Promise<boolean> =>
  runPrintTask(`pos-report:${terminalId || 'local'}`, 'Informe POS', async () => {
    // Compact 32-column output fits the narrow ticket format. No drawer command.
    const escPosBase64 = buildEscPosVoucherPayload('INFORMES POS', 'CONSULTA', text, 32)!;
    const params = { config, role: 'TICKET' as const, terminalId, jobType: 'TICKET', copies: 1 };
    if (await PrintRouterService.routeAndPrintEscPos({ ...params, escPosBase64 })) return true;
    if (shouldSuppressBrowserPrintFallback()) return false;
    const html = posReportHtml(text);
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
