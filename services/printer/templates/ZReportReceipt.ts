import { ZReport } from '../../../types';

export const generateZReportReceipt = (report: ZReport, hiddenModules: string[] = []): string => {
  const width = '80mm'; // Standard thermal paper width

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('es-DO', { style: 'currency', currency }).format(amount);
  };

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleString('es-DO', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  // Helper for dashed lines
  const line = '-'.repeat(32); // Approx 32 chars for 58mm, adjust for 80mm if needed

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Z-Report ${report.sequenceNumber}</title>
      <style>
        @page { margin: 0; size: auto; }
        body {
          font-family: 'Courier New', Courier, monospace; /* Monospaced for alignment */
          width: ${width};
          margin: 0;
          padding: 10px;
          font-size: 12px;
          line-height: 1.2;
          color: black;
          background: white;
        }
        .center { text-align: center; }
        .right { text-align: right; }
        .bold { font-weight: bold; }
        .row { display: flex; justify-content: space-between; }
        .divider { border-top: 1px dashed black; margin: 5px 0; }
        .section-title { margin-top: 10px; font-weight: bold; text-transform: uppercase; border-bottom: 1px solid black; display: inline-block; }
        .total-row { font-size: 14px; font-weight: bold; margin-top: 5px; }
      </style>
    </head>
    <body>
      
      <!-- HEADER -->
      <div class="center">
        <div class="bold" style="font-size: 16px;">CLIC POS</div>
        <div>Sucursal Principal</div>
        <div>RNC: 123456789</div>
        <div>Tel: 809-555-0123</div>
        <br/>
        <div class="bold" style="font-size: 14px;">REPORTE DE CIERRE (Z)</div>
        <div class="bold">${report.sequenceNumber}</div>
      </div>

      <div class="divider"></div>

      <!-- INFO -->
      <div class="row">
        <span>Fecha:</span>
        <span>${formatDate(report.closedAt)}</span>
      </div>
      <div class="row">
        <span>Cajero:</span>
        <span>${report.closedByUserName}</span>
      </div>
      <div class="row">
        <span>Terminal:</span>
        <span>${report.terminalId || 'POS-01'}</span>
      </div>

      <div class="divider"></div>

      <!-- FINANCIAL SUMMARY -->
      ${!hiddenModules.includes('FINANCIAL') ? `
      <div class="bold">RESUMEN FINANCIERO</div>
      <div class="row">
        <span>Ventas Totales:</span>
        <span class="bold">${formatCurrency(Object.values(report.totalsByMethod).reduce((a, b) => a + b, 0), report.baseCurrency)}</span>
      </div>
      <div class="row">
        <span>Transacciones:</span>
        <span>${report.transactionCount}</span>
      </div>
      ` : ''}
      
      <!-- PAYMENT METHODS -->
      ${!hiddenModules.includes('PAYMENTS') ? `
      <div class="section-title">MÉTODOS DE PAGO</div>
      ${Object.entries(report.totalsByMethod).map(([method, amount]) => `
        <div class="row">
          <span>${method}:</span>
          <span>${formatCurrency(amount, report.baseCurrency)}</span>
        </div>
      `).join('')}
      ` : ''}

      <!-- CASH DETAILS -->
      ${!hiddenModules.includes('CASH_DETAILS') ? `
      <div class="section-title">ARQUEO DE CAJA</div>
      ${Object.keys(report.cashExpected).map(currency => {
    const expected = report.cashExpected[currency] || 0;
    const counted = report.cashCounted[currency] || 0;
    const diff = report.cashDiscrepancy[currency] || 0;
    return `
          <div style="margin-bottom: 5px;">
            <div class="bold" style="text-decoration: underline;">${currency}</div>
            <div class="row"><span>Esperado:</span> <span>${expected.toFixed(2)}</span></div>
            <div class="row"><span>Contado:</span> <span>${counted.toFixed(2)}</span></div>
            <div class="row"><span>Diferencia:</span> <span class="bold">${diff > 0 ? '+' : ''}${diff.toFixed(2)}</span></div>
          </div>
        `;
  }).join('')}
      ` : ''}

      <!-- KPIS -->
      ${!hiddenModules.includes('KPIS') && report.stats ? `
        <div class="divider"></div>
        <div class="bold center">ESTADÍSTICAS DEL TURNO</div>
        <div class="row">
          <span>Ticket Promedio:</span>
          <span>${formatCurrency(report.stats.averageTicket, report.baseCurrency)}</span>
        </div>
        <div class="row">
          <span>Items / Venta:</span>
          <span>${report.stats.itemsPerSale.toFixed(1)}</span>
        </div>
        <div class="row">
          <span>Prod. Estrella:</span>
          <span>${report.stats.topProduct?.name.substring(0, 15) || 'N/A'}</span>
        </div>
        <div class="right" style="font-size: 10px;">(${report.stats.topProduct?.quantity || 0} unds)</div>
      ` : ''}

      <!-- AUDIT (New) -->
      ${!hiddenModules.includes('AUDIT') && report.stats ? `
        <div class="divider"></div>
        <div class="bold center">AUDITORÍA</div>
        <div class="row">
          <span>Devoluciones:</span>
          <span>${report.stats.returnsCount} (${formatCurrency(report.stats.returnsTotal, report.baseCurrency)})</span>
        </div>
        <div class="row">
          <span>Descuentos:</span>
          <span>${formatCurrency(report.stats.discountsTotal || 0, report.baseCurrency)}</span>
        </div>
      ` : ''}

      <br/><br/>
      <div class="divider"></div>
      <div class="center">
        <br/>
        __________________________<br/>
        Firma del Cajero
      </div>
      <br/>
      <div class="center" style="font-size: 10px;">
        Generado por CLIC POS<br/>
        ${new Date().toLocaleString()}
      </div>

    </body>
    </html>
  `;
};
