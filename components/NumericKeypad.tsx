import React from 'react';
import { Delete } from 'lucide-react';
import { appendNumericCharacter, removeLastNumericCharacter } from '../utils/numericInput';

interface NumericKeypadProps {
  value: string;
  onChange: (value: string) => void;
  allowDecimal?: boolean;
  maxValue?: number;
  disabled?: boolean;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0'];

const NumericKeypad: React.FC<NumericKeypadProps> = ({
  value,
  onChange,
  allowDecimal = true,
  maxValue,
  disabled = false,
}) => {
  const handleKey = (key: string) => {
    onChange(appendNumericCharacter(value, key, { allowDecimal, maxValue }));
  };

  return (
    <div className="grid grid-cols-3 gap-2" aria-label="Teclado numérico">
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => handleKey(key)}
          disabled={disabled || (key === '.' && !allowDecimal)}
          className="h-11 rounded-xl border border-gray-200 bg-white text-lg font-black text-gray-700 active:scale-95 active:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-30"
          aria-label={key === '.' ? 'Punto decimal' : key}
        >
          {key}
        </button>
      ))}
      <button
        type="button"
        onClick={() => onChange(removeLastNumericCharacter(value))}
        disabled={disabled || value.length === 0}
        className="h-11 rounded-xl border border-gray-200 bg-gray-50 text-gray-600 flex items-center justify-center active:scale-95 active:bg-red-50 disabled:cursor-not-allowed disabled:opacity-30"
        aria-label="Borrar último dígito"
      >
        <Delete size={22} />
      </button>
    </div>
  );
};

export default NumericKeypad;
