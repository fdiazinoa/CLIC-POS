import { notifyPrintQueued, runPrintTask } from '../services/printer/PrintFeedback';
import { BusinessConfig, LabelElement, LabelTemplate } from '../types';
import { PrintRouterService } from '../services/printer/PrintRouterService';
import { buildEscPosLabelPayload } from '../services/printer/EscPosFormatter';
import { nativePrintBridge } from '../services/printer/NativePrintBridge';
import { offlinePrintQueueService } from '../services/printer/OfflinePrintQueueService';
import { shouldSuppressBrowserPrintFallback } from '../services/printer/PrintRuntime';

const MM_TO_PX = 3.78;

export interface LabelPrintRecord {
  productId: string;
  productName: string;
  sku?: string;
  price?: number;
  copies: number;
}

interface PrintLabelsOptions {
  config: BusinessConfig;
  template: LabelTemplate;
  records: LabelPrintRecord[];
  terminalId?: string;
  referenceId?: string;
}

export interface PrintLabelsResult {
  printed: boolean;
  method: 'silent' | 'browser' | 'queued' | 'none';
  message: string;
}

const escapeHtml = (value: string): string => (
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
);

const valueFromElement = (
  element: LabelElement,
  record: LabelPrintRecord,
  currencySymbol: string
): string => {
  switch (element.dataSource) {
    case 'PRODUCT_NAME':
      return record.productName || element.content || '';
    case 'PRODUCT_PRICE':
      return typeof record.price === 'number' ? `${currencySymbol}${record.price.toFixed(2)}` : element.content || '';
    case 'PRODUCT_SKU':
      return record.sku || record.productId || element.content || '';
    case 'CUSTOM_TEXT':
    default:
      return element.content || '';
  }
};

const renderElement = (
  element: LabelElement,
  record: LabelPrintRecord,
  currencySymbol: string
): string => {
  const top = element.y * MM_TO_PX;
  const left = element.x * MM_TO_PX;
  const width = element.width * MM_TO_PX;
  const height = element.height * MM_TO_PX;
  const fontSize = Math.max(8, element.fontSize || 10);
  const text = escapeHtml(valueFromElement(element, record, currencySymbol));

  const sharedStyle = [
    'position:absolute',
    `left:${left}px`,
    `top:${top}px`,
    `width:${width}px`,
    `height:${height}px`,
    'overflow:hidden',
  ].join(';');

  if (element.type === 'BARCODE') {
    return `
      <div style="${sharedStyle};display:flex;align-items:center;justify-content:center;border-top:1px solid #111;border-bottom:1px solid #111;font-family:'Courier New',monospace;letter-spacing:1.5px;font-size:${Math.max(8, fontSize - 1)}px;">
        ${text}
      </div>
    `;
  }

  if (element.type === 'QR') {
    return `
      <div style="${sharedStyle};display:flex;align-items:center;justify-content:center;border:1px solid #111;position:absolute;">
        <div style="width:${Math.max(14, height - 8)}px;height:${Math.max(14, height - 8)}px;border:2px solid #111;position:relative;">
          <div style="position:absolute;left:3px;top:3px;width:5px;height:5px;background:#111;"></div>
          <div style="position:absolute;right:3px;top:3px;width:5px;height:5px;background:#111;"></div>
          <div style="position:absolute;left:3px;bottom:3px;width:5px;height:5px;background:#111;"></div>
        </div>
      </div>
    `;
  }

  return `
    <div style="${sharedStyle};font-size:${fontSize}px;font-weight:${element.isBold ? 700 : 400};display:flex;align-items:flex-start;white-space:nowrap;text-overflow:ellipsis;">
      ${text}
    </div>
  `;
};

const renderPrintableDocument = (
  template: LabelTemplate,
  records: LabelPrintRecord[],
  currencySymbol: string,
  autoPrint: boolean
): string => {
  const labelsHtml = records
    .flatMap(record => Array.from({ length: record.copies }, (_, idx) => ({ ...record, _copy: idx + 1 })))
    .map(record => `
      <div class="label-page">
        <div class="label">
          ${template.elements.map(element => renderElement(element, record, currencySymbol)).join('')}
        </div>
      </div>
    `)
    .join('');

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Impresion de etiquetas</title>
        <style>
          @page {
            size: ${template.widthMm}mm ${template.heightMm}mm;
            margin: 0;
          }
          html, body {
            margin: 0;
            padding: 0;
            background: #fff;
          }
          body {
            font-family: Arial, sans-serif;
          }
          .label-page {
            width: ${template.widthMm}mm;
            height: ${template.heightMm}mm;
            page-break-after: always;
            break-after: page;
            overflow: hidden;
          }
          .label-page:last-child {
            page-break-after: auto;
            break-after: auto;
          }
          .label {
            width: ${template.widthMm * MM_TO_PX}px;
            height: ${template.heightMm * MM_TO_PX}px;
            position: relative;
            box-sizing: border-box;
          }
        </style>
      </head>
      <body>
        ${labelsHtml}
        ${autoPrint ? `
          <script>
            window.onload = function () {
              setTimeout(function () { window.print(); }, 250);
            };
          </script>
        ` : ''}
      </body>
    </html>
  `;
};

const printLabelsFromTemplateInternal = async ({
  config,
  template,
  records,
  terminalId,
  referenceId
}: PrintLabelsOptions): Promise<PrintLabelsResult> => {
  const preparedRecords = records.filter(record => Number.isFinite(record.copies) && record.copies > 0);
  if (preparedRecords.length === 0) {
    return {
      printed: false,
      method: 'none',
      message: 'No hay etiquetas para imprimir con la configuracion actual.'
    };
  }

  const printRef = referenceId || `LBL-${Date.now()}`;
  const printableHtml = renderPrintableDocument(template, preparedRecords, config.currencySymbol || '$', false);
  const escPosBase64 = buildEscPosLabelPayload(preparedRecords, config.currencySymbol || '$');

  let printedSilently = false;

  try {
    if (escPosBase64) {
      printedSilently = await PrintRouterService.routeAndPrintEscPos({
        config,
        escPosBase64,
        role: 'LABEL',
        terminalId,
        jobType: 'LABEL',
        referenceId: printRef
      });
    }

    if (!printedSilently) {
      printedSilently = await PrintRouterService.routeAndPrintHtml({
        config,
        html: printableHtml,
        role: 'LABEL',
        terminalId,
        jobType: 'LABEL',
        referenceId: printRef
      });
    }
  } catch {
    // Keep the existing offline queue path for unavailable native printers.
    printedSilently = false;
  }

  if (printedSilently) {
    return {
      printed: true,
      method: 'silent',
      message: 'Etiquetas enviadas a la impresora configurada de la terminal.'
    };
  }

  const shouldQueue = !navigator.onLine || nativePrintBridge.isAvailable();
  if (shouldQueue) {
    await offlinePrintQueueService.enqueueJob({
      role: 'LABEL',
      terminalId,
      jobType: 'LABEL',
      referenceId: printRef,
      html: printableHtml,
      escPosBase64: escPosBase64 || undefined,
      source: 'LABEL_PRINT'
    });

    return {
      printed: false,
      method: 'queued',
      message: 'Impresion en cola. Se enviara automaticamente cuando la impresora este disponible.'
    };
  }

  if (shouldSuppressBrowserPrintFallback()) {
    return {
      printed: false,
      method: 'none',
      message: 'No se pudo enviar la impresion silenciosa a la impresora configurada.'
    };
  }

  const browserHtml = renderPrintableDocument(template, preparedRecords, config.currencySymbol || '$', true);
  const printWindow = window.open('', '_blank', 'width=900,height=700');
  if (!printWindow) {
    return {
      printed: false,
      method: 'none',
      message: 'No se pudo abrir la ventana de impresion. Verifica bloqueador de ventanas emergentes.'
    };
  }

  printWindow.document.write(browserHtml);
  printWindow.document.close();
  return {
    printed: true,
    method: 'browser',
    message: 'Se abrio la ventana del navegador para imprimir etiquetas.'
  };
};

export const printLabelsFromTemplate = async (options: PrintLabelsOptions): Promise<PrintLabelsResult> => {
  let result: PrintLabelsResult = { printed: false, method: 'none', message: 'No se pudo confirmar la impresión de etiquetas.' };
  await runPrintTask(`labels:${JSON.stringify([options.terminalId, options.referenceId, options.template, options.records])}`, 'Etiquetas', async () => {
    result = await printLabelsFromTemplateInternal(options);
    if (result.method === 'queued') {
      notifyPrintQueued();
      return true; // Accepted by the queue; result.printed remains false.
    }
    return result.printed;
  });
  return result;
};
