
import React, { useState, useEffect } from 'react';
import { X, Percent, DollarSign, Check, Trash2 } from 'lucide-react';

interface GlobalDiscountModalProps {
  currentSubtotal: number;
  currencySymbol: string;
  initialValue: string;
  initialType: 'PERCENT' | 'FIXED';
  onClose: () => void;
  onConfirm: (value: string, type: 'PERCENT' | 'FIXED') => void;
  themeColor: string;
}

const PRESETS = [5, 10, 15, 20, 25, 50];

const GlobalDiscountModal: React.FC<GlobalDiscountModalProps> = ({
  currentSubtotal,
  currencySymbol,
  initialValue,
  initialType,
  onClose,
  onConfirm,
  themeColor
}) => {
  const [value, setValue] = useState(initialValue);
  const [type, setType] = useState<'PERCENT' | 'FIXED'>(initialType);

  // Helper to get numeric value safely
  const numValue = parseFloat(value) || 0;

  // Calculate impact for preview
  const discountAmount = type === 'PERCENT' 
    ? currentSubtotal * (Math.min(numValue, 100) / 100) 
    : Math.min(numValue, currentSubtotal);
  
  const newTotal = Math.max(0, currentSubtotal - discountAmount);

  const handleConfirm = () => {
    onConfirm(value, type);
  };

  const handleClear = () => {
    onConfirm('', 'PERCENT');
  };

  const themeClasses = {
    blue: 'bg-blue-600 hover:bg-blue-700 text-white',
    orange: 'bg-orange-600 hover:bg-orange-700 text-white',
    gray: 'bg-gray-800 hover:bg-gray-900 text-white',
  }[themeColor] || 'bg-indigo-600 hover:bg-indigo-700 text-white';

  const activeTabClass = {
    blue: 'bg-blue-100 text-blue-700 border-blue-200',
    orange: 'bg-orange-100 text-orange-700 border-orange-200',
    gray: 'bg-gray-100 text-gray-700 border-gray-200',
  }[themeColor] || 'bg-indigo-100 text-indigo-700 border-indigo-200';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        
        {/* Header */}
        <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
          <h3 className="font-bold text-lg text-gray-800">Descuento Global</h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full text-gray-500 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          
          {/* Type Toggle */}
          <div className="flex bg-gray-100 p-1 rounded-xl">
            <button 
              onClick={() => setType('PERCENT')}
              className={`flex-1 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all ${type === 'PERCENT' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <Percent size={16} /> Porcentaje
            </button>
            <button 
              onClick={() => setType('FIXED')}
              className={`flex-1 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all ${type === 'FIXED' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <DollarSign size={16} /> Monto Fijo
            </button>
          </div>

          {/* Input */}
          <div className="relative">
            <input 
              type="number" 
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="0"
              className={`w-full p-4 text-center text-4xl font-black text-gray-800 bg-gray-50 border-2 rounded-2xl outline-none focus:bg-white transition-all ${type === 'PERCENT' && numValue > 100 ? 'border-red-300 focus:border-red-500' : 'border-gray-200 focus:border-blue-500'}`}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-xl">
              {type === 'PERCENT' ? '%' : currencySymbol}
            </span>
          </div>

          {/* Quick Presets (Only for Percent) */}
          {type === 'PERCENT' && (
            <div className="grid grid-cols-3 gap-3">
              {PRESETS.map(preset => (
                <button
                  key={preset}
                  onClick={() => setValue(preset.toString())}
                  className={`py-2 rounded-xl font-bold border transition-colors ${value === preset.toString() ? activeTabClass : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}
                >
                  {preset}%
                </button>
              ))}
            </div>
          )}

          {/* Summary Preview */}
          <div className="bg-gray-50 p-4 rounded-xl space-y-2 border border-gray-100">
            <div className="flex justify-between text-sm text-gray-500">
              <span>Subtotal Actual</span>
              <span>{currencySymbol}{currentSubtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm font-bold text-red-500">
              <span>Descuento</span>
              <span>-{currencySymbol}{discountAmount.toFixed(2)}</span>
            </div>
            <div className="border-t border-gray-200 pt-2 flex justify-between text-lg font-black text-gray-900">
              <span>Nuevo Total</span>
              <span>{currencySymbol}{newTotal.toFixed(2)}</span>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="p-5 border-t border-gray-100 bg-white flex gap-3">
          <button 
            onClick={handleClear}
            className="px-4 py-3 text-red-500 hover:bg-red-50 rounded-xl font-bold transition-colors flex items-center justify-center border border-transparent hover:border-red-100"
            title="Quitar Descuento"
          >
            <Trash2 size={20} />
          </button>
          <button 
            onClick={handleConfirm}
            className={`flex-1 py-3 rounded-xl font-bold shadow-lg flex items-center justify-center gap-2 active:scale-95 transition-all ${themeClasses}`}
          >
            <Check size={20} /> Aplicar
          </button>
        </div>

      </div>
    </div>
  );
};

export default GlobalDiscountModal;
