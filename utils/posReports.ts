import { cell, reportMoney, reportNumber, reportDate, reportTime, type PosReportDocument, type ReportBlock, type ReportCell } from '../services/printer/PosReportDocument';
import type { BusinessConfig, CashMovement, Transaction, ZReport } from '../types';
import { resolveLineDiscountPresentation } from './lineDiscountPresentation';
import { calculateZReportStats } from './analytics';
import { buildZReportPaymentMethodSummary } from './zReportPaymentSummary';
import { resolveTerminalDisplayName } from './transactionHistoryPresentation';

export type PosReportKind = 'SALES' | 'PAYMENTS' | 'PRODUCTS' | 'CASHIERS' | 'HOURS' | 'ADJUSTMENTS' | 'CASH' | 'Z_HISTORY';
export const POS_REPORT_NAMES: Record<PosReportKind, string> = {
  SALES: 'Resumen de ventas', PAYMENTS: 'Formas de pago', PRODUCTS: 'Productos vendidos',
  CASHIERS: 'Ventas por cajero', HOURS: 'Ventas por hora', ADJUSTMENTS: 'Descuentos y devoluciones',
  CASH: 'Movimientos de efectivo', Z_HISTORY: 'Historial de cierres Z',
};
export interface PosReportFilters { start: string; end: string; terminalId: string; productLimit: number }
export interface PosReportSource { transactions: Transaction[]; movements: CashMovement[]; reports: ZReport[] }
export const localDate = (date = new Date()): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const validReportDates = (filters: PosReportFilters): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(filters.start) && /^\d{4}-\d{2}-\d{2}$/.test(filters.end) && filters.start <= filters.end;
const number = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
const money = (value: number, currency: string): string => `${currency} ${value.toFixed(2)}`;
const refund = (tx: Transaction): boolean => tx.documentType === 'REFUND' || tx.ncfType === 'B04';
export const baseReportCurrency = (config: BusinessConfig): string => config.currencies?.find(c => c.isBase)?.code || 'DOP';

export const filterPosReportSource = (source: PosReportSource, filters: PosReportFilters, config: BusinessConfig): PosReportSource => {
  if (!validReportDates(filters)) return { transactions: [], movements: [], reports: [] };
  const start = new Date(`${filters.start}T00:00:00`).getTime();
  const endDate = new Date(`${filters.end}T00:00:00`);
  endDate.setDate(endDate.getDate() + 1);
  const matches = (date: string, terminalId?: string): boolean => {
    const time = new Date(date).getTime();
    const selected = config.terminals?.find(t => t.id === filters.terminalId);
    const aliases = [selected?.id, selected?.config?.erpTerminalId, selected?.config?.erpBinding?.terminalId].filter(Boolean);
    return time >= start && time < endDate.getTime() && (!filters.terminalId || aliases.includes(terminalId) || filters.terminalId === terminalId);
  };
  // Current rows take precedence over archived copies, including changed refund status.
  const transactions = [...new Map(source.transactions.map(tx => [tx.id, tx])).values()];
  return {
    transactions: transactions.filter(tx => matches(tx.date, tx.terminalId) && tx.status !== 'PENDING'
      && (!tx.documentType || ['TICKET', 'REFUND'].includes(tx.documentType))),
    movements: [...new Map(source.movements.map(m => [m.id, m])).values()].filter(m => matches(m.timestamp, m.terminalId)),
    reports: [...new Map(source.reports.map(r => [r.id, r])).values()].filter(r => matches(r.closedAt, r.terminalId))
      .sort((a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime()),
  };
};

const buildPosReport = (
  kind: PosReportKind, source: PosReportSource, filters: PosReportFilters, config: BusinessConfig, issuedAt = new Date(),
): { text: string; document: PosReportDocument } => {
  const base = baseReportCurrency(config);
  const lines = [config.companyInfo?.name || 'CLIC POS', POS_REPORT_NAMES[kind],
    `Periodo: ${filters.start} / ${filters.end}`,
    `Caja: ${filters.terminalId ? resolveTerminalDisplayName(filters.terminalId, config.terminals) : 'Todas'}`,
    `Emitido: ${issuedAt.toLocaleString()}`, '--------------------------------', 'Consulta local - no cierra caja'];
  const document: PosReportDocument = {
    business: config.companyInfo?.name || 'CLIC POS', title: POS_REPORT_NAMES[kind],
    start: filters.start, end: filters.end, terminal: filters.terminalId ? resolveTerminalDisplayName(filters.terminalId, config.terminals) : 'Todas',
    issuedAt, blocks: [],
  };
  const blocks = document.blocks;
  const pair = (label: string, value: string, bold = false) => blocks.push({ type: 'pair', label, value, bold });
  const note = (text: string) => blocks.push({ type: 'text', text });
  const section = (text: string) => blocks.push({ type: 'text', text, bold: true });
  const grouped = new Map<string, Transaction[]>();
  for (const tx of source.transactions) {
    const currency = tx.currency || base;
    const rows = grouped.get(currency) || [];
    rows.push(tx);
    grouped.set(currency, rows);
  }
  if (kind === 'SALES') {
    for (const [currency, transactions] of grouped) {
      const stats = calculateZReportStats(transactions);
      lines.push('', currency, `Tickets de venta: ${transactions.filter(tx => !refund(tx)).length}`,
        `Ventas tras descuentos: ${money(stats.grossSales, currency)}`,
        `Descuentos globales: ${money(stats.discountsTotal, currency)}`,
        `Devoluciones (${stats.returnsCount}): ${money(stats.returnsTotal, currency)}`,
        `Venta neta: ${money(stats.netSales, currency)}`);
      const tax = transactions.reduce((sum, tx) => sum + (refund(tx) ? -Math.abs(number(tx.taxAmount)) : number(tx.taxAmount)), 0);
      lines.push(`Impuestos registrados: ${money(tax, currency)}`);
      if (transactions.some(tx => tx.taxAmount == null)) lines.push('Impuestos: hay documentos sin desglose');
      section(currency);
      blocks.push({ type: 'table', columns: [{ title: 'Concepto' }, { title: 'Total', align: 'right', atomic: true }], rows: [
        [cell('Tickets de venta'), cell(reportNumber(transactions.filter(tx => !refund(tx)).length, 0), true)],
        [cell('Ventas tras descuentos'), cell(reportMoney(stats.grossSales, currency), true)],
        [cell('Descuentos globales'), cell(reportMoney(stats.discountsTotal, currency), true)],
        [cell(`Devoluciones (${stats.returnsCount})`), cell(reportMoney(stats.returnsTotal, currency), true)],
        [cell('Impuestos registrados'), cell(reportMoney(tax, currency), true)],
      ] });
      pair('VENTA NETA', reportMoney(stats.netSales, currency), true);
      if (transactions.some(tx => tx.taxAmount == null)) note('Hay documentos sin desglose de impuestos.');
    }
    lines.push('Importes de ventas incluyen impuestos.', 'Descuentos informativos; ya aplicados.');
    note('Ventas con impuestos. Descuentos informativos ya aplicados.');
  } else if (kind === 'PAYMENTS') {
    const buckets = new Map<string, { name: string; currency: string; appliedCurrency: string; amount: number }>();
    for (const tx of source.transactions) for (const payment of tx.payments || []) {
      const summary = buildZReportPaymentMethodSummary([{ ...tx, payments: [payment] }], config)[0];
      if (!summary) continue;
      const currency = payment.currencyCode || payment.currency_code || base;
      const appliedCurrency = tx.currency || base;
      const key = JSON.stringify([summary.methodId || summary.name, currency, appliedCurrency]);
      const row = buckets.get(key) || { name: summary.name, currency, appliedCurrency, amount: 0 };
      row.amount += summary.amount;
      buckets.set(key, row);
    }
    const paymentRows: ReportCell[][] = [];
    for (const row of buckets.values()) {
      paymentRows.push([cell(`${row.name} / ${row.currency}`), cell(reportMoney(row.amount, row.appliedCurrency), true)]);
      lines.push(`${row.name} / ${row.currency}`, `  Aplicado: ${money(row.amount, row.appliedCurrency)}`);
    }
    lines.push('Agrupado por moneda del pago.', 'Importes aplicados en moneda base;', 'excluyen cambio e incluyen credito.');
    if (!buckets.size) lines.push('Sin pagos en el periodo.');
    section('IMPORTES APLICADOS POR FORMA Y MONEDA');
    blocks.push({ type: 'table', columns: [{ title: 'Forma / moneda' }, { title: 'Aplicado', align: 'right', atomic: true, emphasize: true }], rows: paymentRows });
    note('Moneda original del pago; aplicado en moneda base. Sin cambio, incluye crédito.');
    if (!buckets.size) note('Sin pagos en el período.');
  } else if (kind === 'PRODUCTS') {
    for (const [currency, transactions] of grouped) {
      const products = new Map<string, { name: string; quantity: number; amount: number }>();
      for (const tx of transactions) for (const item of tx.items || []) {
        const quantity = refund(tx) ? -Math.abs(number(item.quantity)) : number(item.quantity);
        const key = `${item.id}:${item.articleFormat?.id || ''}`;
        const row = products.get(key) || { name: `${item.name}${item.articleFormat ? ` (${item.articleFormat.abbreviation || item.articleFormat.name})` : ''}`, quantity: 0, amount: 0 };
        row.quantity += quantity;
        row.amount += number(item.price) * quantity;
        products.set(key, row);
      }
      const ranked = [...products.values()].sort((a, b) => b.quantity - a.quantity);
      lines.push('', `${currency} - Top ${filters.productLimit || 'todos'}`);
      for (const row of ranked.slice(0, filters.productLimit || ranked.length)) lines.push(row.name, `  Cant: ${Number(row.quantity.toFixed(3))}  ${money(row.amount, currency)}`);
      lines.push(`Mostrados: ${Math.min(filters.productLimit || ranked.length, ranked.length)} de ${ranked.length}`);
      section(`${currency} · Top ${filters.productLimit || 'todos'}`);
      blocks.push({ type: 'table', columns: [{ title: 'Producto' }, { title: 'Cant.', align: 'right', atomic: true }, { title: 'Importe', align: 'right', atomic: true, emphasize: true }],
        rows: ranked.slice(0, filters.productLimit || ranked.length).map(row => [cell(row.name), cell(new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(Number(row.quantity.toFixed(3))), true), cell(reportMoney(row.amount, currency), true)]) });
      note(`Mostrados: ${Math.min(filters.productLimit || ranked.length, ranked.length)} de ${ranked.length}.`);
    }
    lines.push('Cantidades netas de devoluciones.', 'Importe a precio registrado de linea;', 'sin prorratear descuento global.');
    note('Cantidades netas de devoluciones. Importe a precio de línea, sin prorratear descuento global.');
  } else if (kind === 'CASHIERS' || kind === 'HOURS') {
    for (const [currency, transactions] of grouped) {
      const buckets = new Map<string, { label: string; tickets: number; sales: number; returns: number; returnCount: number }>();
      for (const tx of transactions) {
        const hour = new Date(tx.date).getHours();
        const key = kind === 'CASHIERS' ? (tx.userId || tx.userName || 'unknown') : String(hour).padStart(2, '0');
        const label = kind === 'CASHIERS' ? (tx.userName || 'Sin cajero registrado') : `${key}:00 - ${key}:59`;
        const row = buckets.get(key) || { label, tickets: 0, sales: 0, returns: 0, returnCount: 0 };
        if (refund(tx)) { row.returns += Math.abs(number(tx.total)); row.returnCount += 1; }
        else { row.sales += number(tx.total); row.tickets += 1; }
        buckets.set(key, row);
      }
      lines.push('', currency);
      const sorted = [...buckets.entries()].sort(([a, rowA], [b, rowB]) => kind === 'HOURS' ? a.localeCompare(b) : rowA.label.localeCompare(rowB.label));
      section(currency);
      blocks.push({ type: 'table', columns: [{ title: kind === 'HOURS' ? 'Hora' : 'Cajero' }, { title: 'Tck', align: 'right', atomic: true }, { title: 'Neto', align: 'right', atomic: true, emphasize: true }],
        rows: sorted.map(([, row]) => [cell(row.label, kind === 'HOURS'), cell(reportNumber(row.tickets, 0), true), cell(reportMoney(row.sales - row.returns, currency), true)]) });
      for (const [, row] of sorted) {
        section(row.label);
        blocks.push({ type: 'table', columns: [{ title: 'Concepto' }, { title: 'Total', align: 'right', atomic: true }], rows: [
          [cell('Ventas'), cell(reportMoney(row.sales, currency), true)],
          [cell(`Devoluciones (${row.returnCount})`), cell(reportMoney(row.returns, currency), true)],
        ] });
        if (kind === 'CASHIERS') pair('Ticket promedio', reportMoney(row.tickets ? row.sales / row.tickets : 0, currency));
        lines.push('', row.label, `Tickets de venta: ${row.tickets}`, `Ventas: ${money(row.sales, currency)}`,
          `Devoluciones (${row.returnCount}): ${money(row.returns, currency)}`, `Venta neta: ${money(row.sales - row.returns, currency)}`);
        if (kind === 'CASHIERS') lines.push(`Ticket promedio: ${money(row.tickets ? row.sales / row.tickets : 0, currency)}`);
      }
      const stats = calculateZReportStats(transactions);
      lines.push('', `TOTAL NETO: ${money(stats.netSales, currency)}`);
      pair('TOTAL NETO', reportMoney(stats.netSales, currency), true);
    }
    lines.push(kind === 'HOURS' ? 'Horas locales acumuladas del periodo.' : 'Cajero que registro cada documento.',
      'La nota de credito descuenta la', 'devolucion; no el estado de la venta.');
    note(kind === 'HOURS' ? 'Horas locales acumuladas del período.' : 'Cajero que registró cada documento.');
    note('La nota de crédito descuenta la devolución; no el estado de la venta.');
  } else if (kind === 'ADJUSTMENTS') {
    for (const [currency, transactions] of grouped) {
      let globalDiscounts = 0;
      let lineDiscounts = 0;
      let returns = 0;
      let discountCount = 0;
      let returnCount = 0;
      const details: string[] = [];
      const detailBlocks: ReportBlock[] = [];
      for (const tx of transactions) {
        const reference = tx.displayId || tx.id;
        const cashier = tx.userName || 'Sin cajero registrado';
        if (refund(tx)) {
          returns += Math.abs(number(tx.total)); returnCount += 1;
          detailBlocks.push({ type: 'text', text: 'DEVOLUCIÓN', bold: true }, { type: 'pair', label: 'Documento', value: reference },
            { type: 'pair', label: 'Fecha', value: `${reportDate(tx.date)} ${reportTime(tx.date)}` }, { type: 'text', text: cashier },
            { type: 'pair', label: 'Importe', value: reportMoney(Math.abs(number(tx.total)), currency), bold: true },
            { type: 'pair', label: 'Origen', value: tx.affectedInvoiceNumber || tx.originalTransactionId || tx.original_transaction_id || 'No registrado' },
            { type: 'text', text: `Motivo: ${tx.refundReason || 'No registrado'}` });
          details.push('', `DEVOLUCION ${reference}`, new Date(tx.date).toLocaleString(), cashier,
            `Importe: ${money(Math.abs(number(tx.total)), currency)}`,
            `Origen: ${tx.affectedInvoiceNumber || tx.originalTransactionId || tx.original_transaction_id || 'No registrado'}`,
            `Motivo: ${tx.refundReason || 'No registrado'}`);
        } else {
          const global = Math.max(0, number(tx.discountAmount));
          const line = (tx.items || []).reduce((sum, item) => sum + resolveLineDiscountPresentation(item).discountAmount, 0);
          if (!global && !line) continue;
          globalDiscounts += global; lineDiscounts += line; discountCount += 1;
          detailBlocks.push({ type: 'text', text: 'DESCUENTO', bold: true }, { type: 'pair', label: 'Documento', value: reference },
            { type: 'pair', label: 'Fecha', value: `${reportDate(tx.date)} ${reportTime(tx.date)}` }, { type: 'text', text: cashier },
            { type: 'pair', label: 'Global', value: reportMoney(global, currency) }, { type: 'pair', label: 'En líneas', value: reportMoney(line, currency) });
          if (tx.authorizedByName) detailBlocks.push({ type: 'text', text: `Autorizó: ${tx.authorizedByName}` });
          details.push('', `DESCUENTO ${reference}`, new Date(tx.date).toLocaleString(), cashier,
            `Global: ${money(global, currency)}`, `En lineas: ${money(line, currency)}`);
          if (tx.authorizedByName) details.push(`Autorizo: ${tx.authorizedByName}`);
        }
      }
      lines.push('', currency, `Tickets con descuento: ${discountCount}`, `Descuentos globales: ${money(globalDiscounts, currency)}`,
        `Descuentos en lineas: ${money(lineDiscounts, currency)}`, `Total descuentos: ${money(globalDiscounts + lineDiscounts, currency)}`,
        `Devoluciones (${returnCount}): ${money(returns, currency)}`, ...details);
      if (!discountCount && !returnCount) lines.push('Sin descuentos ni devoluciones.');
      section(currency);
      blocks.push({ type: 'table', columns: [{ title: 'Concepto' }, { title: 'Total', align: 'right', atomic: true }], rows: [
        [cell('Tickets con descuento'), cell(reportNumber(discountCount, 0), true)],
        [cell('Descuentos globales'), cell(reportMoney(globalDiscounts, currency), true)],
        [cell('Descuentos en líneas'), cell(reportMoney(lineDiscounts, currency), true)],
        [cell(`Devoluciones (${returnCount})`), cell(reportMoney(returns, currency), true)],
      ] });
      pair('TOTAL DESCUENTOS', reportMoney(globalDiscounts + lineDiscounts, currency), true);
      blocks.push(...detailBlocks);
      if (!discountCount && !returnCount) note('Sin descuentos ni devoluciones.');
    }
    lines.push('Descuentos otorgados en ventas;', 'ya aplicados, no se restan otra vez.');
    note('Descuentos otorgados en ventas, ya aplicados: no se restan otra vez.');
  } else if (kind === 'CASH') {
    const totals = new Map<string, { incoming: number; outgoing: number }>();
    for (const movement of [...source.movements].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())) {
      const currency = movement.currencyCode || base;
      const row = totals.get(currency) || { incoming: 0, outgoing: 0 };
      row[movement.type === 'IN' ? 'incoming' : 'outgoing'] += number(movement.amount);
      totals.set(currency, row);
      section(movement.type === 'IN' ? 'ENTRADA DE EFECTIVO' : 'SALIDA DE EFECTIVO');
      pair('Fecha', `${reportDate(movement.timestamp)} ${reportTime(movement.timestamp)}`);
      note(`${movement.userName} / ${resolveTerminalDisplayName(movement.terminalId, config.terminals)}`);
      blocks.push({ type: 'table', columns: [{ title: 'Motivo' }, { title: 'Importe', align: 'right', atomic: true }], rows: [[cell(movement.reason), cell(reportMoney(number(movement.amount), currency), true)]] });
      lines.push('', `${new Date(movement.timestamp).toLocaleString()} ${movement.type === 'IN' ? 'Entrada' : 'Salida'}`,
        `${movement.userName} / ${resolveTerminalDisplayName(movement.terminalId, config.terminals)}`,
        movement.reason, money(number(movement.amount), currency));
    }
    for (const [currency, row] of totals) lines.push('', `Entradas: ${money(row.incoming, currency)}`, `Salidas: ${money(row.outgoing, currency)}`, `Balance movimientos: ${money(row.incoming - row.outgoing, currency)}`);
    for (const [currency, row] of totals) {
      section(currency);
      pair('Entradas', reportMoney(row.incoming, currency));
      pair('Salidas', reportMoney(row.outgoing, currency));
      pair('BALANCE MOVIMIENTOS', reportMoney(row.incoming - row.outgoing, currency), true);
    }
    lines.push('Balance solo de entradas/salidas;', 'no representa efectivo en caja.');
    note('Balance de entradas/salidas; no representa efectivo en caja.');
  }
  if ((kind === 'CASH' ? source.movements.length : source.transactions.length) === 0) lines.push('Sin registros en el periodo.');
  if ((kind === 'CASH' ? source.movements.length : source.transactions.length) === 0) note('Sin registros en el período.');
  return { text: lines.join('\n'), document };
};

export const buildPosReportText = (...args: Parameters<typeof buildPosReport>): string => buildPosReport(...args).text;
export const buildPosReportDocument = (...args: Parameters<typeof buildPosReport>): PosReportDocument => buildPosReport(...args).document;
