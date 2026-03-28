import { BusinessConfig, TaxDefinition, TerminalConfig, Transaction } from '../types';

const EPSILON = 0.0001;

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const toNumber = (value: unknown): number => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeTaxIds = (taxIds?: unknown): string[] => {
  if (!Array.isArray(taxIds)) return [];
  return Array.from(new Set(
    taxIds
      .map((taxId) => (typeof taxId === 'string' ? taxId.trim() : ''))
      .filter(Boolean)
  ));
};

type TerminalTaxConfig = Pick<TerminalConfig, 'operational'> | null | undefined;

type TaxableLineItem = {
  price?: number;
  quantity?: number;
  appliedTaxIds?: string[];
};

export interface FiscalTaxBreakdownLine {
  id: string;
  name: string;
  rate: number;
  amount: number;
  taxableBase: number;
  total: number;
  lineCount: number;
}

interface TaxBreakdownOptions {
  discountAmount?: number;
  isTaxIncluded?: boolean;
  terminalConfig?: TerminalTaxConfig;
  fallbackTaxRate?: number;
  fallbackTaxName?: string;
  absoluteLineValues?: boolean;
  multiplier?: number;
}

type TaxableTransaction = Pick<Transaction, 'items' | 'discountAmount' | 'isTaxIncluded' | 'taxAmount' | 'total'> & {
  taxBreakdown?: FiscalTaxBreakdownLine[];
};

export const getTerminalDefaultTaxIds = (terminalConfig?: TerminalTaxConfig): string[] =>
  normalizeTaxIds(terminalConfig?.operational?.defaultTaxIds);

export const resolveEffectiveTaxIds = (
  itemTaxIds?: string[] | null,
  terminalConfig?: TerminalTaxConfig
): string[] => {
  const directTaxIds = normalizeTaxIds(itemTaxIds);
  return directTaxIds.length > 0 ? directTaxIds : getTerminalDefaultTaxIds(terminalConfig);
};

export const resolveEffectiveTaxes = (
  item: Pick<TaxableLineItem, 'appliedTaxIds'>,
  config: Pick<BusinessConfig, 'taxes'>,
  terminalConfig?: TerminalTaxConfig,
  fallbackTaxRate = 0,
  fallbackTaxName = 'Impuesto'
): TaxDefinition[] => {
  const resolvedTaxes = resolveEffectiveTaxIds(item.appliedTaxIds, terminalConfig)
    .map((taxId) => (config.taxes || []).find((tax) => tax.id === taxId))
    .filter(Boolean) as TaxDefinition[];

  if (resolvedTaxes.length > 0) {
    return resolvedTaxes;
  }

  if (fallbackTaxRate > EPSILON) {
    return [{
      id: 'default-tax',
      name: fallbackTaxName,
      rate: fallbackTaxRate,
      type: 'VAT',
    }];
  }

  return [];
};

export const calculateTaxBreakdownFromItems = (
  items: TaxableLineItem[],
  config: BusinessConfig,
  options: TaxBreakdownOptions = {}
): FiscalTaxBreakdownLine[] => {
  const {
    discountAmount = 0,
    isTaxIncluded = false,
    terminalConfig,
    fallbackTaxRate = 0,
    fallbackTaxName = 'Impuesto',
    absoluteLineValues = false,
    multiplier = 1,
  } = options;

  const normalizedItems = Array.isArray(items) ? items : [];
  const grossLineTotal = normalizedItems.reduce((sum, item) => {
    const rawLineTotal = toNumber(item?.price) * toNumber(item?.quantity);
    return sum + Math.abs(rawLineTotal);
  }, 0);

  const breakdown = new Map<string, FiscalTaxBreakdownLine>();

  normalizedItems.forEach((item) => {
    const rawLineTotal = toNumber(item?.price) * toNumber(item?.quantity);
    const lineGross = Math.abs(rawLineTotal);
    if (lineGross <= EPSILON) return;

    const lineSign = absoluteLineValues ? 1 : (rawLineTotal < 0 ? -1 : 1);
    const effectiveSign = lineSign * multiplier;
    const itemRatio = grossLineTotal > 0 ? lineGross / grossLineTotal : 0;
    const lineDiscount = Math.max(0, toNumber(discountAmount)) * itemRatio;
    const lineBaseAfterDiscount = Math.max(0, lineGross - lineDiscount);
    const itemTaxes = resolveEffectiveTaxes(item, config, terminalConfig, fallbackTaxRate, fallbackTaxName);
    const totalTaxRate = itemTaxes.reduce((sum, tax) => sum + Math.max(0, toNumber(tax.rate)), 0);

    if (itemTaxes.length === 0 || totalTaxRate <= EPSILON) return;

    const lineNet = isTaxIncluded
      ? lineBaseAfterDiscount / (1 + totalTaxRate)
      : lineBaseAfterDiscount;

    itemTaxes.forEach((tax) => {
      const current = breakdown.get(tax.id) || {
        id: tax.id,
        name: tax.name,
        rate: Math.max(0, toNumber(tax.rate)),
        amount: 0,
        taxableBase: 0,
        total: 0,
        lineCount: 0,
      };

      const taxAmount = lineNet * current.rate * effectiveSign;
      const taxableBase = lineNet * effectiveSign;

      current.amount += taxAmount;
      current.taxableBase = (current.taxableBase || 0) + taxableBase;
      current.total = (current.total || 0) + taxableBase + taxAmount;
      current.lineCount = (current.lineCount || 0) + 1;
      breakdown.set(tax.id, current);
    });
  });

  return Array.from(breakdown.values())
    .map((line) => ({
      ...line,
      amount: round2(line.amount),
      taxableBase: round2(line.taxableBase || 0),
      total: round2(line.total || 0),
      lineCount: Math.round(line.lineCount || 0),
    }))
    .filter((line) => Math.abs(line.amount) > EPSILON)
    .sort((a, b) => b.rate - a.rate);
};

export const calculateTransactionFiscalSummary = (
  transaction: TaxableTransaction,
  config: BusinessConfig,
  options: { terminalConfig?: TerminalTaxConfig } = {}
): {
  grossLineTotal: number;
  discountAmount: number;
  subtotal: number;
  taxTotal: number;
  total: number;
  taxBreakdown: FiscalTaxBreakdownLine[];
} => {
  const grossLineTotal = round2((transaction.items || []).reduce((sum, item: any) => {
    return sum + Math.abs(toNumber(item?.price) * toNumber(item?.quantity));
  }, 0));
  const discountAmount = round2(Math.max(0, toNumber(transaction.discountAmount)));
  const fallbackTaxRate = Math.abs(toNumber(transaction.taxAmount)) > EPSILON
    ? Math.max(0, toNumber(config.taxRate))
    : 0;

  const computedBreakdown = calculateTaxBreakdownFromItems(transaction.items || [], config, {
    discountAmount,
    isTaxIncluded: !!transaction.isTaxIncluded,
    terminalConfig: options.terminalConfig,
    fallbackTaxRate,
  });

  const taxBreakdown = Array.isArray(transaction.taxBreakdown) && transaction.taxBreakdown.length > 0
    ? transaction.taxBreakdown
    : computedBreakdown;

  const taxTotal = round2(taxBreakdown.reduce((sum, line) => sum + toNumber(line.amount), 0));
  const subtotal = transaction.isTaxIncluded
    ? round2(Math.max(0, grossLineTotal - discountAmount - taxTotal))
    : round2(Math.max(0, grossLineTotal - discountAmount));
  const storedTotal = toNumber(transaction.total);
  const total = Math.abs(storedTotal) > EPSILON
    ? round2(storedTotal)
    : round2(transaction.isTaxIncluded ? Math.max(0, grossLineTotal - discountAmount) : subtotal + taxTotal);

  return {
    grossLineTotal,
    discountAmount,
    subtotal,
    taxTotal,
    total,
    taxBreakdown,
  };
};

export const formatTaxLineLabel = (tax: Pick<FiscalTaxBreakdownLine, 'name' | 'rate'>): string => {
  const ratePercent = tax.rate <= 1 ? tax.rate * 100 : tax.rate;
  const formattedRate = Number.isInteger(ratePercent) ? `${ratePercent}%` : `${ratePercent.toFixed(2)}%`;
  return tax.name.includes('%') ? tax.name : `${tax.name} ${formattedRate}`;
};
