/** Presentation only: values are supplied by the existing query-report calculations. */
export type QueryReportKind = 'SALES' | 'PAYMENTS' | 'PRODUCTS' | 'CASHIERS' | 'HOURS' | 'ADJUSTMENTS' | 'CASH';
export type ReportCell = { text: string; atomic?: boolean };
export type ReportColumn = { title: string; align?: 'left' | 'right'; atomic?: boolean; emphasize?: boolean };
export type ReportBlock =
  | { type: 'text'; text: string; centered?: boolean; bold?: boolean; atomic?: boolean }
  | { type: 'pair'; label: string; value: string; bold?: boolean }
  | { type: 'table'; columns: ReportColumn[]; rows: ReportCell[][] };
export interface PosReportDocument {
  title: string;
  business: string;
  start: string;
  end: string;
  terminal: string;
  issuedAt: Date;
  blocks: ReportBlock[];
}
export const reportNumber = (value: number, decimals = 2): string => {
  // Keep the original report's toFixed rounding; add grouping only.
  const fixed = value.toFixed(decimals);
  if (/e/i.test(fixed)) return new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
  const [integer, fraction] = fixed.split('.');
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction === undefined ? '' : `.${fraction}`);
};
export const reportMoney = (value: number, currency: string): string => `${currency} ${reportNumber(value)}`;
export const reportDate = (value: string | Date): string => {
  const date = value instanceof Date ? value : new Date(value);
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
};
export const reportTime = (value: string | Date): string => {
  const date = value instanceof Date ? value : new Date(value);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};
export const cell = (text: string, atomic = false): ReportCell => ({ text, atomic });
