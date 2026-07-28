import { ZReport } from '../../../types';

export const generateZReportReceipt = (report: ZReport, hiddenModules: string[] = []): string => {
  const width = '80mm'; // Standard thermal paper width
  const isXReport = (report as any).reportType === 'X';
  const reportTitle = isXReport ? 'CIERRE X (ARQUEO)' : 'REPORTE DE CIERRE (Z)';
  const totalsByMethod = report.totalsByMethod || {};
  const cashExpected = report.cashExpected || {};
  const cashCounted = report.cashCounted || {};
  const cashDiscrepancy = report.cashDiscrepancy || {};
  const cashMovementDetails = Array.isArray(report.cashMovementDetails) ? report.cashMovementDetails : [];
  const stats = (report.stats || {}) as any;
  const rawCurrency = String(report.baseCurrency || '').trim();
  const currencyCode = /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : '';
  const currencyPrefix = currencyCode ? '' : (rawCurrency || '$');

  const formatCurrency = (amount: number) => {
    const value = Number(amount || 0);
    if (currencyCode) {
      try {
        return new Intl.NumberFormat('es-DO', { style: 'currency', currency: currencyCode }).format(value);
      } catch {
        // Some legacy Z reports stored symbols instead of ISO currency codes.
      }
    }
    return `${currencyPrefix}${value.toFixed(2)}`;
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
      <title>${isXReport ? 'X-Report' : 'Z-Report'} ${report.sequenceNumber}</title>
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
        <div class="bold" style="font-size: 14px;">${reportTitle}</div>
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
        <span class="bold">${report.closedByUserName}</span>
      </div>
      <div class="row" style="font-size: 14px; margin-top: 4px;">
        <span class="bold">CAJA/TERMINAL:</span>
        <span class="bold">${report.terminalId || 'POS-01'}</span>
      </div>

      <div class="divider"></div>

      <!-- FINANCIAL SUMMARY -->
      ${!hiddenModules.includes('FINANCIAL') ? `
      <div class="bold">RESUMEN FINANCIERO</div>
      <div class="row">
        <span>Ventas Brutas:</span>
        <span>${formatCurrency(stats.grossSales || 0)}</span>
      </div>
      <div class="row">
        <span>Devoluciones/NC:</span>
        <span>- ${formatCurrency(stats.returnsTotal || 0)}</span>
      </div>
      <div class="divider" style="margin: 2px 0; border-top: 0.5px solid #ccc;"></div>
      <div class="row">
        <span>Ventas Netas:</span>
        <span class="bold">${formatCurrency(stats.netSales || 0)}</span>
      </div>
      <div class="row">
        <span>Recaud. Anticipos:</span>
        <span>${formatCurrency(stats.advancementsTotal || 0)}</span>
      </div>
      <div class="row total-row">
        <span>TOTAL REBROCADO:</span>
        <span>${formatCurrency(Object.values(totalsByMethod).reduce((a, b) => a + Number(b || 0), 0))}</span>
      </div>
      <div class="row">
        <span>Transacciones:</span>
        <span>${report.transactionCount}</span>
      </div>
      ` : ''}
      
      <!-- PAYMENT METHODS -->
      ${!hiddenModules.includes('PAYMENTS') ? `
      <div class="section-title">MÉTODOS DE PAGO</div>
      ${Object.entries(totalsByMethod).map(([method, amount]) => `
        <div class="row">
          <span>${method}:</span>
          <span>${formatCurrency(Number(amount || 0))}</span>
        </div>
      `).join('')}
      ` : ''}

      <!-- CASH DETAILS -->
      ${!hiddenModules.includes('CASH_DETAILS') ? `
      <div class="section-title">ARQUEO DE CAJA</div>
      ${Object.keys(cashExpected).map(currency => {
    const expected = cashExpected[currency] || 0;
    const counted = cashCounted[currency] || 0;
    const diff = cashDiscrepancy[currency] || 0;
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

      ${!hiddenModules.includes('CASH_DETAILS') && cashMovementDetails.length > 0 ? `
      <div class="section-title">ENTRADAS / SALIDAS DE EFECTIVO</div>
      ${cashMovementDetails.map(movement => `
        <div style="margin-bottom: 5px;">
          <div class="row">
            <span class="bold">${movement.type === 'IN' ? 'Entrada' : 'Salida'}</span>
            <span>${formatCurrency(Number(movement.amount || 0))}</span>
          </div>
          <div style="font-size: 11px;">${movement.reason || 'Movimiento General'}</div>
          <div style="font-size: 10px;">${movement.timestamp ? formatDate(movement.timestamp) : ''}${movement.userName ? ` · ${movement.userName}` : ''}</div>
        </div>
      `).join('')}
      ` : ''}

      <!-- KPIS -->
      ${!hiddenModules.includes('KPIS') && report.stats ? `
        <div class="divider"></div>
        <div class="bold center">ESTADÍSTICAS DEL TURNO</div>
        <div class="row">
          <span>Ticket Promedio:</span>
          <span>${formatCurrency(stats.averageTicket || 0)}</span>
        </div>
        <div class="row">
          <span>Items / Venta:</span>
          <span>${Number(stats.itemsPerSale || 0).toFixed(1)}</span>
        </div>
        <div class="row">
          <span>Prod. Estrella:</span>
          <span>${stats.topProduct?.name.substring(0, 15) || 'N/A'}</span>
        </div>
        <div class="right" style="font-size: 10px;">(${stats.topProduct?.quantity || 0} unds)</div>
      ` : ''}

      <!-- AUDIT (New) -->
      ${!hiddenModules.includes('AUDIT') && report.stats ? `
        <div class="divider"></div>
        <div class="bold center">AUDITORÍA</div>
        <div class="row">
          <span>Devoluciones:</span>
          <span>${stats.returnsCount || 0} (${formatCurrency(stats.returnsTotal || 0)})</span>
        </div>
        <div class="row">
          <span>Descuentos:</span>
          <span>${formatCurrency(stats.discountsTotal || 0)}</span>
        </div>
        <div class="row">
          <span>Recaud. Anticipos:</span>
          <span class="bold">${formatCurrency(stats.advancementsTotal || 0)}</span>
        </div>
      ` : ''}

      <br/><br/>
      <div class="divider"></div>
      <div class="center">
        <br/>
        __________________________<br/>
        Firma del Cajero
      </div>
      ${isXReport ? '<div class="center bold" style="font-size: 10px; margin-top: 8px;">ARQUEO PARCIAL - NO LIMPIA VENTAS</div>' : ''}
      <br/>
      <div class="center" style="font-size: 10px;">
        Generado por CLIC POS<br/>
        ${new Date().toLocaleString()}
      </div>

    </body>
    </html>
  `;
};
