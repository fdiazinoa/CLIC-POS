import {
  BusinessConfig,
  CartItem,
  TaxDefinition,
  Transaction,
  TransactionTaxLine,
} from '../types';

const EPSILON = 0.00001;
const FALLBACK_TAX_ID = '__default_tax__';

const toNumber = (value: unknown): number => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const round2 = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const normalizeTaxRate = (rawRate: unknown): number => {
  const rate = toNumber(rawRate);
  if (rate <= 0) return 0;
  return rate <= 1 ? rate : rate / 100;
};

export const formatTaxRateLabel = (rawRate: unknown): string => {
  const rate = normalizeTaxRate(rawRate) * 100;
  if (Math.abs(rate) <= EPSILON) return '0%';
  return Number.isInteger(rate) ? `${rate}%` : `${rate.toFixed(2)}%`;
};

export const formatTaxLineLabel = (
  tax: Pick<TransactionTaxLine, 'name' | 'rate'>,
): string => {
  const name = String(tax.name || '').trim();
  if (!name) return `Impuesto ${formatTaxRateLabel(tax.rate)}`;
  if (name.includes('%') || normalizeTaxRate(tax.rate) <= EPSILON) return name;
  return `${name} (${formatTaxRateLabel(tax.rate)})`;
};

const createFallbackTax = (config: Pick<BusinessConfig, 'taxes' | 'taxRate'>): TaxDefinition | null => {
  const defaultRate = normalizeTaxRate(config.taxRate);
  if (defaultRate <= 0) return null;

  const matchedTax = (config.taxes || []).find(
    (tax) => Math.abs(normalizeTaxRate(tax.rate) - defaultRate) <= EPSILON,
  );

  if (matchedTax) {
    return {
      ...matchedTax,
      rate: normalizeTaxRate(matchedTax.rate),
    };
  }

  return {
    id: FALLBACK_TAX_ID,
    name: `Impuesto General ${formatTaxRateLabel(defaultRate)}`,
    rate: defaultRate,
    type: 'VAT',
  };
};

export const getItemTaxDefinitions = (
  item: Pick<CartItem, 'appliedTaxIds'>,
  config: Pick<BusinessConfig, 'taxes' | 'taxRate'>,
): TaxDefinition[] => {
  const taxesById = new Map(
    (config.taxes || []).map((tax) => [
      tax.id,
      {
        ...tax,
        rate: normalizeTaxRate(tax.rate),
      },
    ]),
  );

  const selectedTaxes = (Array.isArray(item.appliedTaxIds) ? item.appliedTaxIds : [])
    .map((taxId) => taxesById.get(taxId))
    .filter(Boolean) as TaxDefinition[];

  if (selectedTaxes.length > 0) return selectedTaxes;

  const fallbackTax = createFallbackTax(config);
  return fallbackTax ? [fallbackTax] : [];
};

interface CalculateItemTaxBreakdownOptions {
  config: Pick<BusinessConfig, 'taxes' | 'taxRate'>;
  isTaxIncluded?: boolean;
  lineBaseAfterDiscount?: number;
}

export const calculateItemTaxBreakdown = (
  item: Pick<CartItem, 'appliedTaxIds' | 'price' | 'quantity'>,
  options: CalculateItemTaxBreakdownOptions,
): TransactionTaxLine[] => {
  const taxes = getItemTaxDefinitions(item, options.config);
  if (taxes.length === 0) return [];

  const lineGross = toNumber(item.price) * toNumber(item.quantity);
  const lineBaseAfterDiscount = options.lineBaseAfterDiscount ?? lineGross;
  const totalTaxRate = taxes.reduce((sum, tax) => sum + normalizeTaxRate(tax.rate), 0);
  const lineNet = options.isTaxIncluded && totalTaxRate > 0
    ? lineBaseAfterDiscount / (1 + totalTaxRate)
    : lineBaseAfterDiscount;

  return taxes.map((tax) => {
    const rate = normalizeTaxRate(tax.rate);
    return {
      taxId: tax.id || FALLBACK_TAX_ID,
      name: tax.name || `Impuesto ${formatTaxRateLabel(rate)}`,
      type: tax.type || 'OTHER',
      rate,
      taxableBase: round2(lineNet),
      amount: round2(lineNet * rate),
    };
  });
};

const aggregateTaxLines = (lines: TransactionTaxLine[]): TransactionTaxLine[] => {
  const buckets = new Map<string, TransactionTaxLine>();

  lines.forEach((line) => {
    const rate = normalizeTaxRate(line.rate);
    const key = `${line.taxId || FALLBACK_TAX_ID}:${rate}:${line.type || 'OTHER'}`;
    const current = buckets.get(key);

    if (!current) {
      buckets.set(key, {
        taxId: line.taxId || FALLBACK_TAX_ID,
        name: line.name || `Impuesto ${formatTaxRateLabel(rate)}`,
        type: line.type || 'OTHER',
        rate,
        taxableBase: round2(toNumber(line.taxableBase)),
        amount: round2(toNumber(line.amount)),
      });
      return;
    }

    current.taxableBase = round2(current.taxableBase + toNumber(line.taxableBase));
    current.amount = round2(current.amount + toNumber(line.amount));
  });

  return Array.from(buckets.values())
    .filter((line) => Math.abs(line.amount) > EPSILON || Math.abs(line.taxableBase) > EPSILON)
    .sort((a, b) => {
      if (b.rate !== a.rate) return b.rate - a.rate;
      return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
    });
};

interface CalculateTaxBreakdownOptions {
  items: Pick<CartItem, 'appliedTaxIds' | 'price' | 'quantity'>[];
  config: Pick<BusinessConfig, 'taxes' | 'taxRate'>;
  discountAmount?: number;
  isTaxIncluded?: boolean;
}

export const calculateTaxBreakdown = ({
  items,
  config,
  discountAmount = 0,
  isTaxIncluded = false,
}: CalculateTaxBreakdownOptions): TransactionTaxLine[] => {
  const grossLineTotal = (items || []).reduce(
    (sum, item) => sum + (toNumber(item.price) * toNumber(item.quantity)),
    0,
  );

  const lines = (items || []).flatMap((item) => {
    const lineGross = toNumber(item.price) * toNumber(item.quantity);
    if (Math.abs(lineGross) <= EPSILON) return [];

    const ratio = Math.abs(grossLineTotal) > EPSILON ? lineGross / grossLineTotal : 0;
    const lineDiscount = toNumber(discountAmount) * ratio;
    const lineBaseAfterDiscount = lineGross - lineDiscount;

    return calculateItemTaxBreakdown(item, {
      config,
      isTaxIncluded,
      lineBaseAfterDiscount,
    });
  });

  return aggregateTaxLines(lines);
};

const createFallbackBreakdownFromStoredTax = (
  transaction: Pick<Transaction, 'taxAmount' | 'netAmount' | 'total'>,
  config: Pick<BusinessConfig, 'taxes' | 'taxRate'>,
): TransactionTaxLine[] => {
  const taxAmount = toNumber(transaction.taxAmount);
  if (Math.abs(taxAmount) <= EPSILON) return [];

  const fallbackTax = createFallbackTax(config) || {
    id: FALLBACK_TAX_ID,
    name: 'Impuesto General',
    rate: 0,
    type: 'VAT' as const,
  };

  const taxableBase = transaction.netAmount != null
    ? toNumber(transaction.netAmount)
    : toNumber(transaction.total) - taxAmount;

  return [{
    taxId: fallbackTax.id,
    name: fallbackTax.name,
    type: fallbackTax.type,
    rate: normalizeTaxRate(fallbackTax.rate),
    taxableBase: round2(taxableBase),
    amount: round2(taxAmount),
  }];
};

export const getTransactionTaxBreakdown = (
  transaction: Pick<Transaction, 'items' | 'discountAmount' | 'isTaxIncluded' | 'taxBreakdown' | 'taxAmount' | 'netAmount' | 'total'>,
  config: Pick<BusinessConfig, 'taxes' | 'taxRate'>,
): TransactionTaxLine[] => {
  if (Array.isArray(transaction.taxBreakdown) && transaction.taxBreakdown.length > 0) {
    return aggregateTaxLines(
      transaction.taxBreakdown.map((line) => ({
        taxId: String(line.taxId || FALLBACK_TAX_ID),
        name: String(line.name || ''),
        type: line.type || 'OTHER',
        rate: normalizeTaxRate(line.rate),
        taxableBase: round2(toNumber(line.taxableBase)),
        amount: round2(toNumber(line.amount)),
      })),
    );
  }

  const computed = calculateTaxBreakdown({
    items: Array.isArray(transaction.items) ? transaction.items : [],
    config,
    discountAmount: toNumber(transaction.discountAmount),
    isTaxIncluded: !!transaction.isTaxIncluded,
  });

  if (computed.length > 0) return computed;

  return createFallbackBreakdownFromStoredTax(transaction, config);
};

export const sumTaxBreakdown = (lines: TransactionTaxLine[]): number =>
  round2((lines || []).reduce((sum, line) => sum + toNumber(line.amount), 0));

export const calculateTransactionSummary = (
  transaction: Pick<Transaction, 'items' | 'discountAmount' | 'isTaxIncluded' | 'taxBreakdown' | 'taxAmount' | 'netAmount' | 'total'>,
  config: Pick<BusinessConfig, 'taxes' | 'taxRate'>,
): {
  subtotal: number;
  taxTotal: number;
  total: number;
  discountTotal: number;
  taxBreakdown: TransactionTaxLine[];
} => {
  const items = Array.isArray(transaction.items) ? transaction.items : [];
  const grossLineTotal = round2(items.reduce(
    (sum, item) => sum + (toNumber(item.price) * toNumber(item.quantity)),
    0,
  ));
  const lineDiscountTotal = round2(items.reduce((sum, item) => {
    const originalPrice = toNumber((item as CartItem).originalPrice);
    const currentPrice = toNumber(item.price);
    if (originalPrice <= currentPrice) return sum;
    return sum + ((originalPrice - currentPrice) * toNumber(item.quantity));
  }, 0));
  const globalDiscount = round2(toNumber(transaction.discountAmount));
  const taxBreakdown = getTransactionTaxBreakdown(transaction, config);
  const taxTotal = sumTaxBreakdown(taxBreakdown);
  const storedNetAmount = transaction.netAmount;
  const hasStoredNetAmount = storedNetAmount !== undefined && storedNetAmount !== null && Number.isFinite(Number(storedNetAmount));

  const computedSubtotal = transaction.isTaxIncluded
    ? round2(grossLineTotal - globalDiscount - taxTotal)
    : round2(grossLineTotal - globalDiscount);

  return {
    subtotal: hasStoredNetAmount ? round2(toNumber(storedNetAmount)) : computedSubtotal,
    taxTotal,
    total: round2(toNumber(transaction.total) || (computedSubtotal + taxTotal)),
    discountTotal: round2(lineDiscountTotal + globalDiscount),
    taxBreakdown,
  };
};
