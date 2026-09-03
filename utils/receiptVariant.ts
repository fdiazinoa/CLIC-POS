/** Format stored variant details for receipts without changing the sale snapshot. */
export const formatReceiptVariant = (variantInfo?: string, showLabels = false): string => {
  return (variantInfo || '')
    // Keep fractions such as 1/2 intact; POS separates attributes with spaced slashes.
    .split(/\s+\/\s+|\s*[·|]\s*/)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => showLabels ? part : part.replace(/^[^:]+:\s+/, '').trim())
    .join(' / ');
};

/** Variant selections also appear in modifiers; print those values only once. */
export const receiptModifiersWithoutVariant = (modifiers: string[] = [], variantInfo?: string): string[] => {
  const normalize = (value: string) => value.trim().toLocaleLowerCase();
  const values = new Set(formatReceiptVariant(variantInfo).split(' / ').map(normalize));
  return modifiers.filter(modifier => !values.has(normalize(modifier)));
};
