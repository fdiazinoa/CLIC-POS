import { CartItem, TaxDefinition } from '../types';

const round2 = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

export interface TransactionTaxSummary {
  grossAmount: number;
  netAmount: number;
  taxAmount: number;
  total: number;
}

export const calculateTransactionTaxSummary = (
  items: CartItem[],
  taxes: TaxDefinition[],
  isTaxIncluded: boolean,
  defaultTaxRate = 0
): TransactionTaxSummary => {
  const safeItems = Array.isArray(items) ? items : [];
  const safeTaxes = Array.isArray(taxes) ? taxes : [];
  const normalizedDefaultTaxRate = Math.max(0, Number(defaultTaxRate) || 0);
  const hasExplicitItemTaxes = safeItems.some(item => (item.appliedTaxIds || []).length > 0);

  let grossAmount = 0;
  let netAmount = 0;
  let taxAmount = 0;

  safeItems.forEach(item => {
    const quantity = Math.abs(Number(item.quantity) || 0);
    const unitPrice = round2(Math.abs(Number(item.price) || 0));
    const lineGross = round2(unitPrice * quantity);
    const itemTaxRate = hasExplicitItemTaxes
      ? (item.appliedTaxIds || []).reduce((sum, taxId) => {
          const tax = safeTaxes.find(entry => entry.id === taxId);
          return sum + (tax?.rate || 0);
        }, 0)
      : normalizedDefaultTaxRate;

    let lineNet = lineGross;
    let lineTax = 0;

    if (itemTaxRate > 0) {
      if (isTaxIncluded) {
        lineNet = round2(lineGross / (1 + itemTaxRate));
        lineTax = round2(lineGross - lineNet);
      } else {
        lineTax = round2(lineGross * itemTaxRate);
      }
    }

    grossAmount = round2(grossAmount + lineGross);
    netAmount = round2(netAmount + lineNet);
    taxAmount = round2(taxAmount + lineTax);
  });

  const total = isTaxIncluded ? grossAmount : round2(netAmount + taxAmount);

  return {
    grossAmount,
    netAmount,
    taxAmount,
    total
  };
};
