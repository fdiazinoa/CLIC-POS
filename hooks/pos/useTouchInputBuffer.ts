import { useCallback, useRef, useState } from 'react';

type ValueUpdater = string | ((currentValue: string) => string);

interface SetBufferOptions {
  replaceNext?: boolean;
}

interface NumericKeyOptions {
  maxDecimalPlaces?: number;
}

export const useTouchInputBuffer = (initialValue = '') => {
  const [value, setBufferedValue] = useState(initialValue);
  const replaceNextInputRef = useRef(false);

  const setValue = useCallback((nextValue: ValueUpdater, options?: SetBufferOptions) => {
    if (typeof options?.replaceNext === 'boolean') {
      replaceNextInputRef.current = options.replaceNext;
    }
    setBufferedValue(nextValue);
  }, []);

  const setReplaceOnNextInput = useCallback((replace = true) => {
    replaceNextInputRef.current = replace;
  }, []);

  const clear = useCallback((nextValue = '') => {
    replaceNextInputRef.current = false;
    setBufferedValue(nextValue);
  }, []);

  const backspace = useCallback(() => {
    replaceNextInputRef.current = false;
    setBufferedValue((currentValue) => currentValue.slice(0, -1));
  }, []);

  const inputNumericKey = useCallback((key: string, options?: NumericKeyOptions) => {
    const maxDecimalPlaces = options?.maxDecimalPlaces ?? 2;

    setBufferedValue((currentValue) => {
      if (key === 'C') {
        replaceNextInputRef.current = false;
        return '';
      }

      if (key === 'BACK') {
        replaceNextInputRef.current = false;
        return currentValue.slice(0, -1);
      }

      if (key !== '.' && !/^\d$/.test(key)) {
        return currentValue;
      }

      if (replaceNextInputRef.current) {
        replaceNextInputRef.current = false;
        return key === '.' ? '0.' : key;
      }

      if (key === '.' && currentValue.includes('.')) {
        return currentValue;
      }

      if (currentValue.includes('.')) {
        const decimalPart = currentValue.split('.')[1] || '';
        if (decimalPart.length >= maxDecimalPlaces && key !== '.') {
          return currentValue;
        }
      }

      return `${currentValue}${key}`;
    });
  }, []);

  return {
    value,
    setValue,
    clear,
    backspace,
    inputNumericKey,
    setReplaceOnNextInput,
  };
};
