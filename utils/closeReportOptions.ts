import type {
  BusinessConfig,
  CloseReportDetails,
  CloseReportSection,
  TerminalConfig,
  Transaction,
} from '../types';
import { calculateTransactionFiscalSummary } from './fiscalBreakdown';

export const CLOSE_REPORT_SECTION_OPTIONS: Array<{
  id: CloseReportSection;
  label: string;
  description: string;
}> = [
  { id: 'SELLER_SUMMARY', label: 'Resumen x Vendedor', description: 'Tickets y venta neta por vendedor.' },
  { id: 'ITEM_SUMMARY', label: 'Resumen x Artículo', description: 'Unidades y venta neta por artículo.' },
  { id: 'TAX_SUMMARY', label: 'Impuestos', description: 'Base imponible e impuestos por tasa.' },
  { id: 'CURRENCY_BREAKDOWN', label: 'Desglose de moneda', description: 'Cantidades declaradas por billete y moneda.' },
  { id: 'HOURLY_SALES', label: 'Ventas x Hora', description: 'Tickets y venta neta agrupados por hora.' },
];

export const ALL_CLOSE_REPORT_SECTIONS: CloseReportSection[] =
  CLOSE_REPORT_SECTION_OPTIONS.map((option) => option.id);

export type CloseReportType = 'X' | 'Z';

export const resolveCloseReportSections = (
  config: BusinessConfig,
  terminalId: string | undefined,
  userId: string | undefined,
  reportType: CloseReportType,
): CloseReportSection[] => {
  if (!userId) return [];
  const terminal = (config.terminals || []).find((candidate) =>
    candidate.id === terminalId
    || candidate.config?.erpTerminalId === terminalId
    || candidate.config?.erpBinding?.terminalId === terminalId
  ) || config.terminals?.[0];
  const configured = terminal?.config?.workflow?.session?.closeReportOptionsByUser?.[userId]?.[reportType];
  if (!Array.isArray(configured)) return [];
  const supported = new Set(CLOSE_REPORT_SECTION_OPTIONS.map((option) => option.id));
  return Array.from(new Set(configured.filter((section): section is CloseReportSection => supported.has(section))));
};

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const isRefund = (transaction: Transaction): boolean => (
  transaction.documentType === 'REFUND' || transaction.ncfType === 'B04'
);

const isReportable = (transaction: Transaction): boolean => transaction.documentType !== 'VOID';

export const buildCloseReportDetails = (
  transactions: Transaction[],
  config: BusinessConfig,
  terminalConfig: TerminalConfig | undefined,
  enabledSections: CloseReportSection[],
): CloseReportDetails => {
  const enabled = new Set(enabledSections);
  const reportableTransactions = (transactions || []).filter(isReportable);
  const details: CloseReportDetails = {};

  if (enabled.has('SELLER_SUMMARY')) {
    const bySeller = new Map<string, NonNullable<CloseReportDetails['sellerSummary']>[number]>();
    reportableTransactions.forEach((transaction) => {
      const userId = String(transaction.userId || 'unknown');
      const current = bySeller.get(userId) || {
        userId,
        userName: transaction.userName || 'Sin vendedor',
        transactionCount: 0,
        netSales: 0,
      };
      current.transactionCount += 1;
      current.netSales += isRefund(transaction) ? -Math.abs(Number(transaction.total || 0)) : Number(transaction.total || 0);
      bySeller.set(userId, current);
    });
    details.sellerSummary = Array.from(bySeller.values())
      .map((line) => ({ ...line, netSales: round2(line.netSales) }))
      .sort((a, b) => b.netSales - a.netSales || a.userName.localeCompare(b.userName));
  }

  if (enabled.has('ITEM_SUMMARY')) {
    const byItem = new Map<string, NonNullable<CloseReportDetails['itemSummary']>[number]>();
    reportableTransactions.forEach((transaction) => {
      const multiplier = isRefund(transaction) ? -1 : 1;
      (transaction.items || []).forEach((item) => {
        const productId = String(item.id || item.variantId || item.variantSku || item.name || 'unknown');
        const current = byItem.get(productId) || {
          productId,
          productName: item.name || 'Artículo sin nombre',
          quantity: 0,
          netSales: 0,
        };
        const quantity = Math.abs(Number(item.quantity || 0));
        const lineTotal = Number(item.totalAmount ?? (Number(item.price || 0) * quantity));
        current.quantity += multiplier * quantity;
        current.netSales += multiplier * Math.abs(lineTotal);
        byItem.set(productId, current);
      });
    });
    details.itemSummary = Array.from(byItem.values())
      .map((line) => ({ ...line, quantity: round2(line.quantity), netSales: round2(line.netSales) }))
      .sort((a, b) => b.netSales - a.netSales || a.productName.localeCompare(b.productName));
  }

  if (enabled.has('TAX_SUMMARY')) {
    const byTax = new Map<string, NonNullable<CloseReportDetails['taxSummary']>[number]>();
    reportableTransactions.forEach((transaction) => {
      const multiplier = isRefund(transaction) ? -1 : 1;
      const fiscal = calculateTransactionFiscalSummary(transaction, config, { terminalConfig });
      fiscal.taxBreakdown.forEach((tax) => {
        const rate = Number(tax.rate || 0);
        const taxId = String(tax.id || `${tax.name}-${rate}`);
        const current = byTax.get(taxId) || {
          taxId,
          taxName: tax.name || 'Impuesto',
          rate,
          taxableBase: 0,
          taxAmount: 0,
        };
        current.taxableBase += multiplier * Math.abs(Number(tax.taxableBase || 0));
        current.taxAmount += multiplier * Math.abs(Number(tax.amount || 0));
        byTax.set(taxId, current);
      });
    });
    details.taxSummary = Array.from(byTax.values())
      .map((line) => ({ ...line, taxableBase: round2(line.taxableBase), taxAmount: round2(line.taxAmount) }))
      .sort((a, b) => b.rate - a.rate || a.taxName.localeCompare(b.taxName));
  }

  if (enabled.has('HOURLY_SALES')) {
    const byHour = new Map<number, NonNullable<CloseReportDetails['hourlySales']>[number]>();
    reportableTransactions.forEach((transaction) => {
      const parsedDate = new Date(transaction.date);
      if (Number.isNaN(parsedDate.getTime())) return;
      const hour = parsedDate.getHours();
      const current = byHour.get(hour) || {
        hour,
        label: `${String(hour).padStart(2, '0')}:00 - ${String((hour + 1) % 24).padStart(2, '0')}:00`,
        transactionCount: 0,
        netSales: 0,
      };
      current.transactionCount += 1;
      current.netSales += isRefund(transaction) ? -Math.abs(Number(transaction.total || 0)) : Number(transaction.total || 0);
      byHour.set(hour, current);
    });
    details.hourlySales = Array.from(byHour.values())
      .map((line) => ({ ...line, netSales: round2(line.netSales) }))
      .sort((a, b) => a.hour - b.hour);
  }

  return details;
};
