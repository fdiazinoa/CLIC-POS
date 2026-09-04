export interface NumericInputOptions {
  allowDecimal?: boolean;
  maxValue?: number;
  maxDecimalPlaces?: number;
}

export const appendNumericCharacter = (
  currentValue: string,
  character: string,
  options: NumericInputOptions = {},
): string => {
  const { allowDecimal = true, maxValue, maxDecimalPlaces } = options;

  if (character === '.') {
    if (!allowDecimal || currentValue.includes('.')) return currentValue;
    return currentValue.length === 0 ? '0.' : `${currentValue}.`;
  }

  if (!/^\d$/.test(character)) return currentValue;

  const decimalPart = currentValue.split('.')[1];
  if (decimalPart !== undefined && maxDecimalPlaces !== undefined && decimalPart.length >= maxDecimalPlaces) {
    return currentValue;
  }

  const nextValue = currentValue === '0' ? character : `${currentValue}${character}`;
  const numericValue = Number(nextValue);
  if (maxValue !== undefined && Number.isFinite(numericValue) && numericValue > maxValue) {
    return currentValue;
  }

  return nextValue;
};

export const removeLastNumericCharacter = (currentValue: string): string => (
  currentValue.slice(0, -1)
);
