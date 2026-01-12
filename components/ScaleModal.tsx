
import React, { useState, useEffect } from 'react';
import { Scale, Check, X, RefreshCw, Calculator } from 'lucide-react';
import { Product } from '../types';

interface ScaleModalProps {
  product: Product;
  currencySymbol: string;
  onConfirm: (weight: number) => void;
  onClose: () => void;
}

const ScaleModal: React.FC<ScaleModalProps> = ({ product, currencySymbol, onConfirm, onClose }) => {
  const [weight, setWeight] = useState<string>('0.000');
  const [isReading, setIsReading] = useState(false);
  const [isStable, setIsStable] = useState(false);

  // Simulate initial read
  useEffect(() => {
    handleReadScale();
  }, []);

  const handleReadScale = () => {
    setIsReading(true);
    setIsStable(false);
    
    // Simulate scale settling delay
    setTimeout(() => {
      // Random weight between 0.5 and 2.5 kg
      const randomWeight = (Math.random() * 2 + 0.5).toFixed(3);
      setWeight(randomWeight);
      setIsReading(false);
      setIsStable(true);
    }, 1500);
  };

  const handleManualInput = (val: string) => {
    // Basic numpad logic
    if (val === 'BACK') {
      setWeight(prev => prev.length > 1 ? prev.slice(0, -1) : '0');
      setIsStable(false); // Manual input is considered entered, but not "stable" from scale
      return;
    }
    
    if (val === 'C') {
        setWeight('0');
        setIsStable(false);
        return;
    }

    setWeight(prev => {
        const clean = prev === '0' || prev === '0.000' ? '' : prev;
        // Simple append logic, real implementation would handle decimal point shift
        if (val === '.' && clean.includes('.')) return clean;
        return clean + val;
    });
  };

  const numericWeight = parseFloat(weight) || 0;
  const totalPrice = numericWeight * product.price;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col">
        
        {/* Header */}
        <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
           <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center">
                 <Scale size={20} />
              </div>
              <div>
                 <h3 className="font-bold text-lg text-gray-800 leading-tight">Balanza Digital</h3>
                 <p className="text-xs text-gray-500">{product.name}</p>
              </div>
           </div>
           <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full text-gray-500">
             <X size={24} />
           </button>
        </div>

        {/* Digital Display */}
        <div className="p-8 bg-gray-900 text-green-400 font-mono flex flex-col items-end justify-center relative border-y-4 border-gray-700 h-40">
           {isReading && (
              <div className="absolute top-2 left-4 flex items-center gap-2 text-yellow-400 text-xs animate-pulse">
                 <RefreshCw size={12} className="animate-spin" />
                 LEYENDO...
              </div>
           )}
           {isStable && !isReading && (
              <div className="absolute top-2 left-4 flex items-center gap-2 text-green-500 text-xs">
                 <div className="w-2 h-2 rounded-full bg-green-500"></div>
                 ESTABLE
              </div>
           )}
           
           <div className="text-6xl font-black tracking-tighter">
              {weight}<span className="text-2xl text-gray-500 ml-2">kg</span>
           </div>
        </div>

        {/* Info & Calculations */}
        <div className="grid grid-cols-2 gap-4 p-4 bg-blue-50 border-b border-blue-100">
           <div className="bg-white p-3 rounded-xl border border-blue-100">
              <span className="text-xs font-bold text-gray-400 uppercase">Precio Unitario</span>
              <div className="text-xl font-bold text-gray-800">{currencySymbol}{product.price.toFixed(2)}/kg</div>
           </div>
           <div className="bg-white p-3 rounded-xl border border-blue-100">
              <span className="text-xs font-bold text-gray-400 uppercase">Total Calculado</span>
              <div className="text-xl font-bold text-blue-600">{currencySymbol}{totalPrice.toFixed(2)}</div>
           </div>
        </div>

        {/* Controls */}
        <div className="p-4 flex gap-4">
           {/* Numpad for manual override */}
           <div className="grid grid-cols-3 gap-2 flex-1">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, '.', 0, 'C'].map(n => (
                 <button 
                    key={n}
                    onClick={() => handleManualInput(n.toString())}
                    className="h-12 bg-gray-100 hover:bg-gray-200 rounded-lg font-bold text-gray-600 text-lg active:scale-95 transition-transform"
                 >
                    {n}
                 </button>
              ))}
           </div>

           {/* Actions */}
           <div className="flex flex-col gap-3 w-1/3">
              <button 
                 onClick={handleReadScale}
                 disabled={isReading}
                 className="flex-1 bg-gray-800 text-white rounded-xl font-bold flex flex-col items-center justify-center gap-1 active:scale-95 transition-all shadow-md"
              >
                 <RefreshCw size={24} className={isReading ? 'animate-spin' : ''} />
                 <span className="text-xs uppercase">Re-Leer</span>
              </button>
              
              <button 
                 onClick={() => onConfirm(numericWeight)}
                 disabled={numericWeight <= 0}
                 className="flex-[2] bg-blue-600 text-white rounded-xl font-bold flex flex-col items-center justify-center gap-1 active:scale-95 transition-all shadow-lg hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                 <Check size={32} />
                 <span className="text-xs uppercase">Confirmar</span>
              </button>
           </div>
        </div>

      </div>
    </div>
  );
};

export default ScaleModal;
