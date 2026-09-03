import type { Transaction, ZReport } from '../types';

type TaxLine = NonNullable<ZReport['closeTaxSummary']>[number];
const money = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const percent = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return undefined;
  const rate = Number(value);
  return rate <= 1 ? rate * 100 : rate;
};
const canonicalName = (name: string) => {
  if (/\b(propina|servicio legal)\b|(?:10\s*%?\s*(?:de\s*)?(?:ley|legal))/i.test(name)) return 'Propina legal';
  if (/^(itbis|iva|vat)(\s|$)/i.test(name.trim())) return 'ITBIS';
  return name.trim() || 'Impuesto';
};
export const consolidateCloseTaxLines = (lines: TaxLine[]): TaxLine[] => {
  const buckets = new Map<string, TaxLine>();
  for (const line of lines) {
    const name = canonicalName(line.name);
    // Strip a printed percentage from the label; rate remains the grouping key.
    const label = name.replace(/\s*\(?\d+(?:[.,]\d+)?\s*%\)?/g, '').trim();
    const key = `${label.toLowerCase()}:${line.rate ?? 'unknown'}`;
    const previous = buckets.get(key);
    buckets.set(key, { name: label, rate: line.rate, amount: money(previous?.amount) + money(line.amount) });
  }
  return [...buckets.values()].map(line => ({ ...line, amount: round(line.amount) }))
    .filter(line => line.amount !== 0)
    .sort((a, b) => Number(a.name === 'Propina legal') - Number(b.name === 'Propina legal') || (b.rate ?? -1) - (a.rate ?? -1));
};

/** Snapshot recorded money only. Never infer a rate from today's ERP config or
 * multiply the closing total by a tax percentage. Refunds are reported elsewhere. */
export const buildCloseTaxSummary = (transactions: Transaction[]): TaxLine[] => {
  const lines: TaxLine[] = [];
  for (const transaction of transactions) {
    if (['REFUND', 'VOID'].includes(transaction.documentType || '') || transaction.ncfType === 'B04') continue;
    const breakdown = Array.isArray(transaction.taxBreakdown) ? transaction.taxBreakdown : [];
    if (breakdown.length) {
      for (const tax of breakdown) {
        lines.push({ name: String(tax.name || 'Impuesto'), rate: percent(tax.rate), amount: money(tax.amount) });
      }
    } else if (money(transaction.taxAmount)) {
      lines.push({ name: 'Impuestos sin desglose', amount: money(transaction.taxAmount) });
    }
    if (money(transaction.serviceChargeAmount)) {
      const policy = transaction.serviceTaxPolicySnapshot || transaction.service_tax_policy_snapshot;
      const rate = policy?.legalTip?.percentage;
      lines.push({ name: 'Propina legal', rate: rate === undefined ? undefined : money(rate), amount: money(transaction.serviceChargeAmount) });
    }
  }
  return consolidateCloseTaxLines(lines);
};

export const getCloseReceiptSummary = (report: ZReport) => {
  const labels = { DINE_IN: 'En local', TAKEOUT: 'Para llevar', DELIVERY: 'Delivery' };
  const services = (Object.keys(labels) as Array<keyof typeof labels>).map(serviceType => ({
    label: labels[serviceType],
    amount: round((report.serviceTypeSummary || []).filter(line => line.serviceType === serviceType)
      .reduce((sum, line) => sum + money(line.total), 0)),
  }));
  let taxes: TaxLine[];
  if (Array.isArray(report.closeTaxSummary)) taxes = report.closeTaxSummary;
  else {
    // Legacy reprints: use the persisted detail if available; never rebuild it
    // using live tax definitions. No historical percentage is invented.
    const detail = report.reportDetails?.taxSummary;
    taxes = detail?.length ? detail.map(line => ({ name: line.taxName, rate: percent(line.rate), amount: line.taxAmount }))
      : [{ name: 'Impuestos sin desglose', amount: (report.serviceTypeSummary || []).reduce((sum, line) => sum + money(line.taxAmount), 0) }];
    taxes.push({ name: 'Propina legal', amount: (report.serviceTypeSummary || []).reduce((sum, line) => sum + money(line.serviceChargeAmount), 0) });
  }
  return { services, total: round(services.reduce((sum, line) => sum + line.amount, 0)), taxes: consolidateCloseTaxLines(taxes) };
};

export const closeTaxLabel = (line: TaxLine) => line.rate === undefined ? line.name : `${line.name} ${line.rate}%`;
